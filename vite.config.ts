/**
 * App UI（移动端 H5）的开发与构建配置。
 *
 * dev：一个 DevServer 同时服务两个入口 —— `/`（App UI）、`/admin.html`（Admin UI）。
 *      壳应用做真机预览时直接连这个 DevServer，所以 Admin UI 不需要单独起服务。
 * build：只产出 App UI，输出到 `dist/client/web/`（`capsule/manifest.json` 的 `entry` 指向它）；
 *      同级的 `manifest.json` / `signing/` / `icon/` 由 scripts/finalize-build.mjs 从 capsule/ 补齐。
 *
 * 这个配置依赖平台提供的 `stepai-vite-config`（开发预览 / 源码定位 / 元素点选 / 错误采集）。
 * 不依赖该包的独立构建请用 `vite.config.standalone.ts`。
 */

import { defineConfig } from 'stepai-vite-config'
import { fromRoot, sharedViteConfig } from './vite.shared'
import { capsuleSdkInjectPlugin, nativeDevReportPlugin } from './vite.plugins'

export default defineConfig({
  outputDir: 'dist/client/web',
  vite: {
    ...sharedViteConfig,
    plugins: [
      ...(sharedViteConfig.plugins ?? []),
      nativeDevReportPlugin(),
      capsuleSdkInjectPlugin(),
    ],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: false,
      allowedHosts: true,
      // 关闭 Vite 的错误浮层：预览在平台 UI 里渲染，浮层会被当成平台界面的一部分，
      // 污染用户看到的效果；构建 / 运行错误仍照常打到 DevServer 终端。
      hmr: { overlay: false },
    },
    build: {
      ...sharedViteConfig.build,
      rollupOptions: {
        // 单入口：Admin UI 由 vite.config.admin.ts 单独构建，两边不共享 chunk
        input: { app: fromRoot('./index.html') },
      },
    },
  },
  sourceLocator: true,
  previewRuntime: true,
  errorCollector: true,
  context: {
    projectId: process.env.STEPAI_PROJECT_ID ?? 'ai-builder-app',
    sessionId: process.env.STEPAI_SESSION_ID ?? 'local-preview',
    commitSha: process.env.STEPAI_COMMIT_SHA ?? 'baseline',
    hostOrigin: process.env.STEPAI_HOST_ORIGIN ?? 'http://127.0.0.1:4173',
  },
})
