/**
 * 不依赖平台 `stepai-vite-config` 的独立构建配置。
 *
 * 用途：开源用户在本地开发 / 构建 H5 产物，不需要安装平台内部的 tgz 依赖。
 *
 *   npm run dev:standalone     # 本地开发预览
 *   npm run build:standalone   # 只产出 dist/client/web（不含签名与壳侧清单）
 *
 * 与平台构建的差异：没有源码定位、元素点选、预览上下文与错误采集插件。
 * 业务代码、沙箱、生成器与 UI 完全一致。
 * 需要完整壳侧 bundle（含 signing/、manifest.json）时，仍需平台的
 * `npm run build`（它会调用 finalize-build 并生成调试签名）。
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
