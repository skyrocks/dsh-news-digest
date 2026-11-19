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
