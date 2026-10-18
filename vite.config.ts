/**
 * App UI（移动端 H5）的默认开发与构建配置。
 *
 * 不依赖任何平台内部包：开源用户 `npm install` 后直接 `npm run dev` /
 * `npm run build` 即可。构建输出 `dist/client/web/`，随后由
 * scripts/finalize-build.mjs 补齐 manifest / icon / signing。
 *
 * 需要平台预览能力（源码定位、元素点选、预览上下文、错误采集）时，
 * 使用 `npm run dev:platform` / `npm run build:platform`（vite.config.platform.ts，
 * 依赖可选的 `stepai-vite-config`）。
 */

import { defineConfig } from 'vite'

import { fromRoot, sharedViteConfig } from './vite.shared'
import { capsuleSdkInjectPlugin, nativeDevReportPlugin } from './vite.plugins'

export default defineConfig({
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
    hmr: { overlay: false },
  },
  build: {
    ...sharedViteConfig.build,
    outDir: 'dist/client/web',
    emptyOutDir: true,
    rollupOptions: {
      input: { app: fromRoot('./index.html') },
    },
  },
})
