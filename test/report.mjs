import assert from 'node:assert/strict'

import { normalizeReportBody, normalizeItem, normalizeGroup } from '../store.js'
import { renderMarkdown, reportEntry, reportSummary, sourceLabel } from '../report.js'

const tests = []
const test = (name, fn) => tests.push({ name, fn })

const sample = {
  date: '2026-11-19',
  overview: '今天有三件大事。',
  focus: [{ title: '芯片出口新规', detail: '影响面最大' }],
  groups: [
    {
      category: '国内',
      items: [
        { title: '标题一', summary: '一句概括', source: '新华社', url: 'https://example.com/a', publishedAt: '2026-11-19 08:10' },
        { title: '标题二', url: 'javascript:alert(1)' },
      ],
    },
    { category: '科技', items: [{ title: '标题三', source: 'The Verge' }] },
  ],
  source: 'schedule',
}

test('normalizeItem：标题必填，非 http(s) 链接丢掉', () => {
  assert.throws(() => normalizeItem({ title: '  ' }), /标题/)
  const item = normalizeItem({ title: '标题', url: 'javascript:alert(1)' })
  assert.equal(item.url, '')
  assert.equal(normalizeItem({ title: '标题', url: 'https://a.com/x' }).url, 'https://a.com/x')
})

test('normalizeGroup：单条坏掉不整组作废', () => {
  const group = normalizeGroup({ category: '财经', items: [{ title: '好' }, { title: '' }, null] })
  assert.equal(group.category, '财经')
  assert.equal(group.items.length, 1)
})

test('normalizeReportBody：默认值、日期校验、focus 上限', () => {
  const body = normalizeReportBody({ ...sample, focus: Array.from({ length: 9 }, (_, i) => ({ title: `重点${i}` })) })
  assert.equal(body.id, '2026-11-19')
  assert.equal(body.title, '新闻日报 · 2026-11-19')
  assert.equal(body.focus.length, 5)
  assert.equal(body.groups.length, 2)
  assert.equal(body.source, 'schedule')
  assert.throws(() => normalizeReportBody({ groups: [] }), /日期/)
})

test('normalizeReportBody：空组被丢掉', () => {
  const body = normalizeReportBody({ date: '2026-11-19', groups: [{ category: '体育', items: [] }, { category: '科技', items: [{ title: 'x' }] }] })
  assert.deepEqual(body.groups.map((group) => group.category), ['科技'])
})

test('renderMarkdown：小标题、重点、分组、链接都在', () => {
  const body = normalizeReportBody(sample)
  const text = renderMarkdown(body)
  assert.match(text, /^# 新闻日报 · 2026-11-19/m)
  assert.match(text, /## 一句话\n\n今天有三件大事。/)
  assert.match(text, /## 值得先看/)
  assert.match(text, /1\. \*\*芯片出口新规\*\* — 影响面最大/)
  assert.match(text, /## 国内/)
  assert.match(text, /\*\*标题一\*\*（新华社 · 2026-11-19 08:10）/)
  assert.match(text, /<https:\/\/example\.com\/a>/)
  assert.match(text, /定时/)
  assert.match(text, /2 个类别 \/ 3 条/)
  assert.doesNotMatch(text, /javascript:/)
})

test('reportEntry / reportSummary / sourceLabel', () => {
  const body = normalizeReportBody(sample)
  const entry = reportEntry(body, { path: '/tmp/x' })
  assert.equal(entry.groups, 2)
  assert.equal(entry.items, 3)
  assert.equal(entry.overview, '今天有三件大事。')
  assert.equal(entry.unread, true)
  assert.equal(entry.path, '/tmp/x')

  const bare = normalizeReportBody({ date: '2026-11-18', groups: [{ category: '体育', items: [{ title: '只有标题' }] }] })
  assert.equal(reportSummary(bare), '只有标题')
  assert.equal(sourceLabel('first-use'), '上午第一次使用')
  assert.equal(sourceLabel('something-new'), 'something-new')
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
