// 本地存储层：纯文件逻辑，不依赖 Cordis / DSH 服务，方便单测。
//
// 目录布局（$DSH_HOME/news-digest/）：
//   settings.json  - 类别、每天几点、首次使用开关、上午窗口
//   state.json     - 当天是否已经触发过（首次使用去重的依据）
//   reports.json   - 日报索引
//   reports/<日期>.json / .md - 每份日报的正文与可读版本
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** 固定类别：用户可以开关，但不能删。 */
export const FIXED_CATEGORIES = [
  { id: 'domestic', name: '国内', enabled: true },
  { id: 'world', name: '国际', enabled: true },
  { id: 'business', name: '财经', enabled: true },
  { id: 'tech', name: '科技', enabled: true },
  { id: 'sports', name: '体育', enabled: false },
  { id: 'entertainment', name: '娱乐', enabled: false },
  { id: 'society', name: '社会', enabled: false },
  { id: 'health', name: '健康', enabled: false },
]

export const DEFAULT_ITEMS_PER_CATEGORY = 5
export const MIN_ITEMS_PER_CATEGORY = 3
export const MAX_ITEMS_PER_CATEGORY = 10
export const MAX_CUSTOM_CATEGORIES = 12

/** 定时与首次使用的默认值。 */
export const DEFAULT_SCHEDULE_AT = '08:00'
export const DEFAULT_WINDOW_START = '05:00'
export const DEFAULT_WINDOW_END = '12:00'

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,40}$/
/** 设置页草稿用的临时 id；不应该留在磁盘上。 */
const TEMP_ID_PATTERN = /^tmp-/
const CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** DSH home：显式 $DSH_HOME 优先，与 dsh-home-paths 的约定一致。 */
export function dshHome() {
  const configured = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  return configured.length > 0 ? resolve(configured) : join(homedir(), '.dsh')
}

/** 默认数据目录。 */
export function defaultDir() {
  return join(dshHome(), 'news-digest')
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

function asNumber(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function asBool(value, fallback) {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function clip(value, limit) {
  const text = asString(value)
  return text.length <= limit ? text : text.slice(0, limit)
}

/** 本地日期（YYYY-MM-DD），「今天」一律按本机时区算。 */
export function dayKey(date = new Date()) {
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 一天里的第几分钟，用来判断「上午窗口」。 */
export function minuteOfDay(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes()
}

/** "HH:mm" → 分钟；不合法返回 undefined。 */
export function clockToMinutes(value) {
  if (typeof value !== 'string' || !CLOCK_PATTERN.test(value)) return undefined
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

/**
 * 当前时刻是否落在窗口内。窗口支持跨零点（start > end）。
 * @param {Date} now
 * @param {string} start - "HH:mm"
 * @param {string} end - "HH:mm"
 */
export function inWindow(now, start, end) {
  const from = clockToMinutes(start)
  const to = clockToMinutes(end)
  if (from === undefined || to === undefined || from === to) return true
  const at = minuteOfDay(now)
  return from < to ? at >= from && at < to : at >= from || at < to
}

/** 把名字压成 id；中文名拿不到 ascii，就给它一个稳定的短 id。 */
export function slugify(name) {
  const ascii = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return ascii.length > 0 ? ascii : ''
}

/** 自定义类别 id：优先用名字里的 ascii，没有就用 c-<序号>。 */
function customId(name, taken) {
  const base = slugify(name)
  const seed = base === '' ? 'c' : base
  let id = seed
  let index = 2
  while (taken.has(id)) {
    id = `${seed}-${index}`
    index += 1
  }
  return id
}

/**
 * 校验一个类别。固定类别传 custom=false。
 * @param {unknown} input
 * @param {{ taken?: Set<string>, custom?: boolean, fallbackEnabled?: boolean }} options
 */
export function normalizeCategory(input, options = {}) {
  const value = input === null || typeof input !== 'object' || Array.isArray(input) ? {} : input
  const name = clip(value.name, 20)
  if (name === '') throw new Error('类别名不能为空。')
  const taken = options.taken instanceof Set ? options.taken : new Set()
  const custom = options.custom === true
  let id = asString(value.id)
  if (id === '') {
    id = custom ? customId(name, taken) : (slugify(name) || 'c')
  }
  if (!ID_PATTERN.test(id)) throw new Error(`类别 id「${id}」不合法：只能用小写字母、数字、- 和 _。`)
  if (taken.has(id)) throw new Error(`已经有 id 为「${id}」的类别了。`)
  const fallbackEnabled = options.fallbackEnabled === true
  return {
    id,
    name,
    keywords: clip(value.keywords, 100),
    enabled: asBool(value.enabled, fallbackEnabled),
    custom,
  }
}

/** 默认类别表：固定类别按默认开关，用户自定义的一个都没有。 */
export function defaultCategories() {
  return FIXED_CATEGORIES.map((item) => ({ ...item, keywords: '', custom: false }))
}

/**
 * 归一化类别表：固定类别一定在（缺失就补默认），自定义类别最多 12 个。
 * @param {unknown} input
 */
export function normalizeCategories(input) {
  const raw = (Array.isArray(input) ? input : []).filter(
    (item) => item !== null && typeof item === 'object' && !Array.isArray(item),
  )
  const consumed = new Set()
  const out = []
  const taken = new Set()

  // 固定类别：顺序固定，缺了补默认值。
  for (const fixed of FIXED_CATEGORIES) {
    const stored = raw.find((item) => !consumed.has(item) && asString(item.id) === fixed.id)
    if (stored !== undefined) consumed.add(stored)
    taken.add(fixed.id)
    out.push({
      id: fixed.id,
      name: stored !== undefined && asString(stored.name) !== '' ? clip(stored.name, 20) : fixed.name,
      keywords: stored === undefined ? '' : clip(stored.keywords, 100),
      enabled: stored === undefined ? fixed.enabled : asBool(stored.enabled, fixed.enabled),
      custom: false,
    })
  }

  // 自定义类别（「其他」）：保持用户给的顺序，最多 12 个。
  const customSeen = new Set()
  for (const stored of raw) {
    if (consumed.has(stored)) continue
    if (out.filter((item) => item.custom).length >= MAX_CUSTOM_CATEGORIES) break
    const name = clip(stored.name, 20)
    if (name === '') continue
    const key = name.toLowerCase()
    if (customSeen.has(key)) continue
    customSeen.add(key)
    let id = asString(stored.id)
    // 设置页新加的类别先用 tmp- 临时 id，落盘时换成按名字生成的正规 id。
    if (id === '' || TEMP_ID_PATTERN.test(id) || !ID_PATTERN.test(id) || taken.has(id)) id = customId(name, taken)
    taken.add(id)
    out.push({
      id,
      name,
      keywords: clip(stored.keywords, 100),
      enabled: asBool(stored.enabled, true),
      custom: true,
    })
  }

  return out
}

/** 定时设置。 */
export function normalizeSchedule(input) {
  const value = input === null || typeof input !== 'object' || Array.isArray(input) ? {} : input
  const rawAt = asString(value.at)
  return {
    enabled: asBool(value.enabled, true),
    at: CLOCK_PATTERN.test(rawAt) ? rawAt : DEFAULT_SCHEDULE_AT,
    scheduleId: asString(value.scheduleId),
    lastError: clip(value.lastError, 200),
  }
}

/** 首次使用设置。 */
export function normalizeFirstUse(input) {
  const value = input === null || typeof input !== 'object' || Array.isArray(input) ? {} : input
  const start = asString(value.windowStart)
  const end = asString(value.windowEnd)
  return {
    enabled: asBool(value.enabled, true),
    windowStart: CLOCK_PATTERN.test(start) ? start : DEFAULT_WINDOW_START,
    windowEnd: CLOCK_PATTERN.test(end) ? end : DEFAULT_WINDOW_END,
    backfill: asBool(value.backfill, true),
  }
}

/** 完整设置；任何字段坏了都退回默认值，而不是把整个文件判死。 */
export function normalizeSettings(input) {
  const value = input === null || typeof input !== 'object' || Array.isArray(input) ? {} : input
  const items = Math.round(asNumber(value.itemsPerCategory, DEFAULT_ITEMS_PER_CATEGORY))
  return {
    version: 1,
    enabled: asBool(value.enabled, true),
    categories: normalizeCategories(value.categories),
    focus: clip(value.focus, 300),
    itemsPerCategory: Math.min(Math.max(MIN_ITEMS_PER_CATEGORY, items), MAX_ITEMS_PER_CATEGORY),
    schedule: normalizeSchedule(value.schedule),
    firstUse: normalizeFirstUse(value.firstUse),
  }
}

/** 当天触发记录。 */
export function normalizeState(input) {
  const value = input === null || typeof input !== 'object' || Array.isArray(input) ? {} : input
  return {
    version: 1,
    lastTriggerDay: asString(value.lastTriggerDay),
    lastTriggerAt: asString(value.lastTriggerAt),
    lastTriggerKind: asString(value.lastTriggerKind),
    lastTriggerError: clip(value.lastTriggerError, 200),
    retryDay: asString(value.retryDay),
    retryCount: Math.max(0, Math.min(9, Math.round(asNumber(value.retryCount, 0)))),
  }
}

function httpUrl(value) {
  const text = clip(value, 500)
  return /^https?:\/\//i.test(text) ? text : ''
}

/** 日报里的一条新闻。 */
export function normalizeItem(input) {
  const value = input === null || typeof input !== 'object' || Array.isArray(input) ? {} : input
  const title = clip(value.title, 200)
  if (title === '') throw new Error('每条新闻都要有标题。')
  return {
    title,
    summary: clip(value.summary, 400),
    source: clip(value.source, 60),
    url: httpUrl(value.url),
    publishedAt: clip(value.publishedAt, 40),
  }
}

/** 日报里的一组（一个类别）。 */
export function normalizeGroup(input) {
  const value = input === null || typeof input !== 'object' || Array.isArray(input) ? {} : input
  const category = clip(value.category, 20)
  if (category === '') throw new Error('每组都要写类别名。')
  const raw = Array.isArray(value.items) ? value.items : []
  const items = []
  for (const entry of raw) {
    if (items.length >= 20) break
    try {
      items.push(normalizeItem(entry))
    } catch {
      // 单条坏了跳过，不整组作废
    }
  }
  return { category, items }
}

/** 日报正文。 */
export function normalizeReportBody(input, options = {}) {
  const value = input === null || typeof input !== 'object' || Array.isArray(input) ? {} : input
  const date = asString(value.date)
  if (!DATE_PATTERN.test(date)) throw new Error('日报缺日期（YYYY-MM-DD）。')
  const rawFocus = Array.isArray(value.focus) ? value.focus : []
  const focus = []
  for (const entry of rawFocus) {
    if (focus.length >= 5) break
    const title = clip(typeof entry === 'string' ? entry : entry?.title, 120)
    if (title === '') continue
    focus.push({ title, detail: clip(typeof entry === 'string' ? '' : entry?.detail, 300) })
  }
  const rawGroups = Array.isArray(value.groups) ? value.groups : []
  const groups = []
  for (const entry of rawGroups) {
    if (groups.length >= 20) break
    try {
      const group = normalizeGroup(entry)
      if (group.items.length > 0) groups.push(group)
    } catch {
      // 忽略坏组
    }
  }
  return {
    id: date,
    date,
    title: clip(value.title, 120) || `新闻日报 · ${date}`,
    createdAt: asString(value.createdAt) || new Date().toISOString(),
    overview: clip(value.overview, 400),
    focus,
    groups,
    source: asString(options.source ?? value.source) || 'manual',
    auto: options.auto === true || value.auto === true,
  }
}

/** 索引里的一项（列表用，不带正文）。 */
export function normalizeReportEntry(input) {
  const value = input === null || typeof input !== 'object' || Array.isArray(input) ? {} : input
  const id = asString(value.id)
  if (id === '') throw new Error('日报索引项缺 id。')
  const date = DATE_PATTERN.test(asString(value.date)) ? asString(value.date) : id
  return {
    id,
    date,
    title: clip(value.title, 120) || `新闻日报 · ${date}`,
    createdAt: asString(value.createdAt) || new Date().toISOString(),
    overview: clip(value.overview, 200),
    groups: Math.max(0, asNumber(value.groups, 0)),
    items: Math.max(0, asNumber(value.items, 0)),
    source: asString(value.source) || 'manual',
    path: asString(value.path),
    htmlPath: asString(value.htmlPath),
    unread: value.unread !== false,
  }
}

/**
 * 本地文件读写。
 * @param {{ dir?: string }} options - dir 覆盖默认位置（测试用）。
 */
export function createStore(options = {}) {
  const dir = typeof options.dir === 'string' && options.dir.length > 0 ? resolve(options.dir) : defaultDir()
  const paths = {
    settings: join(dir, 'settings.json'),
    state: join(dir, 'state.json'),
    reports: join(dir, 'reports.json'),
    reportsDir: join(dir, 'reports'),
  }

  async function readJson(path, fallback) {
    let text
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return fallback
      throw error
    }
    if (text.trim() === '') return fallback
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`${path} 不是合法 JSON，先修好这个文件再继续。`)
    }
  }

  /** 原子写：先写临时文件再 rename，避免半截文件。 */
  async function writeJson(path, value) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const temporary = `${path}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, path)
  }

  async function readSettings() {
    return normalizeSettings(await readJson(paths.settings, {}))
  }

  async function writeSettings(settings) {
    const normalized = normalizeSettings(settings)
    await writeJson(paths.settings, normalized)
    return normalized
  }

  async function readState() {
    return normalizeState(await readJson(paths.state, {}))
  }

  async function writeState(state) {
    const normalized = normalizeState(state)
    await writeJson(paths.state, normalized)
    return normalized
  }

  async function readReports() {
    const parsed = await readJson(paths.reports, {})
    const list = Array.isArray(parsed?.reports) ? parsed.reports : []
    const out = []
    for (const item of list) {
      try {
        out.push(normalizeReportEntry(item))
      } catch {
        // 坏条目跳过
      }
    }
    return out
  }

  async function writeReports(reports) {
    const list = []
    for (const item of Array.isArray(reports) ? reports : []) {
      try {
        list.push(normalizeReportEntry(item))
      } catch {
        // 坏条目跳过
      }
    }
    await writeJson(paths.reports, { version: 1, reports: list })
    return list
  }

  async function readReportBody(id) {
    if (!DATE_PATTERN.test(id)) return undefined
    const parsed = await readJson(join(paths.reportsDir, `${id}.json`), undefined)
    if (parsed === undefined) return undefined
    return normalizeReportBody(parsed)
  }

  async function writeReportBody(report) {
    const body = normalizeReportBody(report)
    await writeJson(join(paths.reportsDir, `${body.id}.json`), body)
    return body
  }

  async function writeReportText(id, text) {
    await mkdir(paths.reportsDir, { recursive: true, mode: 0o700 })
    const path = join(paths.reportsDir, `${id}.md`)
    const temporary = `${path}.${process.pid}.tmp`
    await writeFile(temporary, text, { mode: 0o600 })
    await rename(temporary, path)
    return path
  }

  async function writeReportHtml(id, html) {
    await mkdir(paths.reportsDir, { recursive: true, mode: 0o700 })
    const path = join(paths.reportsDir, `${id}.html`)
    const temporary = `${path}.${process.pid}.tmp`
    await writeFile(temporary, html, { mode: 0o600 })
    await rename(temporary, path)
    return path
  }

  async function readReportHtml(id) {
    if (!DATE_PATTERN.test(id)) return ''
    try {
      return await readFile(join(paths.reportsDir, `${id}.html`), 'utf8')
    } catch {
      return ''
    }
  }

  async function readReportText(id) {
    if (!DATE_PATTERN.test(id)) return ''
    try {
      return await readFile(join(paths.reportsDir, `${id}.md`), 'utf8')
    } catch {
      return ''
    }
  }

  return {
    dir,
    paths,
    readSettings,
    writeSettings,
    readState,
    writeState,
    readReports,
    writeReports,
    readReportBody,
    writeReportBody,
    writeReportText,
    readReportText,
    writeReportHtml,
    readReportHtml,
  }
}
