/* =============================================================================
 * App UI 构建/开发用的两个本地插件（与具体构建工具无关，可在 standalone 配置里复用）
 * ========================================================================== */

import type { Plugin } from 'vite'

/* -----------------------------------------------------------------------------
 * 开发期原生能力缺口上报（仅 dev）
 *
 * 浏览器预览里没有 App 壳：原生能力要么由 mock 模拟、要么根本没实现。
 * 桥接层（src/shared/bridge/dev-report.ts）把这两类情况 POST 到下面这个端点，
 * 由中间件打印到 DevServer 终端，提醒开发者「该能力必须到真机验证」。
 *
 * `apply: 'serve'` 保证只在 vite dev 装配；vite build 不会包含本插件，
 * 产物里也不会有任何上报逻辑。
 * -------------------------------------------------------------------------- */

const NATIVE_REPORT_PATH = '/__ai-builder/native-report'

interface NativeReportPayload {
  level?: 'notice' | 'warn'
  key?: string
  message?: string
  detail?: string
}

function formatNativeReport(payload: NativeReportPayload): string {
  const isWarn = payload.level === 'warn'
  return [
    `[native] ${isWarn ? '⚠ 原生能力缺口' : 'ℹ 预览环境提示'}：${payload.message ?? ''}`,
    payload.detail ? `         ${payload.detail}` : '',
    isWarn
      ? '         真机验证：该能力在 Web 预览里无法验证，请到 App 壳（真机）内测试。'
      : '         真机验收：预览返回的是模拟值，请到 App 壳（真机）内确认真实行为。',
  ]
    .filter(Boolean)
    .join('\n')
}

export function nativeDevReportPlugin(): Plugin {
  const printed = new Set<string>()
  return {
    name: 'ai-builder:native-dev-report',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(NATIVE_REPORT_PATH, (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        let body = ''
        req.setEncoding('utf8')
        req.on('data', (chunk: string) => {
          body += chunk
        })
        req.on('end', () => {
          res.statusCode = 204
          res.end()
          let payload: NativeReportPayload
          try {
            payload = JSON.parse(body) as NativeReportPayload
          } catch {
            return
          }
          const key = payload.key ?? payload.message
          // 同一条信息只打印一次，避免页面反复调用时刷屏
          if (!key || printed.has(key)) return
          printed.add(key)
          server.config.logger.warn(formatNativeReport(payload))
        })
      })
    },
  }
}

/* -----------------------------------------------------------------------------
 * 桥接 SDK 注入（仅构建 App UI，dev 不注入）
 *
 * 壳提供的桥接 SDK `/sdk/capsule.js` 只在壳内可达：浏览器 / 平台预览没有它，
 * 静态写在 index.html 里会 404。所以源工程 index.html 不引入它，改由本插件在构建时
 * 写进产物 HTML（`dist/client/web/index.html`）。
 *
 * 产物侧由 finalize-build.mjs 校验。
 * -------------------------------------------------------------------------- */

const CAPSULE_SDK_SRC = '/sdk/capsule.js'

/** 源码里若已写回该 `<script src>`，就不再重复注入 */
const CAPSULE_SDK_TAG = new RegExp(
  `<script\\b[^>]*\\bsrc\\s*=\\s*["']${CAPSULE_SDK_SRC.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`,
  'i',
)

export function capsuleSdkInjectPlugin(): Plugin {
  return {
    name: 'ai-builder:capsule-sdk-inject',
    apply: 'build',
    transformIndexHtml(html) {
      // 幂等：源码被改回静态引入时只保留它自己那一份，不叠第二条
      if (CAPSULE_SDK_TAG.test(html)) return []
      return [
        {
          tag: 'script',
          attrs: { src: CAPSULE_SDK_SRC },
          injectTo: 'body',
        },
      ]
    },
  }
}
