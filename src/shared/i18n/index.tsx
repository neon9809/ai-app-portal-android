import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { zhCN } from './zh-CN'
import { enUS } from './en-US'

/**
 * 轻量 i18n：零依赖，两个字典（zh-CN / en-US），默认跟随系统语言。
 *
 * 约定：
 * 1. 界面文案一律走 t('key')，不写死语言；代码注释不翻译。
 * 2. 键按「页面/模块.含义」组织，参数用 {name} 占位。
 * 3. 生成器的提示词语言（决定生成应用的界面语言）跟随当前语言（generator.ts 读取）。
 */

export type Locale = 'zh-CN' | 'en-US'
export type LocalePreference = 'system' | Locale

const STORAGE_KEY = 'portal-locale'

export const LOCALES: Locale[] = ['zh-CN', 'en-US']

const DICTIONARIES: Record<Locale, Record<string, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

export const LOCALE_LABELS: Record<Locale, string> = {
  'zh-CN': '简体中文',
  'en-US': 'English',
}

function systemLocale(): Locale {
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh')) {
    return 'zh-CN'
  }
  return 'zh-CN' in DICTIONARIES && navigator.language?.toLowerCase().startsWith('en')
    ? 'en-US'
    : 'zh-CN'
}

export function getLocalePreference(): LocalePreference {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === 'zh-CN' || saved === 'en-US') return saved
    return 'system'
  } catch {
    return 'system'
  }
}

export function resolveLocale(preference: LocalePreference = getLocalePreference()): Locale {
  return preference === 'system' ? systemLocale() : preference
}

export function translate(locale: Locale, key: string, params?: Record<string, string | number>): string {
  let text = DICTIONARIES[locale][key] ?? DICTIONARIES['zh-CN'][key] ?? key
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value))
    }
  }
  return text
}

export function setLocalePreference(preference: LocalePreference): void {
  try {
    if (preference === 'system') window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // 存储不可用：本次仍生效，只是记不住
  }
  applyLocale(resolveLocale(preference))
  window.dispatchEvent(new Event('portal-locale-change'))
}

export function applyLocale(locale: Locale): void {
  document.documentElement.lang = locale === 'en-US' ? 'en' : 'zh-CN'
}

export function initLocale(): void {
  applyLocale(resolveLocale())
}

interface I18nContextValue {
  locale: Locale
  t: (key: string, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue>({ locale: 'zh-CN', t: (key) => key })

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => resolveLocale())

  useEffect(() => {
    const onChange = () => setLocale(resolveLocale())
    window.addEventListener('portal-locale-change', onChange)
    return () => window.removeEventListener('portal-locale-change', onChange)
  }, [])

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale],
  )

  const value = useMemo<I18nContextValue>(() => ({ locale, t }), [locale, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext)
}

/** 非组件场景（生成器提示词等）取当前语言 */
export function currentLocale(): Locale {
  return resolveLocale()
}
