/**
 * 外观主题：默认跟随系统，也可以在「设置 → 外观」里固定浅色 / 深色。
 *
 * 偏好存 localStorage（同步读取），这样首帧前就能落地主题，不会先闪一下浅色。
 * 真正生效的是 <html data-theme="light|dark">：色值全在 tokens.css 里，
 * 组件只消费语义 token，不写 dark: 变体。
 */

import { invokeNative } from '@/shared/bridge'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'portal-theme'
const THEME_EVENT = 'portal-theme-change'

let initialized = false

function prefersDark(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches)
}

export function getThemePreference(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  } catch {
    return 'system'
  }
}

export function resolveTheme(preference: ThemePreference = getThemePreference()): ResolvedTheme {
  if (preference !== 'system') return preference
  return prefersDark() ? 'dark' : 'light'
}

export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme

  // 浏览器地址栏 / 状态栏底色：从 token 里取，避免在组件里写死色值
  const meta = document.querySelector('meta[name="theme-color"]')
  const channels = getComputedStyle(root).getPropertyValue('--background').trim()
  if (meta && channels) meta.setAttribute('content', `rgb(${channels.split(/\s+/).join(', ')})`)

  // 真机状态栏图标：深色底用浅色图标
  void invokeNative('setStatusBarStyle', { light: theme === 'dark' }).catch(() => undefined)
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // 隐私模式 / 存储不可用：本次仍然生效，只是记不住
  }
  applyTheme(resolveTheme(preference))
  window.dispatchEvent(new Event(THEME_EVENT))
}

/** 启动时调用一次：落地当前主题，并在「跟随系统」时响应系统切换 */
export function initTheme(): void {
  if (initialized) return
  initialized = true
  applyTheme(resolveTheme())
  const media = window.matchMedia?.('(prefers-color-scheme: dark)')
  media?.addEventListener?.('change', () => {
    if (getThemePreference() === 'system') {
      applyTheme(resolveTheme('system'))
      window.dispatchEvent(new Event(THEME_EVENT))
    }
  })
}
