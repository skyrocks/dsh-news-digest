// 服务级测试：真 Cordis Context + 真服务 + 临时目录。
// 不连 DSH 进程、不连计划任务：没有 ctx.schedule 时走降级路径，
// 首次使用的投递用 stub 替身，专门盯「当天只触发一次 / 失败要放回」。
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'

import { NewsDigestService } from '../service.js'
import { dayKey } from '../store.js'

const tests = []
const test = (name, fn) => tests.push({ name, fn })

const dir = await mkdtemp(join(tmpdir(), 'dsh-news-digest-service-'))
const ctx = new Context()
const service = new NewsDigestService(ctx, { dir })

test('status：默认值 + 没有计划任务服务', async () => {
  const status = await service.status()
  assert.equal(status.settings.enabled, true)
  assert.equal(status.settings.categories.length, 8)
  assert.equal(status.settings.itemsPerCategory, 5)
  assert.equal(status.hasToday, false)
  assert.equal(status.today, dayKey())
  assert.equal(status.scheduleAvailable, false)
  assert.equal(status.reports.length, 0)
  assert.equal(status.dir, dir)
})

test('report：保存 → 索引 → 读 → 删', async () => {
  const saved = await service.report({
    overview: '今天的事',
    groups: [{ category: '国内', items: [{ title: '标题一', summary: '概括', source: '新华社', url: 'https://example.com/a' }] }],
    focus: [{ title: '重点' }],
  })
  assert.equal(saved.saved, true)
  assert.equal(saved.id, dayKey())
  assert.equal(saved.groups, 1)
  assert.equal(saved.items, 1)
  assert.equal(existsSync(join(dir, 'reports', `${saved.id}.json`)), true)
  assert.equal(existsSync(join(dir, 'reports', `${saved.id}.md`)), true)
  assert.equal(existsSync(join(dir, 'reports', `${saved.id}.html`)), true)
  assert.match(saved.htmlPath, /\.html$/)

  const status = await service.status()
  assert.equal(status.hasToday, true)
  assert.equal(status.counts.reports, 1)

  const listed = await service.reports({ action: 'list' })
  assert.equal(listed.total, 1)
  assert.equal(listed.unread, 1)

  const read = await service.reports({ action: 'read', id: saved.id })
  assert.match(read.markdown, /# 新闻日报/)
  assert.match(read.markdown, /标题一/)
  assert.equal((await service.reports({ action: 'list' })).unread, 0)

  const removed = await service.reports({ action: 'delete', id: saved.id })
  assert.equal(removed.removed, true)
  assert.equal(existsSync(join(dir, 'reports', `${saved.id}.md`)), false)
  assert.equal(existsSync(join(dir, 'reports', `${saved.id}.html`)), false)
  assert.equal((await service.reports({ action: 'list' })).total, 0)
})

test('openInBrowser：参数不合法时明确拒绝（不真的开浏览器）', async () => {
  await assert.rejects(() => service.openInBrowser({}), /缺少日报日期/)
  await assert.rejects(() => service.openInBrowser({ id: 'x' }), /缺少日报日期/)
  await assert.rejects(() => service.openInBrowser({ id: '2026-01-01' }), /没有 2026-01-01 这份日报/)
})

test('report：没有内容不保存；同一天再存会覆盖', async () => {
  const empty = await service.report({ groups: [] })
  assert.equal(empty.saved, false)

  const first = await service.report({ groups: [{ category: '科技', items: [{ title: 'A' }] }] })
  assert.equal(first.saved, true)
  const second = await service.report({ groups: [{ category: '科技', items: [{ title: 'B' }, { title: 'C' }] }] })
  assert.equal(second.saved, true)
  const list = await service.reports({ action: 'list' })
  assert.equal(list.total, 1)
  assert.equal(list.reports[0].items, 2)
  await service.reports({ action: 'delete', id: second.id })
})

test('saveSettings：归一化并记下「没有计划任务服务」', async () => {
  const result = await service.saveSettings({
    categories: [{ id: 'tech', enabled: true }, { name: 'AI' }],
    schedule: { at: '07:30' },
    firstUse: { windowStart: '06:00' },
  })
  assert.equal(result.settings.schedule.at, '07:30')
  assert.equal(result.settings.firstUse.windowStart, '06:00')
  assert.equal(result.settings.categories.length, 9)
  assert.match(result.error, /没有定时任务功能/)
  const onDisk = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))
  assert.equal(onDisk.schedule.at, '07:30')
  assert.equal(onDisk.categories.at(-1).name, 'AI')
})

test('runNow：没有计划任务服务时明确拒绝', async () => {
  const result = await service.runNow({})
  assert.equal(result.ok, false)
  assert.match(result.error, /没有定时任务功能/)
})

test('firstUseCheck：成功触发一次并记下当天', async () => {
  const today = dayKey()
  await service.saveSettings({ firstUse: { enabled: true }, enabled: true })
  await service.reports({ action: 'list' })
  const calls = []
  const original = service.runNow
  service.runNow = async () => {
    calls.push(Date.now())
    return { ok: true, pending: false }
  }
  try {
    const first = await service.firstUseCheck('boot')
    assert.equal(first.fired, true)
    assert.equal(first.day, today)
    assert.equal(calls.length, 1)

    const second = await service.firstUseCheck('prompt')
    assert.equal(second.fired, false)
    assert.equal(second.reason, 'already-triggered')
    assert.equal(calls.length, 1)
  } finally {
    service.runNow = original
  }
  const state = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))
  assert.equal(state.lastTriggerDay, today)
  assert.equal(state.lastTriggerKind, 'boot')
})

test('firstUseCheck：今天已有日报就跳过，并记一天', async () => {
  const today = dayKey()
  const saved = await service.report({ groups: [{ category: '国内', items: [{ title: '已有' }] }] })
  assert.equal(saved.id, today)
  // 清掉「今天已触发」的记录，单独验证「已有日报」这条分支
  await service.firstUseCheck('prompt')
  const result = await service.firstUseCheck('prompt')
  assert.equal(result.fired, false)
  assert.equal(result.reason, 'already-triggered')
  await service.reports({ action: 'delete', id: today })
})

test('firstUseCheck：投递失败要把当天放回去，下次还能再试', async () => {
  const today = dayKey()
  // 重置状态
  await service.saveSettings({ firstUse: { enabled: true } })
  const dirState = join(dir, 'state.json')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(dirState, JSON.stringify({ version: 1, lastTriggerDay: '' }))

  const original = service.runNow
  service.runNow = async () => ({ ok: false, error: '投递失败（测试）' })
  let failed
  try {
    failed = await service.firstUseCheck('prompt')
  } finally {
    service.runNow = original
  }
  assert.equal(failed.fired, false)
  assert.equal(failed.error, '投递失败（测试）')
  const state = JSON.parse(await readFile(dirState, 'utf8'))
  assert.equal(state.lastTriggerDay, '')
  assert.equal(state.lastTriggerError, '投递失败（测试）')

  // 放回去之后，下一次还能触发
  service.runNow = async () => ({ ok: true, pending: false })
  const retried = await service.firstUseCheck('prompt')
  service.runNow = original
  assert.equal(retried.fired, true)
  assert.equal(retried.day, today)
})

test('syncSchedule：没有任务 / 没有定时服务时安静跳过', async () => {
  assert.equal((await service.syncSchedule()).reason, 'no-task')
  await service.saveSettings({ schedule: { scheduleId: 'schedule-x' } })
  assert.equal((await service.syncSchedule()).reason, 'no-schedule-service')
})

test('firstUseCheck：今天已有日报时把补跑计数收干净', async () => {
  const today = dayKey()
  const { readFile, writeFile } = await import('node:fs/promises')
  const dirState = join(dir, 'state.json')
  await service.report({ groups: [{ category: '国内', items: [{ title: '今天的' }] }] })
  await writeFile(dirState, JSON.stringify({
    version: 1,
    lastTriggerDay: today,
    lastTriggerKind: 'retry',
    lastTriggerError: '上次投递后没有出报',
    retryDay: today,
    retryCount: 2,
  }))
  const result = await service.firstUseCheck('prompt')
  assert.equal(result.fired, false)
  assert.equal(result.reason, 'already-triggered')
  const state = JSON.parse(await readFile(dirState, 'utf8'))
  assert.equal(state.retryCount, 0)
  assert.equal(state.retryDay, '')
  assert.equal(state.lastTriggerError, '')
  await service.reports({ action: 'delete', id: today })
})

test('dispose 可重复调用', () => {
  service.dispose()
  service.dispose()
})

let failed = 0
for (const { name, fn } of tests) {
  try {
    await fn()
    console.log(`ok   ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`)
await rm(dir, { recursive: true, force: true })
if (failed > 0) process.exit(1)
