/**
 * e2e 冒烟入口：把 scripts/e2e-entry.ts 打成 Node 可执行的 ESM 后运行。
 *
 * 覆盖纯逻辑链路；预览服务只要在运行就顺带做一次 HTTP 冒烟
 * （HTML 是否返回、是否挂载 root 与入口脚本）。真实模型调用与真机能力
 * 无法在这里模拟，结果里会明确标注。
 */

import { build } from 'esbuild'
import { mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const cacheDir = path.join(root, 'node_modules/.cache/portal-e2e')
const outfile = path.join(cacheDir, 'e2e.mjs')

await mkdir(cacheDir, { recursive: true })
await build({
  entryPoints: [path.join(root, 'scripts/e2e-entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  define: { 'import.meta.env': '{"DEV":false}' },
  tsconfig: path.join(root, 'tsconfig.json'),
  logLevel: 'silent',
})

const mod = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
const results = mod.results

let failed = 0
let extra = 0
for (const item of results) {
  if (item.ok) {
    console.log(`[32m✓[0m ${item.name}`)
  } else {
    failed += 1
    console.log(`[31m✗[0m ${item.name}`)
    console.log(`    ${item.detail}`)
  }
}

/* ---------------------------- 预览冒烟 ---------------------------- */

const previewBase =
  process.env.PREVIEW_BASE ?? 'http://127.0.0.1:5173/preview/p_61f527aa45a4ac8d/'

try {
  const response = await fetch(previewBase, { signal: AbortSignal.timeout(5000) })
  const html = await response.text()
  const mounted = html.includes('id="root"')
  const entry =
    html.includes('/@vite/client') && /<script[^>]+type="module"/i.test(html)
  if (response.ok && mounted && entry) {
    extra += 1
    console.log(`[32m✓[0m 预览冒烟：${previewBase} 返回页面并挂载入口脚本`)
  } else {
    extra += 1
    failed += 1
    console.log(`[31m✗[0m 预览冒烟：页面异常（status=${response.status} mounted=${mounted} entry=${entry}）`)
  }

  // Vite 能把这些模块转译成 JS，说明页面与核心模块没有编译期问题
  const collect = async (dir) =>
    (await readdir(path.join(root, dir)))
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .map((file) => `${dir}/${file}`)
  const modules = [
    ...(await collect('src/app/pages')),
    ...(await collect('src/app/components')),
    ...(await collect('src/shared/portal')),
  ]
  let moduleFailures = 0
  for (const modulePath of modules) {
    const moduleResponse = await fetch(new URL(modulePath, previewBase), {
      signal: AbortSignal.timeout(5000),
    })
    extra += 1
    if (!moduleResponse.ok) {
      moduleFailures += 1
      failed += 1
      console.log(`[31m✗[0m 预览编译失败：${modulePath}（status=${moduleResponse.status}）`)
    }
  }
  if (moduleFailures === 0) {
    console.log(`[32m✓[0m 预览编译：${modules.length} 个页面与核心模块全部通过`)
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.log(`[33m·[0m 预览冒烟跳过（预览服务不可达：${message}）`)
}

console.log(`\n${results.length + extra - failed}/${results.length + extra} 项通过`)
if (failed > 0) process.exit(1)
