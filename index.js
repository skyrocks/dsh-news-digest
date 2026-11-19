// Host 半（插件入口）：建新闻日报服务，挂工具，再挂「上午第一次使用」的触发。
//
// 设置和日报都在 $DSH_HOME/news-digest/ 下，不进 profile 的配置文件；
// 搜索本身由模型在触发回合里用 web_search 完成，插件不自己抓网页。
import { NewsDigestService } from './service.js'
import { registerTools } from './tools.js'
import { installFirstUseTrigger } from './trigger.js'

/** 要用 ctx.tools 注册工具，必须先声明依赖。 */
export const inject = ['tools']

export function apply(ctx, config) {
  const dir = typeof config?.dir === 'string' && config.dir !== '' ? config.dir : undefined
  const service = new NewsDigestService(ctx, dir === undefined ? {} : { dir })

  registerTools(ctx, service)
  installFirstUseTrigger(ctx, service)

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => service.dispose())
    // 升级后把计划任务的提示词刷新成当前版本（任务不存在时不动，尊重用户删掉的选择）。
    ctx.effect(() => {
      const timer = setTimeout(() => {
        void service.syncSchedule()
      }, 2000)
      return () => clearTimeout(timer)
    })
  }
}
