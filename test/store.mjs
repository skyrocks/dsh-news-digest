import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_ITEMS_PER_CATEGORY,
  FIXED_CATEGORIES,
  MAX_CUSTOM_CATEGORIES,
  clockToMinutes,
  createStore,
  dayKey,
  defaultCategories,
  inWindow,
  normalizeCategories,
  normalizeCategory,
  normalizeReportBody,
  normalizeSettings,
} from '../store.js'

const tests = []
const test = (name, fn) => tests.push({ name, fn })

test('默认类别：固定类别全在，自定义为空', () => {
  const list = defaultCategories()
  assert.equal(list.length, FIXED_CATEGORIES.length)
  assert.deepEqual(list.map((item) => item.id), FIXED_CATEGORIES.map((item) => item.id))
  assert.equal(list.every((item) => item.custom === false), true)
  assert.equal(list.filter((item) => item.enabled).map((item) => item.name).join(','), '国内,国际,财经,科技')
})

test('归一化类别：缺的固定类别补回来，顺序不变', () => {
  const list = normalizeCategories([{ id: 'tech', enabled: false }])
  assert.equal(list.length, FIXED_CATEGORIES.length)
  assert.equal(list[0].id, 'domestic')
  assert.equal(list.find((item) => item.id === 'tech').enabled, false)
  assert.equal(list.every((item) => item.custom === false), true)
})

test('自定义类别（其他）：中文名有稳定 id，可开关', () => {
  const list = normalizeCategories([{ name: 'AI', enabled: true }, { name: '加密货币', enabled: false }])
  const custom = list.filter((item) => item.custom)
  assert.equal(custom.length, 2)
  assert.equal(custom[0].id, 'ai')
  assert.equal(custom[0].name, 'AI')
  assert.equal(custom[0].enabled, true)
  assert.match(custom[1].id, /^c(-|$)/)
  assert.equal(custom[1].enabled, false)
})

test('自定义类别：同名去重、空名忽略、数量有上限', () => {
  const list = normalizeCategories([
    { name: 'AI' },
    { name: 'AI' },
    { name: '  ' },
    { name: null },
  ])
  assert.equal(list.filter((item) => item.custom).length, 1)

  const many = Array.from({ length: MAX_CUSTOM_CATEGORIES + 5 }, (_, index) => ({ name: `类别${index}` }))
  const capped = normalizeCategories(many)
  assert.equal(capped.filter((item) => item.custom).length, MAX_CUSTOM_CATEGORIES)
})

test('自定义类别：自动 id 不撞固定类别', () => {
  const list = normalizeCategories([{ name: 'tech' }])
  const custom = list.filter((item) => item.custom)
  assert.equal(custom.length, 1)
  assert.equal(custom[0].name, 'tech')
  assert.notEqual(custom[0].id, 'tech')
  assert.equal(list.find((item) => item.id === 'tech').custom, false)
  assert.equal(list.find((item) => item.id === 'tech').name, '科技')
})

test('自定义类别：tmp- 临时 id 落盘时换成正规 id', () => {
  const list = normalizeCategories([{ id: 'tmp-abc123', name: 'AI', enabled: true }])
  const custom = list.filter((item) => item.custom)
  assert.equal(custom.length, 1)
  assert.equal(custom[0].id, 'ai')
  assert.equal(custom[0].custom, true)
})

test('normalizeCategory：空名报错，id 不合法报错', () => {
  assert.throws(() => normalizeCategory({ name: '  ' }), /类别名不能为空/)
  assert.throws(() => normalizeCategory({ name: 'x', id: 'Bad Id!' }), /不合法/)
})

test('设置：坏字段退回默认值', () => {
  const settings = normalizeSettings({ enabled: 'nope', itemsPerCategory: 99, schedule: { at: '25:00' }, firstUse: { windowStart: 'x' } })
  assert.equal(settings.enabled, true)
  assert.equal(settings.itemsPerCategory, 10)
  assert.equal(settings.schedule.at, '08:00')
  assert.equal(settings.schedule.enabled, true)
  assert.equal(settings.firstUse.windowStart, '05:00')
  assert.equal(settings.firstUse.windowEnd, '12:00')
  assert.equal(settings.firstUse.backfill, true)
  assert.equal(settings.categories.length, FIXED_CATEGORIES.length)
})

test('设置：itemsPerCategory 下限与每类默认值', () => {
  assert.equal(normalizeSettings({ itemsPerCategory: 1 }).itemsPerCategory, 3)
  assert.equal(normalizeSettings({}).itemsPerCategory, DEFAULT_ITEMS_PER_CATEGORY)
})

test('dayKey / clockToMinutes / inWindow', () => {
  assert.equal(dayKey(new Date(2026, 10, 19, 7, 5)), '2026-11-19')
  assert.equal(clockToMinutes('08:00'), 480)
  assert.equal(clockToMinutes('8:00'), undefined)
  assert.equal(clockToMinutes('24:00'), undefined)

  const morning = new Date(2026, 10, 19, 9, 30)
  const afternoon = new Date(2026, 10, 19, 15, 0)
  assert.equal(inWindow(morning, '05:00', '12:00'), true)
  assert.equal(inWindow(afternoon, '05:00', '12:00'), false)
  // 跨零点窗口
  assert.equal(inWindow(new Date(2026, 10, 19, 23, 30), '22:00', '02:00'), true)
  assert.equal(inWindow(new Date(2026, 10, 19, 12, 0), '05:00', '12:00'), false)
})

test('store：设置 / 状态 / 日报的读写与覆盖', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nd-store-'))
  try {
    const store = createStore({ dir })
    const written = await store.writeSettings({ enabled: false, focus: 'AI 芯片' })
    assert.equal(written.enabled, false)
    assert.equal(written.focus, 'AI 芯片')

    const read = await store.readSettings()
    assert.equal(read.enabled, false)
    assert.equal(read.categories.length, FIXED_CATEGORIES.length)

    await store.writeState({ lastTriggerDay: '2026-11-19', lastTriggerKind: 'boot' })
    assert.equal((await store.readState()).lastTriggerKind, 'boot')

    const body = normalizeReportBody({
      date: '2026-11-19',
      overview: '今天的大事',
      groups: [{ category: '国内', items: [{ title: '标题一', url: 'https://example.com/a' }] }],
    })
    await store.writeReportBody(body)
    await store.writeReportText(body.id, '# md')
    assert.equal((await store.readReportBody('2026-11-19')).overview, '今天的大事')
    assert.equal(await store.readReportText('2026-11-19'), '# md')
    assert.equal(await store.readReportBody('not-a-date'), undefined)
    assert.match(await readFile(join(dir, 'settings.json'), 'utf8'), /"version": 1/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('store：坏 JSON 给出可读错误', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nd-store-bad-'))
  try {
    const store = createStore({ dir })
    await store.writeReportText('2026-11-19', 'x')
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'settings.json'), '{oops')
    await assert.rejects(store.readSettings(), /不是合法 JSON/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
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
