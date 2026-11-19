// 调度：把「每天出一份新闻日报」写进 DSH 的计划任务（ctx.schedule）。
//
// 为什么用计划任务而不是插件自己的定时器：搜索要模型调 web_search、再写摘要，
// 插件里没有模型；交给计划任务触发一次 Agent 回合，用的就是用户当前配的模型。
// 目标固定为「第一次触发时创建、之后复用同一个会话」，不会每天开新会话。
//
// 同一条任务同时承担两个触发源：
//   - 定时：按 daily 规则每天 HH:mm 投递；
//   - 上午第一次使用：插件发现是今天第一次用时，直接 run() 立即投递一次。
//     定时关掉时这条任务会被暂停（active=false），run() 仍然可用——所以只开
//     「首次使用」也能出报，而且「设置 → 定时任务」里只有一条，不会越积越多。
export const NEWS_TITLE = '新闻日报'

export const NEWS_PROMPT = [
  '[新闻日报] 现在出今天的实时新闻简报。',
  '',
  '1) 先调 news_status：拿到用户配的类别（含自定义的「其他」）、每类要几条、今天是否已经出过。',
  '   - 插件关着（enabled=false）：只回一句「新闻日报已经关掉了，这次不出报」并结束，不要搜索。',
  '   - hasToday=true：只回一句「今天已经出过新闻日报」并结束，不要搜索、不要重复写。',
  '   - 一个类别都没开：请用户到「设置 → 新闻日报」勾选类别，然后结束。',
  '2) 对每个开启的类别各用 web_search 搜一次：查询词 = 类别名 + 今天的日期（类别有 keywords 就一起带上）。',
  '   如果 news_status 里有「额外关注」：先判断它和已开启的类别是不是同一主题（例如额外关注写「AI 圈」、',
  '   类别里已经有「AI 前沿」）——是的话就并进那次搜索、别重复搜；只有它另有所指时才单独再搜一次。',
  '   AI / 科技这类可以再用英文关键词补搜一次（例如 "AI news today"、"LLM release"），拿一手来源。',
  '   只看最近 24–48 小时的新闻；同一件事不要在多组里重复列。',
  '3) 每条记下：标题、一两句概括、来源媒体、原始链接、发布时间。只写搜到的，不要编造标题/链接/日期。',
  '4) 用 news_report 保存今天这一份（source 传 "auto"）：overview 一句话总览；groups 按类别分组；focus 写 1–5 条最值得先看的。',
  '   某个类别今天确实没有合适的，就在结果里说明，不要拿旧闻凑数。',
  '5) 最后用两三句话回复：今天最值得看的是哪几条、来自哪里；完整日报已经存好。',
  '',
  '约束：只读网页；中文输出；链接必须是搜索结果里的真实地址。',
].join('\n')

/** 取可选的计划任务服务；没有就返回 undefined（例如 headless 组合）。 */
export function scheduleService(ctx) {
  try {
    const service = typeof ctx.get === 'function' ? ctx.get('schedule') : undefined
    return service !== undefined && service !== null && typeof service.create === 'function' ? service : undefined
  } catch {
    return undefined
  }
}

/** 本机时区，写成 IANA 名字（每天几点这种规则要它）。 */
export function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** 每天 HH:mm 的规则。 */
export function dailyTiming(at) {
  const raw = typeof at === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(at) ? at : '08:00'
  return { kind: 'daily', daily: { time: `${raw}:00`, time_zone: localTimeZone() } }
}

/**
 * 建好或更新那条「新闻日报」计划任务。
 * @param {object} ctx
 * @param {{ scheduleId?: string, at?: string, enabled?: boolean, cwd?: string }} options
 * @returns {Promise<{ supported: boolean, scheduleId?: string, error?: string }>}
 */
export async function ensureSchedule(ctx, options = {}) {
  const schedule = scheduleService(ctx)
  if (schedule === undefined) {
    return { supported: false, error: '这台 DSH 没有定时任务功能，自动出报用不了。' }
  }
  const timing = dailyTiming(options.at)
  const active = options.enabled !== false
  const existing = typeof options.scheduleId === 'string' ? options.scheduleId : ''

  if (existing !== '') {
    try {
      const result = await schedule.edit({
        id: existing,
        action: 'update',
        patch: { title: NEWS_TITLE, prompt: NEWS_PROMPT, timing, active },
      })
      if (result !== undefined && result.code === 'schedule_not_found') {
        // 用户把任务删了，下面重新建一个。
      } else {
        return { supported: true, scheduleId: existing }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const created = await createSchedule(schedule, timing, options.cwd, active)
      return created.error === undefined ? created : { ...created, error: `${reason}；${created.error}` }
    }
  }

  return createSchedule(schedule, timing, options.cwd, active)
}

async function createSchedule(schedule, timing, cwd, active) {
  try {
    const entry = await schedule.create({
      title: NEWS_TITLE,
      prompt: NEWS_PROMPT,
      timing,
      // new_once：第一次触发时创建一个会话，之后每次都投递到同一个会话。
      target: { kind: 'new_once', create: typeof cwd === 'string' && cwd !== '' ? { cwd } : {} },
    })
    const id = entry?.id ?? entry?.record?.id ?? ''
    if (typeof id !== 'string' || id === '') {
      return { supported: true, error: '定时任务建了，但没拿到 id；到「设置 → 定时任务」里确认一下。' }
    }
    if (!active) {
      try {
        await schedule.edit({ id, action: 'update', patch: { active: false } })
      } catch {
        // 暂停失败不影响任务本身；下次保存设置会再试
      }
    }
    return { supported: true, scheduleId: id }
  } catch (error) {
    return { supported: true, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 立刻投递一次（不动定时的那一次）。
 * @param {object} ctx
 * @param {string} scheduleId
 * @returns {Promise<{ ok: boolean, pending?: boolean, missing?: boolean, error?: string }>}
 */
export async function runSchedule(ctx, scheduleId) {
  const schedule = scheduleService(ctx)
  if (schedule === undefined || typeof scheduleId !== 'string' || scheduleId === '') {
    return { ok: false, error: '这台 DSH 没有定时任务功能。' }
  }
  try {
    const result = await schedule.run({ id: scheduleId })
    const code = result?.code ?? ''
    if (code === 'schedule_not_found') return { ok: false, missing: true, error: '计划任务不见了。' }
    if (code === 'schedule_execution_pending') return { ok: true, pending: true }
    if (code !== '') return { ok: false, error: `计划任务拒绝了这次投递（${code}）。` }
    return { ok: true, pending: false }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 删掉那条任务（用户彻底关掉插件或卸装时用）。 */
export async function removeSchedule(ctx, scheduleId) {
  const schedule = scheduleService(ctx)
  if (schedule === undefined || typeof scheduleId !== 'string' || scheduleId === '') return { removed: false }
  try {
    await schedule.edit({ id: scheduleId, action: 'delete' })
    return { removed: true }
  } catch {
    return { removed: false }
  }
}
