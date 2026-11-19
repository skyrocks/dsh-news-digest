// 日报的渲染：一份结构化日报 → markdown（落盘给人看 / 给工具回读）。
// 纯函数，不碰文件，方便单测。

const SOURCE_LABEL = {
  auto: '自动',
  schedule: '定时',
  'first-use': '上午第一次使用',
  manual: '手动',
  chat: '对话里',
}

export function sourceLabel(source) {
  return SOURCE_LABEL[source] ?? source
}

/** 本地时间（YYYY-MM-DD HH:mm），日报抬头用。 */
export function localStamp(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value ?? '')
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function reportTitle(date) {
  return `新闻日报 · ${date}`
}

/** 一组一条的「· 标题（来源）」行，空组不渲染。 */
function itemLines(group) {
  const lines = []
  for (const item of group.items) {
    const meta = [item.source, item.publishedAt].filter((value) => value !== '').join(' · ')
    lines.push(`- **${item.title}**${meta === '' ? '' : `（${meta}）`}`)
    if (item.summary !== '') lines.push(`  ${item.summary}`)
    if (item.url !== '') lines.push(`  <${item.url}>`)
  }
  return lines
}

/**
 * 把一份日报渲染成 markdown。
 * @param {object} report - normalizeReportBody 的结果
 */
export function renderMarkdown(report) {
  const lines = [`# ${report.title}`, '']
  const meta = [`生成于 ${localStamp(report.createdAt)}`, sourceLabel(report.source)]
  const items = report.groups.reduce((total, group) => total + group.items.length, 0)
  meta.push(`${report.groups.length} 个类别 / ${items} 条`)
  lines.push(`_${meta.join(' · ')}_`, '')

  if (report.overview !== '') {
    lines.push('## 一句话', '', report.overview, '')
  }

  if (report.focus.length > 0) {
    lines.push('## 值得先看', '')
    for (const entry of report.focus) {
      lines.push(`1. **${entry.title}**${entry.detail === '' ? '' : ` — ${entry.detail}`}`)
    }
    lines.push('')
  }

  for (const group of report.groups) {
    if (group.items.length === 0) continue
    lines.push(`## ${group.category}`, '')
    lines.push(...itemLines(group), '')
  }

  return `${lines.join('\n').trimEnd()}\n`
}

/** 一句话摘要（列表里显示）。 */
export function reportSummary(report) {
  if (report.overview !== '') return report.overview
  const first = report.focus[0]?.title ?? report.groups[0]?.items[0]?.title ?? ''
  return first
}

/**
 * 索引项：从正文里抽出列表要用的字段。
 * @param {object} report
 * @param {{ path?: string }} options
 */
export function reportEntry(report, options = {}) {
  return {
    id: report.id,
    date: report.date,
    title: report.title,
    createdAt: report.createdAt,
    overview: reportSummary(report).slice(0, 200),
    groups: report.groups.length,
    items: report.groups.reduce((total, group) => total + group.items.length, 0),
    source: report.source,
    path: options.path ?? '',
    unread: true,
  }
}
