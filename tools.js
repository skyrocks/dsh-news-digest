// Host 半（工具层）：把「出今天的新闻日报」这件事注册成模型工具。
//
// 流程：看状态（news_status）→ 自己用 web_search 搜 → 存日报（news_report）
// → 回看历史（news_reports）。每一步都调 service 上的同一个方法，
// 「设置 → 新闻日报」界面走的是同一套方法。
import { sourceLabel } from './report.js'
import { clockToMinutes, inWindow } from './store.js'

/** 统一参数校验：只认声明过的字段，类型不对直接说清楚。 */
function readArgs(tool, args, spec) {
  const value = args === undefined || args === null ? {} : args
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${tool}: 参数必须是对象。`)
  }
  const allowed = Object.keys(spec)
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new Error(`${tool}: 不认识的参数「${key}」；只接受 ${allowed.join(', ')}。`)
    }
  }
  const out = {}
  for (const [key, entry] of Object.entries(spec)) {
    const raw = value[key]
    const blank = typeof raw === 'string' && raw.trim() === ''
    const present = raw !== undefined && raw !== null && (entry.allowEmpty === true ? !blank || typeof raw === 'string' : !blank)
    if (!present) {
      if (entry.required === true) throw new Error(`${tool}: 缺少必填参数「${key}」。`)
      continue
    }
    if (entry.type === 'number') {
      const number = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(number)) throw new Error(`${tool}: 参数「${key}」必须是数字。`)
      out[key] = number
      continue
    }
    if (entry.type === 'boolean') {
      if (typeof raw !== 'boolean') throw new Error(`${tool}: 参数「${key}」必须是布尔值。`)
      out[key] = raw
      continue
    }
    if (entry.type === 'array') {
      if (!Array.isArray(raw)) throw new Error(`${tool}: 参数「${key}」必须是数组。`)
      out[key] = raw
      continue
    }
    if (typeof raw !== 'string') throw new Error(`${tool}: 参数「${key}」必须是字符串。`)
    out[key] = entry.allowEmpty === true ? raw.trim() : raw
  }
  return out
}

function oneLine(text, width) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length <= width ? value : `${value.slice(0, width - 1)}…`
}

function stamp(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value ?? '').slice(0, 16)
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function categoryLine(category) {
  const flag = category.enabled ? '开' : '关'
  const keywords = category.keywords === '' ? '' : ` · 关键词：${category.keywords}`
  return `- [${flag}] ${category.name}${category.custom ? '（其他 / 自定义）' : ''}${keywords}`
}

function clockLabel(minutes) {
  const pad = (number) => String(number).padStart(2, '0')
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

export function registerTools(ctx, service) {
  ctx.tools.register({
    name: 'news_status',
    description: [
      '查看新闻日报的状态：开着没有、配了哪些类别（含自定义的「其他」）、每类几条、今天是否已经出过、',
      '定时与「上午第一次使用」是怎么设的、数据在哪。出日报前先调它。',
    ].join(''),
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { note: { type: 'string' }, hasToday: { type: 'boolean' }, categories: { type: 'array' } },
        required: ['note', 'hasToday', 'categories'],
      },
      render: (_args, value) => [{ type: 'text', text: value.note }],
    },
    async execute() {
      const status = await service.status()
      const settings = status.settings
      const enabled = settings.categories.filter((category) => category.enabled)
      const now = new Date()
      const inMorning = inWindow(now, settings.firstUse.windowStart, settings.firstUse.windowEnd)

      const lines = [
        settings.enabled ? '新闻日报：开着' : '新闻日报：关着（先到「设置 → 新闻日报」打开）',
        `今天（${status.today}）：${status.hasToday ? `已经出过 ${status.todayReport?.title ?? ''}` : '还没有日报'}${status.todayReport?.source === undefined ? '' : ` · 来源 ${sourceLabel(status.todayReport.source)}`}`,
        `类别（${enabled.length} 个开着 / 共 ${settings.categories.length} 个）：`,
        ...settings.categories.map(categoryLine),
        `每类最多 ${settings.itemsPerCategory} 条${settings.focus === '' ? '' : `；额外关注：${settings.focus}`}`,
        `定时：${settings.schedule.enabled ? `每天 ${settings.schedule.at}` : '关着'}${status.taskExists ? '' : '（计划任务还不存在，保存设置或出一次报会自动建）'}`,
        settings.firstUse.enabled
          ? `上午第一次使用：开 · 窗口 ${settings.firstUse.windowStart}–${settings.firstUse.windowEnd}${settings.firstUse.backfill ? ' · 窗口外当天也补一次' : ' · 窗口外不补'}`
            + `${status.state.lastTriggerDay === status.today ? ` · 今天已触发过（${status.state.lastTriggerKind}）` : ''}`
          : '上午第一次使用：关',
        `现在 ${clockLabel(now.getHours() * 60 + now.getMinutes())}，${inMorning ? '在上午窗口内' : '不在上午窗口内'}。`,
        `模型可用：web_search（播报时每类搜一次）。`,
        `数据目录：${status.dir}`,
      ]

      if (status.todayReport !== null && status.todayReport !== undefined) {
        lines.push('', `已有日报：${status.todayReport.groups} 个类别 / ${status.todayReport.items} 条。要重出就再调一次 news_report（同一天会覆盖）。`)
      }
      lines.push('', '出日报的流程：按类别各用 web_search 搜一次 → news_report 保存 → 用两三句话回复用户。')

      return {
        note: lines.join('\n'),
        hasToday: status.hasToday,
        categories: settings.categories,
      }
    },
  })

  ctx.tools.register({
    name: 'news_report',
    description: [
      '保存今天（或指定日期）的新闻日报：落盘（json + md）并登记，用户在「设置 → 新闻日报」里能回看。',
      'overview 写一两句总览；groups 按类别分组，每项 { category, items: [{ title, summary, source, url, publishedAt }] }；',
      'focus 写 1–5 条最值得先看的，每项 { title, detail }。',
      '只写真实搜到的新闻和真实链接，不要编造；同一天再调一次会覆盖上一份。',
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        overview: { type: 'string', description: '一两句话总览今天的新闻' },
        groups: { type: 'array', description: '按类别分组：[{ category, items: [{ title, summary?, source?, url?, publishedAt? }] }]' },
        focus: { type: 'array', description: '1–5 条最值得先看的：[{ title, detail? }]' },
        date: { type: 'string', description: '可选。默认今天（YYYY-MM-DD）' },
        source: { type: 'string', description: '可选。schedule / first-use / manual / chat，默认 manual' },
      },
      required: ['groups'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          saved: { type: 'boolean' },
          id: { type: 'string' },
          title: { type: 'string' },
          groups: { type: 'number' },
          items: { type: 'number' },
          path: { type: 'string' },
          markdown: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['saved', 'id', 'title', 'groups', 'items', 'path', 'markdown', 'note'],
      },
      render: (_args, value) => [{ type: 'text', text: value.note }],
    },
    async execute(rawArgs) {
      const args = readArgs('news_report', rawArgs, {
        overview: {},
        groups: { type: 'array', required: true },
        focus: { type: 'array' },
        date: {},
        source: {},
      })
      const result = await service.report({
        overview: args.overview,
        groups: args.groups,
        focus: args.focus,
        date: args.date,
        source: args.source,
      })
      return {
        saved: result.saved === true,
        id: result.id ?? '',
        title: result.title ?? '',
        groups: result.groups ?? 0,
        items: result.items ?? 0,
        path: result.path ?? '',
        markdown: result.markdown ?? '',
        note: result.note ?? '',
      }
    },
  })

  ctx.tools.register({
    name: 'news_reports',
    description: [
      '日报列表 / 读一份 / 删一份。action：list（默认）、read、delete；id 用日期（YYYY-MM-DD）。',
      '用户问「今天的新闻在哪」「上周三那份」时用它；read 会把那份标成已读。',
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', description: 'list / read / delete，默认 list' },
        id: { type: 'string', description: 'read / delete 时必填：日报日期 YYYY-MM-DD' },
        limit: { type: 'number', description: 'list 时最多列几份，默认 20' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { reports: { type: 'array' }, note: { type: 'string' } },
        required: ['reports', 'note'],
      },
      render: (_args, value) => [{ type: 'text', text: value.note }],
    },
    async execute(rawArgs) {
      const args = readArgs('news_reports', rawArgs, { action: {}, id: {}, limit: { type: 'number' } })
      const action = args.action ?? 'list'

      if (action === 'list') {
        const result = await service.reports({ action: 'list', limit: args.limit ?? 20 })
        const lines = result.reports.map((report) => (
          `- [${report.id}] ${report.title} · ${report.groups} 个类别 / ${report.items} 条`
          + ` · ${sourceLabel(report.source)}${report.unread ? ' · 未读' : ''}`
          + `${report.overview === '' ? '' : ` · ${oneLine(report.overview, 60)}`}`
        ))
        return {
          reports: result.reports,
          note: result.total === 0
            ? '还没有日报。出一次：news_status 看类别，再按类别搜、用 news_report 保存。'
            : `共 ${result.total} 份（未读 ${result.unread}）：\n${lines.join('\n')}`,
        }
      }

      if (action === 'read') {
        if (typeof args.id !== 'string') throw new Error('news_reports: read 需要 id（日报日期）。')
        const result = await service.reports({ action: 'read', id: args.id })
        return { reports: result.reports, note: result.markdown }
      }

      if (action === 'delete') {
        if (typeof args.id !== 'string') throw new Error('news_reports: delete 需要 id（日报日期）。')
        const result = await service.reports({ action: 'delete', id: args.id })
        return { reports: result.reports, note: result.note ?? '删掉了。' }
      }

      throw new Error(`news_reports: 不认识的 action「${action}」（list / read / delete）。`)
    },
  })

  ctx.tools.register({
    name: 'news_categories',
    description: [
      '增删 / 开关新闻类别（固定类别只能开关；自定义的「其他」可以加和删）。',
      'action：list / add / remove / enable / disable / keywords；name 是类别名（中文就行，例如「AI」「加密货币」）。',
      'keywords 是该类别拼进搜索词的关键词（只在 add 和 keywords 两个动作里用；传空串表示清空）。',
      '用户说「把体育也加上」「再加个 AI 类别」「科技类多搜 AI 大模型」时用它，不用让用户去设置页。',
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', description: 'list / add / remove / enable / disable / keywords，默认 list' },
        name: { type: 'string', description: '类别名；add 时新建，其他动作按名字找' },
        keywords: { type: 'string', allowEmpty: true, description: '可选。该类别的搜索关键词，空格分隔；传空串清空' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { note: { type: 'string' }, categories: { type: 'array' } },
        required: ['note', 'categories'],
      },
      render: (_args, value) => [{ type: 'text', text: value.note }],
    },
    async execute(rawArgs) {
      const args = readArgs('news_categories', rawArgs, { action: {}, name: {}, keywords: { allowEmpty: true } })
      const action = args.action ?? 'list'
      const status = await service.status()
      const categories = status.settings.categories

      if (action === 'list') {
        return {
          categories,
          note: [`类别（${categories.filter((item) => item.enabled).length} 个开着）：`, ...categories.map(categoryLine)].join('\n'),
        }
      }

      const name = typeof args.name === 'string' ? args.name.trim() : ''
      if (name === '') throw new Error(`news_categories: ${action} 需要 name。`)

      if (action === 'add') {
        if (categories.some((item) => item.name === name)) throw new Error(`已经有「${name}」这个类别了。`)
        const next = [...categories, { name, enabled: true, custom: true, keywords: args.keywords ?? '' }]
        await service.saveSettings({ categories: next })
        return {
          categories: next,
          note: `已加上「${name}」，下次出日报就会搜它。现在的类别：\n${next.map(categoryLine).join('\n')}`,
        }
      }

      const hit = categories.find((item) => item.name === name)
      if (hit === undefined) throw new Error(`没有叫「${name}」的类别；现有：${categories.map((item) => item.name).join('、')}。`)

      if (action === 'remove') {
        if (!hit.custom) throw new Error(`「${name}」是固定类别，不能删，只能 disable（关掉）。`)
        const next = categories.filter((item) => item.id !== hit.id)
        await service.saveSettings({ categories: next })
        return { categories: next, note: `已删掉「${name}」。` }
      }

      if (action === 'keywords') {
        if (args.keywords === undefined) throw new Error('news_categories: keywords 动作需要 keywords（传空串表示清空）。')
        const next = categories.map((item) => (item.id === hit.id ? { ...item, keywords: args.keywords } : item))
        await service.saveSettings({ categories: next })
        return {
          categories: next,
          note: args.keywords === ''
            ? `已清空「${name}」的关键词。`
            : `「${name}」的搜索关键词：${args.keywords}。下次出报会拼进查询词。`,
        }
      }

      if (action === 'enable' || action === 'disable') {
        const enabled = action === 'enable'
        const next = categories.map((item) => (item.id === hit.id ? { ...item, enabled } : item))
        await service.saveSettings({ categories: next })
        return {
          categories: next,
          note: `${enabled ? '已开启' : '已关掉'}「${name}」。开着的：${next.filter((item) => item.enabled).map((item) => item.name).join('、') || '（一个都没有）'}`,
        }
      }

      throw new Error(`news_categories: 不认识的 action「${action}」（list / add / remove / enable / disable / keywords）。`)
    },
  })

  registerFocusTool(ctx, service)
}

function registerFocusTool(ctx, service) {
  ctx.tools.register({
    name: 'news_focus',
    description: [
      '设置 / 清空「额外关注」：一段自由文本，出报时会单独搜一次，并作为整体偏好的提示。',
      '用户说「以后新闻重点盯 AI 和芯片」「别再看娱乐了」时用它；传空串表示清空。',
      '要长期多搜某一类，优先用 news_categories 加类别 + keywords，这个字段是补充。',
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { text: { type: 'string', allowEmpty: true, description: '额外关注的内容；传空串清空' } },
      required: ['text'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { focus: { type: 'string' }, note: { type: 'string' } },
        required: ['focus', 'note'],
      },
      render: (_args, value) => [{ type: 'text', text: value.note }],
    },
    async execute(rawArgs) {
      const args = readArgs('news_focus', rawArgs, { text: { required: true, allowEmpty: true } })
      await service.saveSettings({ focus: args.text })
      return {
        focus: args.text,
        note: args.text === ''
          ? '已清空额外关注。'
          : `额外关注已设为「${args.text}」，以后每次出报都会为此单独搜一次。`,
      }
    },
  })
}

/** 供测试用：把 "HH:mm" 换成分钟。 */
export { clockToMinutes, stamp }
