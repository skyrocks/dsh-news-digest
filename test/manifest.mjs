import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { TYPERT } from '../typert.host.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFile(join(root, path), 'utf8')
const exists = (path) => existsSync(join(root, path))

const tests = []
const test = (name, fn) => tests.push({ name, fn })

const manifest = JSON.parse(await read('package.json'))

test('manifest：名字、版本、入口', () => {
  assert.equal(manifest.name, '@skyrocks/dsh-news-digest')
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.main, './index.js')
  assert.equal(manifest.dsh.manifestVersion, 1)
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dsh.client.immediately, true)
  assert.equal(manifest.license, 'MIT')
  assert.match(manifest.engines.dsh, /^>=0\.2\.2/)
})

test('manifest：exports 的目标文件都在', () => {
  for (const [key, target] of Object.entries(manifest.exports)) {
    if (target.includes('*')) continue
    assert.equal(exists(target), true, `exports["${key}"] → ${target} 不存在`)
  }
  assert.equal(manifest.exports['./typert'], './typert.host.js')
  assert.equal(manifest.exports['./client'], './client.js')
})

test('manifest：files 里每一项都能找到文件', () => {
  for (const entry of manifest.files) {
    if (entry.includes('*')) {
      const dir = dirname(entry)
      assert.equal(existsSync(join(root, dir)), true, `${dir} 不存在`)
      continue
    }
    assert.equal(exists(entry), true, `files 里的 ${entry} 不存在`)
  }
})

test('locale：中英文都有标题、描述和详情页；详情页里的图存在', async () => {
  for (const locale of ['zh', 'en']) {
    const value = JSON.parse(await read(`locale/${locale}.json`))
    assert.equal(typeof value.meta.title, 'string')
    assert.ok(value.meta.title.length > 0)
    assert.ok(value.meta.description.length > 30, `${locale} 的描述太短`)
    assert.equal(value.meta.detail, 'docs/DETAIL.md')
  }
  assert.equal(exists('docs/DETAIL.md'), true)
  assert.equal(exists('docs/preview.svg'), true)
  const detail = await read('docs/DETAIL.md')
  assert.match(detail, /!\[[^\]]+\]\(preview\.svg\)/)
})

test('icon：是 SVG 且不太大', async () => {
  const icon = await read('icon.svg')
  assert.match(icon, /^<svg[\s>]/)
  assert.match(icon, /viewBox="0 0 48 48"/)
  assert.ok(Buffer.byteLength(icon) < 256 * 1024)
  assert.match(icon, /aria-label="[^"]+"/)
})

test('TYPERT：包名、命名空间与 invocation id 一致', () => {
  assert.equal(TYPERT.package, manifest.name)
  assert.equal(TYPERT.face, 'host')
  const ids = new Set()
  for (const item of TYPERT.invocations) {
    assert.equal(item.service, 'newsDigest')
    assert.equal(item.namespace, 'newsDigest')
    assert.equal(item.id, `${manifest.name}#newsDigest/${item.method}`)
    assert.equal(ids.has(item.id), false)
    ids.add(item.id)
    assert.equal(item.invocation.kind, 'direct')
    assert.equal(item.result.mode, 'strict')
    assert.equal(typeof item.result.create, 'function')
  }
  assert.deepEqual([...ids].map((id) => id.split('/').pop()), ['status', 'saveSettings', 'report', 'reports', 'runNow'])
})

test('client：注册 id、远端声明与设置页入口一致', async () => {
  const client = await read('client.js')
  assert.match(client, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(client, /id: "@skyrocks\/dsh-news-digest"/)
  assert.match(client, /package: "@skyrocks\/dsh-news-digest"/)
  assert.match(client, /service: "newsDigest"/)
  assert.match(client, /slots\.inject\("settings\.section"/)
  assert.match(client, /id: "news-digest"/)
  assert.match(client, /label: \(\) => "新闻日报"/)
  assert.match(client, /exports\.inject = \["slots", "remote"\]/)
})

test('cordis.patch.yml 插入的插件名与包名一致', async () => {
  const patch = await read('cordis.patch.yml')
  assert.match(patch, /- id: news-digest/)
  assert.match(patch, /name: "@skyrocks\/dsh-news-digest"/)
})

test('README / CHANGELOG / LICENSE 都在', () => {
  for (const file of ['README.md', 'README.en.md', 'CHANGELOG.md', 'LICENSE', 'PUBLISHING.md']) {
    assert.equal(exists(file), true, `${file} 缺失`)
  }
})

test('Host 模块不依赖 profile 路径，源码都在 files 里', async () => {
  const manifestFiles = new Set(manifest.files)
  for (const file of ['index.js', 'service.js', 'store.js', 'report.js', 'schedule.js', 'trigger.js', 'tools.js', 'client.js', 'typert.host.js']) {
    assert.equal(manifestFiles.has(file), true, `${file} 不在 files 里`)
  }
  const index = await read('index.js')
  assert.doesNotMatch(index, /DSH_PROFILE_DIR|cordis\.patch\.yml/)
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
