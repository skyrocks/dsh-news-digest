import assert from 'node:assert/strict'

import { decideFirstUse, humanPrompt } from '../trigger.js'
import { normalizeSettings } from '../store.js'

const tests = []
const test = (name, fn) => tests.push({ name, fn })

/** 固定一个「上午 09:30」的时刻，避免测试受本机时区/当前时间影响。 */
const morning = new Date(2026, 10, 19, 9, 30)
const afternoon = new Date(2026, 10, 19, 15, 0)

function settingsWith(patch = {}) {
  return normalizeSettings(patch)
}

test('上午窗口内、今天没出过、今天没触发过 → 触发', () => {
  const result = decideFirstUse({
    settings: settingsWith(),
    state: { lastTriggerDay: '' },
    now: morning,
    hasTodayReport: false,
  })
  assert.equal(result.fire, true)
  assert.equal(result.day, '2026-11-19')
  assert.equal(result.reason, 'morning-window')
})

test('当天已经触发过 → 不再触发（两个信号只算一次）', () => {
  const result = decideFirstUse({
    settings: settingsWith(),
    state: { lastTriggerDay: '2026-11-19', lastTriggerKind: 'boot' },
    now: morning,
    hasTodayReport: false,
  })
  assert.equal(result.fire, false)
  assert.equal(result.reason, 'already-triggered')
})

test('今天已经有日报 → 不触发', () => {
  const result = decideFirstUse({
    settings: settingsWith(),
    state: { lastTriggerDay: '' },
    now: morning,
    hasTodayReport: true,
  })
  assert.equal(result.fire, false)
  assert.equal(result.reason, 'report-exists')
})

test('插件关着 / 首次使用关着 → 不触发', () => {
  assert.equal(decideFirstUse({
    settings: settingsWith({ enabled: false }),
    state: {},
    now: morning,
    hasTodayReport: false,
  }).reason, 'plugin-off')

  assert.equal(decideFirstUse({
    settings: settingsWith({ firstUse: { enabled: false } }),
    state: {},
    now: morning,
    hasTodayReport: false,
  }).reason, 'first-use-off')
})

test('窗口外 + 不补 → 不触发；窗口外 + 补（默认）→ 触发', () => {
  const strict = decideFirstUse({
    settings: settingsWith({ firstUse: { backfill: false } }),
    state: {},
    now: afternoon,
    hasTodayReport: false,
  })
  assert.equal(strict.fire, false)
  assert.equal(strict.reason, 'outside-window')

  const backfill = decideFirstUse({
    settings: settingsWith(),
    state: {},
    now: afternoon,
    hasTodayReport: false,
  })
  assert.equal(backfill.fire, true)
  assert.equal(backfill.reason, 'backfill')
  assert.equal(backfill.morning, false)
})

test('自定义上午窗口生效', () => {
  const settings = settingsWith({ firstUse: { windowStart: '06:00', windowEnd: '07:00', backfill: false } })
  assert.equal(decideFirstUse({ settings, state: {}, now: morning, hasTodayReport: false }).fire, false)
  assert.equal(decideFirstUse({ settings, state: {}, now: new Date(2026, 10, 19, 6, 30), hasTodayReport: false }).fire, true)
})

test('一个类别都没开 → 不触发', () => {
  const settings = settingsWith()
  settings.categories = settings.categories.map((item) => ({ ...item, enabled: false }))
  const result = decideFirstUse({ settings, state: {}, now: morning, hasTodayReport: false })
  assert.equal(result.fire, false)
  assert.equal(result.reason, 'no-category')
})

test('昨天的触发记录不影响今天', () => {
  const result = decideFirstUse({
    settings: settingsWith(),
    state: { lastTriggerDay: '2026-11-18' },
    now: morning,
    hasTodayReport: false,
  })
  assert.equal(result.fire, true)
})

test('humanPrompt：只认真人输入，排掉子代理与定时投递', () => {
  const human = { agent: { session: { header: { id: 's1' } } }, message: { source: { kind: 'user' } } }
  assert.equal(humanPrompt(human), true)

  assert.equal(humanPrompt({ agent: { session: { header: {} } }, message: { source: { kind: 'schedule' } } }), false)
  assert.equal(humanPrompt({ agent: { session: { header: {} } }, message: { source: { kind: 'goal' } } }), false)
  assert.equal(humanPrompt({ agent: { session: { header: {} } }, message: {} }), false)
  assert.equal(humanPrompt(undefined), false)

  // 子代理：任务消息也是 kind 'user'，但不是人在用
  assert.equal(humanPrompt({ agent: { session: { header: { origin: 'subagent' } } }, message: { source: { kind: 'user' } } }), false)
  assert.equal(humanPrompt({ agent: { session: { header: { delegationDepth: 2 } } }, message: { source: { kind: 'user' } } }), false)
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
