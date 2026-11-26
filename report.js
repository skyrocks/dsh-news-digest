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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 自包含的 HTML 页面：通知点开后在浏览器里看这一份。
 * 只用 Canvas / CanvasText 两个系统色，亮暗都跟系统走，不依赖任何外部资源。
 * @param {object} report - normalizeReportBody 的结果
 */
export function renderReportHtml(report) {
  const items = report.groups.reduce((total, group) => total + group.items.length, 0)
  const meta = `${localStamp(report.createdAt)} · ${sourceLabel(report.source)} · ${report.groups.length} 个类别 / ${items} 条`

  const focus = report.focus.length === 0 ? '' : `
    <section><h2>值得先看</h2><ol class="focus">${report.focus.map((entry) => (
      `<li><b>${escapeHtml(entry.title)}</b>${entry.detail === '' ? '' : `<span>${escapeHtml(entry.detail)}</span>`}</li>`
    )).join('')}</ol></section>`

  const groups = report.groups.map((group) => `
    <section><h2>${escapeHtml(group.category)}</h2><ul class="items">${group.items.map((item) => (
      `<li><div class="title">${item.url === ''
        ? escapeHtml(item.title)
        : `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(item.title)}</a>`}</div>`
      + `${item.summary === '' ? '' : `<p class="sum">${escapeHtml(item.summary)}</p>`}`
      + `${item.source === '' && item.publishedAt === '' ? '' : `<div class="meta">${[escapeHtml(item.source), escapeHtml(item.publishedAt)].filter((value) => value !== '').join(' · ')}</div>`}`
      + '</li>'
    )).join('')}</ul></section>`).join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(report.title)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px 24px 64px; font: 15px/1.7 -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
         background: Canvas; color: CanvasText; }
  main { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 24px; margin: 0 0 6px; }
  .meta { font-size: 12px; opacity: .62; }
  .overview { margin: 18px 0 8px; padding: 14px 16px; border-radius: 10px; background: color-mix(in srgb, CanvasText 6%, Canvas); }
  section { margin-top: 26px; }
  h2 { font-size: 13px; letter-spacing: .06em; text-transform: uppercase; opacity: .55; margin: 0 0 10px; }
  ol.focus { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 10px; }
  ol.focus b { display: block; }
  ol.focus span { font-size: 13px; opacity: .7; }
  ul.items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
  ul.items li { padding-bottom: 13px; border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, Canvas); }
  ul.items li:last-child { border-bottom: 0; padding-bottom: 0; }
  .title { font-size: 15px; font-weight: 600; }
  .title a { color: inherit; text-decoration: none; }
  .title a:hover { text-decoration: underline; }
  .sum { margin: 4px 0 0; font-size: 13.5px; opacity: .78; }
  .meta { margin-top: 3px; }
  footer { margin-top: 40px; font-size: 11.5px; opacity: .45; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(report.title)}</h1>
  <div class="meta">${escapeHtml(meta)}</div>
  ${report.overview === '' ? '' : `<p class="overview">${escapeHtml(report.overview)}</p>`}
  ${focus}
  ${groups}
  <footer>由 DSH 新闻日报生成 · 只收录搜索到的真实链接</footer>
</main>
</body>
</html>
`
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
    htmlPath: options.htmlPath ?? '',
    unread: true,
  }
}
