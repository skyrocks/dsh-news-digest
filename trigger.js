// 「每天上午第一次使用 DSH」的判定。
//
// 依据两个信号（任一先到就算，当天只算一次）：
//   1. 插件加载 —— 也就是 DSH 进程启动（打开应用）。桌面上就是「今天第一次打开 DSH」。
//   2. agent/inbox/inserted 里 source.kind === 'user' 的消息 —— 用户真正敲进去的第一条。
//      DSH 自己就用这个字段区分「真人输入」和「定时投递 / 注入的上下文」，
//      所以我们不会把计划任务、子代理、inject 的内容误当成「人在用」。
//
// 判定本身是纯函数（decideFirstUse），单测直接喂时间；这里只负责挂事件。
import { dayKey, inWindow } from './store.js'

/**
 * 今天要不要因为「第一次使用」触发一次新闻日报。
 * @param {{ settings: object, state: object, now: Date, hasTodayReport: boolean }} input
 * @returns {{ fire: boolean, day: string, reason: string, morning?: boolean }}
 */
export function decideFirstUse({ settings, state, now, hasTodayReport }) {
  const day = dayKey(now)
  if (settings?.enabled !== true) return { fire: false, day, reason: 'plugin-off' }
  if (settings?.firstUse?.enabled !== true) return { fire: false, day, reason: 'first-use-off' }
  if (state?.lastTriggerDay === day) return { fire: false, day, reason: 'already-triggered' }
  // 一个类别都没开时不必触发：runNow 会拒绝，只会把错误写进状态。
  if (!Array.isArray(settings.categories) || !settings.categories.some((item) => item?.enabled === true)) {
    return { fire: false, day, reason: 'no-category' }
  }
  if (hasTodayReport) return { fire: false, day, reason: 'report-exists' }

  const morning = inWindow(now, settings.firstUse.windowStart, settings.firstUse.windowEnd)
  if (!morning && settings.firstUse.backfill !== true) return { fire: false, day, reason: 'outside-window', morning }
  return { fire: true, day, reason: morning ? 'morning-window' : 'backfill', morning }
}

/** 投递之后等多久还没出报，才判定「这一轮大概率失败了」。日报一般 1–2 分钟出完。 */
export const RETRY_MIN_MS = 8 * 60 * 1000
/** 一天最多补跑几次，避免 provider 一直挂时无限重试烧 token。 */
export const MAX_RETRIES_PER_DAY = 3

/**
 * 「已经投递过、但今天仍然没有日报」→ 要不要自动补一次。
 * 只看事实：任务最后一次投递的时间、今天的日报、今天已经补过几次。
 * @param {{ lastDeliveredAt?: string, state?: object, now: Date, hasTodayReport: boolean }} input
 * @returns {{ retry: boolean, reason: string, day?: string, used?: number, next?: number }}
 */
export function retryDecision({ lastDeliveredAt, state, now, hasTodayReport }) {
  const day = dayKey(now)
  if (hasTodayReport) return { retry: false, reason: 'report-exists', day }
  const at = Date.parse(typeof lastDeliveredAt === 'string' ? lastDeliveredAt : '')
  if (!Number.isFinite(at)) return { retry: false, reason: 'no-delivery', day }
  if (dayKey(new Date(at)) !== day) return { retry: false, reason: 'not-today', day }
  if (now.getTime() - at < RETRY_MIN_MS) return { retry: false, reason: 'too-soon', day }
  const used = state?.retryDay === day ? Math.max(0, Number(state?.retryCount) || 0) : 0
  if (used >= MAX_RETRIES_PER_DAY) return { retry: false, reason: 'limit', day, used }
  return { retry: true, reason: 'no-report-after-delivery', day, used, next: used + 1 }
}

/**
 * 这条 inbox 消息算不算「人在用」。
 * 只认 source.kind === 'user'，并排掉子代理：子代理的任务消息也用 kind 'user' 投递，
 * 但那是模型派出去的活，不是人坐在前面。
 * @param {{ agent?: object, message?: object } | undefined} payload
 */
export function humanPrompt(payload) {
  if (payload === null || typeof payload !== 'object') return false
  const source = payload.message?.source
  if (source === null || source === undefined || source.kind !== 'user') return false
  const header = payload.agent?.session?.header
  if (header !== null && header !== undefined) {
    if (header.origin === 'subagent') return false
    if (typeof header.delegationDepth === 'number' && header.delegationDepth > 0) return false
  }
  return true
}

/**
 * 挂上两个触发信号。
 * @param {object} ctx - 插件上下文
 * @param {{ firstUseCheck: (kind: string) => Promise<unknown> }} service
 * @param {{ bootDelayMs?: number }} options
 */
export function installFirstUseTrigger(ctx, service, options = {}) {
  const delay = Number.isFinite(options.bootDelayMs) ? Math.max(0, options.bootDelayMs) : 3000

  // 1) 进程启动：稍等一下，让计划任务等宿主服务先就绪。
  ctx.effect(() => {
    const timer = setTimeout(() => {
      void service.firstUseCheck('boot')
    }, delay)
    return () => clearTimeout(timer)
  })

  // 2) 第一条真人消息：source.kind === 'user' 才算「人在用」。
  ctx.on('agent/inbox/inserted', (payload) => {
    if (!humanPrompt(payload)) return
    void service.firstUseCheck('prompt')
  })
}
