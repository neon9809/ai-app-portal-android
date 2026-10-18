/**
 * 应用级常量。脚手架生成工程时会把占位符替换成真实应用名。
 *
 * 新增全局常量（应用名、版本号、默认分页大小等）放这里，不要散落在各页面里。
 */
export const APP_NAME = 'AI应用门户'

export const APP_VERSION = '1.1.1'

/**
 * 文档标题兜底：页面未声明标题时使用（如初始占位页）。
 *
 * 刻意**不用 `APP_NAME`**：应用还没命名时，平台可能把项目 ID 之类的占位值当应用名注入，
 * 直接当标题会把它暴露出去。页面用 `usePageTitle()` 声明标题后，`document.title` 随之更新
 * （见 src/app/layout/PageTitle.tsx）；没有页面声明时回到本兜底值。
 */
export const DOC_TITLE_FALLBACK = 'AI应用门户'
