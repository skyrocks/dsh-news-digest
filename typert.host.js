// Typert Host 清单：声明 newsDigest/* 的 direct 调用。
// 0.2.x 的 strict codec 必须是 `{ mode, typeSymbol, create() }`；这里不依赖 zod。
// Client 侧 client.js 有一份形状相同的声明。
//
// 校验刻意宽松：只保证「是不是对象 / 关键字段类型对不对」，
// 真正的业务校验在 service 里（它会给出人话错误）。

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function fail(field, expected) {
  throw new Error(`dsh-news-digest ${field}: 需要 ${expected}`)
}

function string(field, value, { optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return value
  if (typeof value !== 'string') fail(field, '字符串')
  return value
}

function codec(typeSymbol, parse) {
  return { mode: 'strict', typeSymbol, create: () => ({ parse }) }
}

const result = (name, parse) => codec(`@skyrocks/dsh-news-digest#NewsDigest${name}Result`, parse)
const parameter = (name, parse) => ({
  name,
  wire: name,
  source: 'json',
  codec: codec(`@skyrocks/dsh-news-digest#${name}`, parse),
})

const record = (value) => {
  if (!isRecord(value)) fail('result', '对象')
  return value
}

const parseStatus = (value) => {
  record(value)
  if (!isRecord(value.settings)) fail('result.settings', '对象')
  if (!Array.isArray(value.settings.categories)) fail('result.settings.categories', '数组')
  if (!isRecord(value.state)) fail('result.state', '对象')
  if (!Array.isArray(value.reports)) fail('result.reports', '数组')
  if (!isRecord(value.counts)) fail('result.counts', '对象')
  if (typeof value.hasToday !== 'boolean') fail('result.hasToday', '布尔值')
  if (typeof value.today !== 'string') fail('result.today', '字符串')
  return value
}

const parseSettingsRequest = (value) => {
  record(value)
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') fail('request.enabled', '布尔值')
  if (value.focus !== undefined) string('request.focus', value.focus)
  if (value.itemsPerCategory !== undefined && typeof value.itemsPerCategory !== 'number') fail('request.itemsPerCategory', '数字')
  if (value.categories !== undefined && !Array.isArray(value.categories)) fail('request.categories', '数组')
  if (value.firstUse !== undefined) record(value.firstUse)
  if (value.schedule !== undefined) record(value.schedule)
  if (value.cwd !== undefined) string('request.cwd', value.cwd)
  return value
}

const parseReportRequest = (value) => {
  record(value)
  if (!Array.isArray(value.groups)) fail('request.groups', '数组')
  if (value.overview !== undefined) string('request.overview', value.overview)
  if (value.focus !== undefined && !Array.isArray(value.focus)) fail('request.focus', '数组')
  if (value.date !== undefined) string('request.date', value.date)
  if (value.source !== undefined) string('request.source', value.source)
  return value
}

const parseReportsRequest = (value) => {
  record(value)
  if (value.action !== undefined) string('request.action', value.action)
  if (value.id !== undefined) string('request.id', value.id)
  if (value.limit !== undefined && typeof value.limit !== 'number') fail('request.limit', '数字')
  return value
}

const parseRunNowRequest = (value) => {
  record(value)
  if (value.kind !== undefined) string('request.kind', value.kind)
  if (value.cwd !== undefined) string('request.cwd', value.cwd)
  return value
}

const parseReportResult = (value) => {
  record(value)
  if (typeof value.saved !== 'boolean') fail('result.saved', '布尔值')
  if (typeof value.note !== 'string') fail('result.note', '字符串')
  return value
}

const parseReportsResult = (value) => {
  record(value)
  if (!Array.isArray(value.reports)) fail('result.reports', '数组')
  return value
}

const parseRunNow = (value) => {
  record(value)
  if (typeof value.ok !== 'boolean') fail('result.ok', '布尔值')
  return value
}

const invocation = (method, parameters, parseResult) => ({
  id: `@skyrocks/dsh-news-digest#newsDigest/${method}`,
  service: 'newsDigest',
  namespace: 'newsDigest',
  method,
  invocation: { kind: 'direct' },
  parameters,
  result: result(`${method[0].toUpperCase()}${method.slice(1)}`, parseResult),
})

const request = (parse) => [parameter('request', parse)]

export const TYPERT = {
  package: '@skyrocks/dsh-news-digest',
  face: 'host',
  schemas: [],
  invocations: [
    invocation('status', [], parseStatus),
    invocation('saveSettings', request(parseSettingsRequest), parseStatus),
    invocation('report', request(parseReportRequest), parseReportResult),
    invocation('reports', request(parseReportsRequest), parseReportsResult),
    invocation('runNow', request(parseRunNowRequest), parseRunNow),
  ],
  model: { services: [], events: [], objects: [] },
}
