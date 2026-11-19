import assert from 'node:assert/strict'

import { registerTools } from '../tools.js'
import { FIXED_CATEGORIES, normalizeSettings } from '../store.js'

const FIXED_LENGTH = FIXED_CATEGORIES.length

const tests = []
const test = (name, fn) => tests.push({ name, fn })

function fakeCtx() {
  const tools = new Map()
  return { tools: { register(definition) { tools.set(definition.name, definition) } }, registered: tools }
}

function fakeService(overrides = {}) {
  const calls = []
  const settings = normalizeSettings({
    categories: [
      { id: 'tech', enabled: true, keywords: 'AI 芯片' },
      { name: 'AI 智能体', enabled: true },
    ],
  })
  const base = {
    settings,
    state: { lastTriggerDay: '', lastTriggerKind: '', lastTriggerAt: '', lastTriggerError: '' },
    today: '2026-11-19',
    hasToday: false,
    todayReport: null,
    reports: [
      { id: '2026-11-18', date: '2026-11-18', title: '新闻日报 · 2026-11-18', createdAt: '2026-11-18T08:00:00.000Z', overview: '昨天的事', groups: 2, items: 6, source: 'schedule', path: '/tmp/2026-11-18.md', unread: true },
    ],
    counts: { reports: 1, categories: 5, custom: 1 },
    dir: '/tmp/news-digest',
    scheduleAvailable: true,
    taskExists: true,
  }
  const service = {
    calls,
    status: async () => ({ ...base, ...overrides }),
    saveSettings: async (request) => {
      calls.push(['saveSettings', request])
      return { ...base, settings: normalizeSettings({ ...settings, ...request }) }
    },
    report: async (request) => {
      calls.push(['report', request])
      return { saved: true, id: '2026-11-19', title: '新闻日报 · 2026-11-19', groups: 1, items: 1, path: '/tmp/x.md', markdown: '# x', note: '已保存' }
    },
    reports: async (request) => {
      calls.push(['reports', request])
      if (request.action === 'read') return { reports: [], report: base.reports[0], markdown: '# 昨天' }
      if (request.action === 'delete') return { reports: [], removed: true, note: '已删除' }
      return { reports: base.reports, total: 1, unread: 1 }
    },
    runNow: async (request) => {
      calls.push(['runNow', request])
      return { ok: true, scheduleId: 's1', pending: false, title: '新闻日报', note: '已经排上了。' }
    },
  }
  return service
}

test('注册 5 个工具，参数 schema 合法', () => {
  const ctx = fakeCtx()
  registerTools(ctx, fakeService())
  assert.deepEqual([...ctx.registered.keys()], ['news_status', 'news_report', 'news_reports', 'news_categories', 'news_focus'])
  for (const definition of ctx.registered.values()) {
    assert.equal(definition.parameters.type, 'object')
    assert.equal(definition.parameters.additionalProperties, false)
    assert.equal(typeof definition.execute, 'function')
    assert.equal(typeof definition.output.render, 'function')
  }
})

test('news_status：说清楚类别、今天状态、定时与窗口', async () => {
  const ctx = fakeCtx()
  registerTools(ctx, fakeService())
  const result = await ctx.registered.get('news_status').execute({})
  assert.match(result.note, /类别/)
  assert.match(result.note, /\[开\] 科技 · 关键词：AI 芯片/)
  assert.match(result.note, /AI 智能体（其他 \/ 自定义）/)
  assert.match(result.note, /今天（2026-11-19）：还没有日报/)
  assert.match(result.note, /每天 08:00/)
  assert.match(result.note, /上午第一次使用：开/)
  assert.equal(result.hasToday, false)
  assert.equal(result.categories.length, FIXED_LENGTH + 1)
})

test('news_report：groups 必填，未知参数报错', async () => {
  const ctx = fakeCtx()
  registerTools(ctx, fakeService())
  const tool = ctx.registered.get('news_report')
  await assert.rejects(() => tool.execute({}), /缺少必填参数「groups」/)
  await assert.rejects(() => tool.execute({ groups: [], nope: 1 }), /不认识的参数/)
  await assert.rejects(() => tool.execute({ groups: 'x' }), /必须是数组/)
  const result = await tool.execute({ groups: [{ category: '国内', items: [{ title: 'x' }] }] })
  assert.equal(result.saved, true)
  assert.equal(result.items, 1)
})

test('news_reports：list / read / delete，缺 id 报错', async () => {
  const ctx = fakeCtx()
  const service = fakeService()
  registerTools(ctx, service)
  const tool = ctx.registered.get('news_reports')

  const listed = await tool.execute({})
  assert.match(listed.note, /共 1 份/)
  assert.match(listed.note, /上午第一次使用|定时/)
  assert.equal(listed.reports.length, 1)

  const read = await tool.execute({ action: 'read', id: '2026-11-18' })
  assert.equal(read.note, '# 昨天')
  await assert.rejects(() => tool.execute({ action: 'read' }), /需要 id/)

  const deleted = await tool.execute({ action: 'delete', id: '2026-11-18' })
  assert.equal(deleted.note, '已删除')
  await assert.rejects(() => tool.execute({ action: 'nope' }), /不认识的 action/)
})

test('news_categories：add / disable / remove / 固定类别不可删', async () => {
  const ctx = fakeCtx()
  const service = fakeService()
  registerTools(ctx, service)
  const tool = ctx.registered.get('news_categories')

  const listed = await tool.execute({ action: 'list' })
  assert.match(listed.note, /类别（5 个开着）/)

  const added = await tool.execute({ action: 'add', name: '加密货币' })
  assert.match(added.note, /已加上「加密货币」/)
  const addCall = service.calls.find(([name]) => name === 'saveSettings')
  assert.equal(addCall[1].categories.at(-1).name, '加密货币')

  const disabled = await tool.execute({ action: 'disable', name: '科技' })
  assert.match(disabled.note, /已关掉「科技」/)

  const removed = await tool.execute({ action: 'remove', name: 'AI 智能体' })
  assert.match(removed.note, /已删掉「AI 智能体」/)

  await assert.rejects(() => tool.execute({ action: 'remove', name: '科技' }), /固定类别/)
  await assert.rejects(() => tool.execute({ action: 'add' }), /需要 name/)
  await assert.rejects(() => tool.execute({ action: 'add', name: '科技' }), /已经有/)
})

test('news_categories：add 带关键词 / keywords 改关键词 / 清空', async () => {
  const ctx = fakeCtx()
  const service = fakeService()
  registerTools(ctx, service)
  const tool = ctx.registered.get('news_categories')

  const added = await tool.execute({ action: 'add', name: 'AI 前沿', keywords: '大模型 智能体 开源 论文' })
  assert.match(added.note, /已加上「AI 前沿」/)
  let call = service.calls.filter(([name, request]) => name === 'saveSettings' && request.categories !== undefined).pop()
  const created = call[1].categories.find((item) => item.name === 'AI 前沿')
  assert.equal(created.keywords, '大模型 智能体 开源 论文')

  const changed = await tool.execute({ action: 'keywords', name: '科技', keywords: 'AI 芯片 大模型' })
  assert.match(changed.note, /「科技」的搜索关键词：AI 芯片 大模型/)
  call = service.calls.filter(([name, request]) => name === 'saveSettings' && request.categories !== undefined).pop()
  assert.equal(call[1].categories.find((item) => item.id === 'tech').keywords, 'AI 芯片 大模型')

  const cleared = await tool.execute({ action: 'keywords', name: '科技', keywords: '' })
  assert.match(cleared.note, /已清空「科技」的关键词/)
  await assert.rejects(() => tool.execute({ action: 'keywords', name: '科技' }), /需要 keywords/)
})

test('news_focus：设置与清空额外关注', async () => {
  const ctx = fakeCtx()
  const service = fakeService()
  registerTools(ctx, service)
  const tool = ctx.registered.get('news_focus')

  const set = await tool.execute({ text: '重点盯 AI 圈动态与新技术发布' })
  assert.equal(set.focus, '重点盯 AI 圈动态与新技术发布')
  assert.equal(service.calls.pop()[1].focus, '重点盯 AI 圈动态与新技术发布')

  const cleared = await tool.execute({ text: '' })
  assert.equal(cleared.focus, '')
  assert.match(cleared.note, /已清空/)
  await assert.rejects(() => tool.execute({}), /缺少必填参数「text」/)
})

test('news_status：插件关着时会提示', async () => {
  const ctx = fakeCtx()
  const service = fakeService()
  service.status = async () => {
    const base = await fakeService().status()
    return { ...base, settings: { ...base.settings, enabled: false } }
  }
  registerTools(ctx, service)
  const result = await ctx.registered.get('news_status').execute({})
  assert.match(result.note, /新闻日报：关着/)
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
if (failed > 0) process.exit(1)
