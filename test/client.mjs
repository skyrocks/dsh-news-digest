// Client bundle 测试：用假的 window.__ModuleLoader__ 把 client.js 真跑一遍，
// 确认注册了「设置 → 新闻日报」这一节、远端声明覆盖服务侧的 5 个方法。
// 不渲染 React、不需要浏览器。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = await readFile(join(root, 'client.js'), 'utf8')

const tests = []
const test = (name, fn) => tests.push({ name, fn })

function loadBundle() {
  let exported = null
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(options) {
          assert.equal(options.id, '@skyrocks/dsh-news-digest')
          const fakeRequire = (specifier) => {
            assert.equal(specifier, 'react')
            return {}
          }
          exported = options.factory(fakeRequire)
        },
      },
    },
    console,
    document: undefined,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
  }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  assert.notEqual(exported, null, 'client.js 没有调用 __ModuleLoader__.load')
  return exported
}

test('client bundle：导出 apply / inject', () => {
  const bundle = loadBundle()
  assert.equal(typeof bundle.apply, 'function')
  assert.deepEqual([...bundle.inject], ['slots', 'remote'])
})

test('client bundle：apply 注册设置页并挂远端声明', async () => {
  const bundle = loadBundle()
  const registered = []
  const mounted = []
  let effectCount = 0
  const slots = {
    inject(owner, callback) {
      registered.push(owner)
      callback()
    },
    register(options) {
      registered.push(options)
    },
  }
  const ctx = {
    get(name) {
      if (name === 'slots') return slots
      return undefined
    },
    effect(fn) {
      effectCount += 1
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    remote: {
      async $mount(remote) {
        mounted.push(remote)
      },
    },
  }

  bundle.apply(ctx)
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(registered.includes('settings.section'), true)
  const section = registered.find((item) => typeof item === 'object' && item !== null && item.name === 'settings.section')
  assert.equal(section.id, 'news-digest')
  assert.equal(section.order, 46)
  assert.equal(section.label(), '新闻日报')
  assert.equal(typeof section, 'object')

  assert.equal(mounted.length, 1)
  const remote = mounted[0]
  assert.equal(remote.package, '@skyrocks/dsh-news-digest')
  assert.equal(remote.descriptors.map((item) => item.method).join(','), 'status,saveSettings,report,reports,runNow')
  for (const descriptor of remote.descriptors) {
    assert.equal(descriptor.service, 'newsDigest')
    assert.equal(descriptor.namespace, 'newsDigest')
    assert.equal(descriptor.id, `@skyrocks/dsh-news-digest#newsDigest/${descriptor.method}`)
    assert.equal(descriptor.invocation.kind, 'direct')
    assert.equal(descriptor.result.mode, 'strict')
  }
  assert.equal(remote.descriptors[0].parameters.length, 0)
  assert.equal(remote.descriptors[1].parameters.length, 1)
  assert.equal(effectCount > 0, true)
})

test('client bundle：只用主题变量，不引 primitives', () => {
  assert.doesNotMatch(source, /dsh-client-ui-primitives/)
  assert.doesNotMatch(source, /require\("@deepseek-ai/)
  // 允许「主题变量 + 兜底值」写法（var(--dsw-...,#hex)）与纯白 #fff；
  // 不允许别处出现自造色板。
  const withoutTokenFallbacks = source.replace(/var\(--[a-z0-9-]+,\s*#[0-9a-fA-F]{3,8}\)/g, '')
  const colorLiterals = withoutTokenFallbacks.match(/#[0-9a-fA-F]{3,8}/g) ?? []
  for (const literal of colorLiterals) {
    assert.equal(['#fff', '#ffffff'].includes(literal.toLowerCase()), true, `发现写死的颜色 ${literal}`)
  }
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
