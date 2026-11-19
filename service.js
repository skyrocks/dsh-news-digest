// Host 服务：设置、日报、触发、调度。
//
// 同一层服务两个调用方（与邮件整理一致）：
//   - 「设置 → 新闻日报」界面通过 ctx.remote.newsDigest.* 调它；
//   - 模型工具 news_* 也调它。
// 所以「存一份日报 / 读一份日报 / 立即出一次」只实现一次。
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

import { reportEntry, reportSummary, renderMarkdown, sourceLabel } from './report.js'
import { NEWS_PROMPT, NEWS_TITLE, ensureSchedule, runSchedule, scheduleService } from './schedule.js'
import {
  createStore,
  dayKey,
  normalizeCategories,
  normalizeReportBody,
  normalizeSettings,
} from './store.js'
import { decideFirstUse } from './trigger.js'

const MAX_REPORTS = 120

/** 只保留最近若干份，防止目录无限长。 */
function pruneReports(reports) {
  return reports.length <= MAX_REPORTS ? reports : reports.slice(0, MAX_REPORTS)
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

export class NewsDigestService extends TypertRemoteService {
  constructor(ctx, options = {}) {
    super(ctx, 'newsDigest')
    this.store = createStore(typeof options.dir === 'string' ? { dir: options.dir } : {})
    this.checking = false
  }

  /** 当前状态：设置、今天有没有日报、定时任务在不在、最近几份。 */
  async status() {
    const settings = await this.store.readSettings()
    const state = await this.store.readState()
    const reports = await this.store.readReports()
    const today = dayKey()
    const todayReport = reports.find((report) => report.date === today) ?? null
    const schedule = scheduleService(this.ctx)
    let taskExists = false
    let taskStatus = ''
    if (schedule !== undefined && settings.schedule.scheduleId !== '') {
      try {
        const entry = await schedule.view({ id: settings.schedule.scheduleId })
        taskExists = entry !== undefined && entry !== null && entry.code !== 'schedule_not_found'
        taskStatus = taskExists && typeof entry.status === 'string' ? entry.status : ''
      } catch {
        taskExists = false
      }
    }
    return {
      settings,
      state,
      today,
      hasToday: todayReport !== null,
      todayReport,
      reports: reports.slice(0, 30),
      counts: {
        reports: reports.length,
        categories: settings.categories.filter((category) => category.enabled).length,
        custom: settings.categories.filter((category) => category.custom).length,
      },
      dir: this.store.dir,
      scheduleAvailable: schedule !== undefined,
      taskExists,
      taskStatus,
    }
  }

  /**
   * 保存设置。categories 传完整列表（设置页就是这么发的）。
   * @param {object} request
   */
  async saveSettings(request = {}) {
    const current = await this.store.readSettings()
    const next = normalizeSettings({
      ...current,
      ...(request.enabled === undefined ? {} : { enabled: request.enabled }),
      ...(request.focus === undefined ? {} : { focus: request.focus }),
      ...(request.itemsPerCategory === undefined ? {} : { itemsPerCategory: request.itemsPerCategory }),
      ...(request.firstUse === undefined ? {} : { firstUse: { ...current.firstUse, ...request.firstUse } }),
      ...(request.schedule === undefined ? {} : { schedule: { ...current.schedule, ...request.schedule } }),
      ...(request.categories === undefined ? {} : { categories: request.categories }),
    })

    // 类别可能是设置页直接传的原始数组；normalizeSettings 已经补齐固定类别。
    let saved = await this.store.writeSettings({
      ...next,
      categories: normalizeCategories(next.categories),
    })

    // 永远确保那条任务存在：active 表达「定时开没开」。
    // 不能因为两个开关都关就跳过——否则之前建好的任务还开着，到点照样真搜真写。
    let error = ''
    const result = await ensureSchedule(this.ctx, {
      scheduleId: saved.schedule.scheduleId,
      at: saved.schedule.at,
      enabled: saved.enabled && saved.schedule.enabled,
      cwd: request.cwd,
    })
    if (result.error !== undefined) error = result.error
    if (result.scheduleId !== undefined && result.scheduleId !== '') {
      saved = await this.store.writeSettings({ ...saved, schedule: { ...saved.schedule, scheduleId: result.scheduleId, lastError: error } })
    } else {
      saved = await this.store.writeSettings({ ...saved, schedule: { ...saved.schedule, lastError: error } })
    }

    return { ...(await this.status()), error }
  }

  /**
   * 保存一份日报（工具 news_report 与界面都走这里）。
   * @param {object} request
   */
  async report(request = {}) {
    const settings = await this.store.readSettings()
    const date = typeof request.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(request.date) ? request.date : dayKey()
    const body = normalizeReportBody(
      { ...request, date, createdAt: new Date().toISOString() },
      { source: typeof request.source === 'string' && request.source !== '' ? request.source : 'manual' },
    )

    const totalItems = body.groups.reduce((total, group) => total + group.items.length, 0)
    if (totalItems === 0 && body.overview === '' && body.focus.length === 0) {
      return { saved: false, note: '这次没有任何可写的内容，没保存。先搜到新闻再调 news_report。' }
    }

    const markdown = renderMarkdown(body)
    await this.store.writeReportBody(body)
    const path = await this.store.writeReportText(body.id, markdown)

    const reports = await this.store.readReports()
    const entry = reportEntry(body, { path })
    const without = reports.filter((item) => item.id !== body.id)
    const saved = pruneReports([entry, ...without])
    await this.store.writeReports(saved)

    return {
      saved: true,
      id: body.id,
      date: body.date,
      title: body.title,
      groups: body.groups.length,
      items: totalItems,
      path,
      markdown,
      note: `已保存 ${body.title}：${body.groups.length} 个类别 / ${totalItems} 条${settings.enabled ? '' : '（插件现在是关着的）'}。`,
    }
  }

  /**
   * 日报列表 / 读一份 / 删一份。
   * @param {{ action?: string, id?: string, limit?: number }} request
   */
  async reports(request = {}) {
    const action = typeof request.action === 'string' ? request.action : 'list'
    const reports = await this.store.readReports()

    if (action === 'list') {
      const limit = Math.min(Math.max(1, Number.isFinite(request.limit) ? request.limit : 20), 100)
      return {
        reports: reports.slice(0, limit),
        total: reports.length,
        unread: reports.filter((report) => report.unread).length,
      }
    }

    if (action === 'read') {
      const id = String(request.id ?? '')
      const entry = reports.find((report) => report.id === id)
      if (entry === undefined) return { reports: [], report: null, markdown: '没有这份日报。' }
      const body = await this.store.readReportBody(id)
      const markdown = body === undefined ? await this.store.readReportText(id) : renderMarkdown(body)
      if (entry.unread) {
        await this.store.writeReports(reports.map((report) => (report.id === id ? { ...report, unread: false } : report)))
      }
      return {
        reports: [{ ...entry, unread: false }],
        report: body ?? entry,
        markdown: markdown === '' ? '这份日报的正文文件不见了。' : markdown,
      }
    }

    if (action === 'delete') {
      const id = String(request.id ?? '')
      const hit = reports.find((report) => report.id === id)
      if (hit === undefined) return { reports: [], removed: false, note: '没有这份日报。' }
      await this.store.writeReports(reports.filter((report) => report.id !== id))
      for (const file of [join(this.store.paths.reportsDir, `${id}.json`), join(this.store.paths.reportsDir, `${id}.md`)]) {
        try {
          await unlink(file)
        } catch {
          // 文件早就不在了
        }
      }
      return { reports: await this.store.readReports(), removed: true, note: `已删除 ${hit.title}。` }
    }

    return { reports: [], error: `不认识的 action「${action}」（list / read / delete）。` }
  }

  /**
   * 立刻出一次日报：确保那条计划任务在，然后立即投递一次（不动定时的那一次）。
   * @param {{ kind?: string, cwd?: string }} request
   */
  async runNow(request = {}) {
    const settings = await this.store.readSettings()
    if (!settings.enabled) return { ok: false, error: '新闻日报是关着的（按已保存的设置），先在上面打开再出一份。' }
    if (settings.categories.filter((category) => category.enabled).length === 0) {
      return { ok: false, error: '一个类别都没开，先在上面的「类别」里勾几个。' }
    }
    const schedule = scheduleService(this.ctx)
    if (schedule === undefined) return { ok: false, error: '这台 DSH 没有定时任务功能，自动出报用不了。' }

    const first = await ensureSchedule(this.ctx, {
      scheduleId: settings.schedule.scheduleId,
      at: settings.schedule.at,
      enabled: settings.enabled && settings.schedule.enabled,
      cwd: request.cwd,
    })
    if (first.error !== undefined) return { ok: false, error: first.error }
    if (first.supported === false) return { ok: false, error: first.error ?? '计划任务服务不可用。' }
    let scheduleId = first.scheduleId ?? ''
    if (scheduleId === '') return { ok: false, error: '定时任务没建起来，到「设置 → 定时任务」里看一下。' }

    if (scheduleId !== settings.schedule.scheduleId) {
      await this.store.writeSettings({ ...settings, schedule: { ...settings.schedule, scheduleId } })
    }

    let result = await runSchedule(this.ctx, scheduleId)
    if (result.ok !== true && result.missing === true) {
      // 任务被删掉了：重建一条，再投一次。
      const rebuilt = await ensureSchedule(this.ctx, { at: settings.schedule.at, enabled: settings.enabled && settings.schedule.enabled, cwd: request.cwd })
      scheduleId = rebuilt.scheduleId ?? ''
      if (scheduleId === '') return { ok: false, error: rebuilt.error ?? '重建计划任务失败。' }
      await this.store.writeSettings({ ...settings, schedule: { ...settings.schedule, scheduleId } })
      result = await runSchedule(this.ctx, scheduleId)
    }
    if (result.ok !== true) return { ok: false, error: result.error ?? '投递失败。' }

    return {
      ok: true,
      scheduleId,
      pending: result.pending === true,
      title: NEWS_TITLE,
      note: result.pending === true
        ? '上一次还在跑，这次先不重复投递。'
        : '已经排上了，稍等一会儿在「新闻日报」会话里看结果。',
    }
  }

  /**
   * 插件升级后把那条计划任务的提示词刷新成当前版本。
   * 只在任务已经存在时更新：用户自己删掉的任务不重建（想重建就点「保存设置」）。
   */
  async syncSchedule() {
    const settings = await this.store.readSettings()
    const id = settings.schedule.scheduleId
    if (id === '') return { updated: false, reason: 'no-task' }
    const schedule = scheduleService(this.ctx)
    if (schedule === undefined) return { updated: false, reason: 'no-schedule-service' }
    try {
      const entry = await schedule.view({ id })
      if (entry === undefined || entry === null || entry.code === 'schedule_not_found') {
        return { updated: false, reason: 'task-missing' }
      }
      if (entry.prompt === NEWS_PROMPT && entry.title === NEWS_TITLE) return { updated: false, reason: 'up-to-date' }
    } catch {
      return { updated: false, reason: 'view-failed' }
    }
    const result = await ensureSchedule(this.ctx, {
      scheduleId: id,
      at: settings.schedule.at,
      enabled: settings.enabled && settings.schedule.enabled,
    })
    return result.error === undefined ? { updated: true } : { updated: false, reason: result.error }
  }

  /**
   * 「今天是不是第一次使用」的检查。两个信号都走这里，当天只会触发一次。
   * @param {'boot'|'prompt'} kind
   */
  async firstUseCheck(kind = 'prompt') {
    if (this.checking) return { fired: false, reason: 'busy' }
    this.checking = true
    try {
      const settings = await this.store.readSettings()
      const state = await this.store.readState()
      const now = new Date()
      const reports = await this.store.readReports()
      const todayReport = reports.find((report) => report.date === dayKey(now))
      const decision = decideFirstUse({ settings, state, now, hasTodayReport: todayReport !== undefined })

      if (!decision.fire) {
        // 「今天已经有日报」也记一天，省得之后的每次输入都重新判断。
        if (decision.reason === 'report-exists' && state.lastTriggerDay !== decision.day) {
          await this.store.writeState({
            ...state,
            lastTriggerDay: decision.day,
            lastTriggerKind: 'report-exists',
            lastTriggerAt: now.toISOString(),
          })
        }
        return { fired: false, ...decision }
      }

      // 先占住这一天，避免两个信号同时到把日报出两遍；失败再放回去。
      await this.store.writeState({
        ...state,
        lastTriggerDay: decision.day,
        lastTriggerKind: kind,
        lastTriggerAt: now.toISOString(),
        lastTriggerError: '',
      })

      const result = await this.runNow({ kind })
      if (result.ok !== true) {
        await this.store.writeState({ ...state, lastTriggerError: result.error ?? '投递失败。' })
        return { fired: false, ...decision, error: result.error }
      }
      return { fired: true, ...decision, pending: result.pending === true }
    } catch (error) {
      return { fired: false, reason: 'error', error: errorText(error) }
    } finally {
      this.checking = false
    }
  }

  /** 工具/界面共用：一份日报的可读摘要。 */
  static describeReport(entry) {
    return `${entry.title} · ${entry.groups} 个类别 / ${entry.items} 条 · ${sourceLabel(entry.source)} · ${reportSummary(entry)}`
  }

  dispose() {
    this.checking = false
  }
}

export { NEWS_PROMPT, NEWS_TITLE }
