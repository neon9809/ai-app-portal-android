import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronRight,
  Cpu,
  Gauge,
  Info,
  Languages,
  Monitor,
  Moon,
  ScrollText,
  ShieldCheck,
  Sun,
  SunMoon,
  type LucideIcon,
} from 'lucide-react'

import { usePageTitle } from '@/app/layout/PageTitle'
import { LOCALE_LABELS, useI18n } from '@/shared/i18n'
import { APP_NAME, APP_VERSION } from '@/shared/config/app'
import { cn } from '@/shared/lib/cn'
import { listApps, listAudit, listUsage, settingGet } from '@/shared/portal/db'
import { isLlmConfigured, readLlmSettings } from '@/shared/portal/llm'
import { formatRelativeTime } from '@/shared/portal/utils'
import { getThemePreference, setThemePreference, type ThemePreference } from '@/shared/theme'
import {
  getLocalePreference,
  setLocalePreference,
  type LocalePreference,
} from '@/shared/i18n'
import { DotField, DotTile } from '@/shared/ui/Dot'

const THEME_OPTIONS: Array<{ value: ThemePreference; labelKey: string; icon: LucideIcon }> = [
  { value: 'system', labelKey: 'settings.themeSystem', icon: Monitor },
  { value: 'light', labelKey: 'settings.themeLight', icon: Sun },
  { value: 'dark', labelKey: 'settings.themeDark', icon: Moon },
]

export function SettingsPage() {
  const { t, locale } = useI18n()
  usePageTitle(t('settings.title'))
  const navigate = useNavigate()
  const [model, setModel] = useState('—')
  const [tokens, setTokens] = useState(0)
  const [appCount, setAppCount] = useState(0)
  const [auditCount, setAuditCount] = useState(0)
  const [lastBackup, setLastBackup] = useState<number | null>(null)
  const [theme, setTheme] = useState<ThemePreference>(() => getThemePreference())
  const [localePref, setLocalePref] = useState<LocalePreference>(() => getLocalePreference())

  useEffect(() => {
    setModel(t('settings.modelUnset'))
    void (async () => {
      const settings = await readLlmSettings()
      setModel(isLlmConfigured(settings) ? settings.model : t('settings.modelUnset'))
      const [usage, apps, audit, backup] = await Promise.all([
        listUsage(),
        listApps(),
        listAudit(),
        settingGet<number>('lastBackupAt'),
      ])
      setTokens(usage.reduce((sum, item) => sum + item.inputTokens + item.outputTokens, 0))
      setAppCount(apps.filter((app) => app.status === 'installed' || Boolean(app.html)).length)
      setAuditCount(audit.length)
      setLastBackup(typeof backup === 'number' ? backup : null)
    })()
    // 跟随语言重跑：「未配置 / Not set up」这类状态文案要跟着切
  }, [t])

  return (
    <div className="page">
      <section className="relative mb-3 overflow-hidden rounded-xl border border-border bg-surface p-4">
        <DotField className="absolute -right-2 -top-2 text-primary" rows={4} cols={5} />
        <div className="relative flex items-center gap-3">
          <DotTile size="md" />
          <div className="min-w-0">
            <p className="text-title font-semibold">{APP_NAME}</p>
            <p className="mt-0.5 text-caption text-muted-foreground">
              {t('settings.identityVersion', { version: APP_VERSION })}
            </p>
          </div>
        </div>
      </section>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <ul>
          <SettingRow
            icon={Cpu}
            title={t('settings.model')}
            value={model}
            onClick={() => navigate('/settings/model')}
          />
          <SettingRow
            icon={Gauge}
            title={t('settings.usage')}
            value={t('settings.usageValue', { tokens, count: appCount })}
            onClick={() => navigate('/settings/usage')}
          />
          <SettingRow
            icon={ShieldCheck}
            title={t('settings.backup')}
            value={
              lastBackup
                ? t('settings.lastBackup', { time: formatRelativeTime(lastBackup, locale) })
                : t('settings.noBackup')
            }
            onClick={() => navigate('/settings/backup')}
          />
          <SettingRow
            icon={ScrollText}
            title={t('settings.audit')}
            value={t('settings.auditCount', { count: auditCount })}
            onClick={() => navigate('/settings/audit')}
          />
          <SettingRow
            icon={Info}
            title={t('settings.about')}
            value={t('settings.aboutValue', { version: APP_VERSION })}
            onClick={() => navigate('/settings/about')}
          />
        </ul>
      </div>

      <section className="mt-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center gap-2">
          <SunMoon className="size-4 text-primary" aria-hidden />
          <p className="text-body font-medium">{t('settings.appearance')}</p>
        </div>
        <p className="mt-0.5 text-caption text-muted-foreground">
          {t('settings.appearanceHint')}
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('settings.appearance')}>
          {THEME_OPTIONS.map((option) => {
            const Icon = option.icon
            const selected = theme === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  setThemePreference(option.value)
                  setTheme(option.value)
                }}
                className={cn(
                  'flex min-h-tap flex-col items-center justify-center gap-1 rounded-md border text-caption transition-colors duration-fast',
                  selected
                    ? 'border-primary bg-primary-soft font-medium text-primary'
                    : 'border-border bg-surface text-foreground active:bg-accent',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {t(option.labelKey)}
              </button>
            )
          })}
        </div>
      </section>

      <section className="mt-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center gap-2">
          <Languages className="size-4 text-primary" aria-hidden />
          <p className="text-body font-medium">{t('settings.language')}</p>
        </div>
        <p className="mt-0.5 text-caption text-muted-foreground">{t('settings.languageHint')}</p>
        <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('settings.language')}>
          {(['system', 'zh-CN', 'en-US'] as const).map((option) => {
            const selected = localePref === option
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  setLocalePreference(option)
                  setLocalePref(option)
                }}
                className={cn(
                  'flex min-h-tap flex-col items-center justify-center gap-1 rounded-md border text-caption transition-colors duration-fast',
                  selected
                    ? 'border-primary bg-primary-soft font-medium text-primary'
                    : 'border-border bg-surface text-foreground active:bg-accent',
                )}
              >
                {option === 'system' ? t('settings.langSystem') : LOCALE_LABELS[option]}
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function SettingRow({
  icon: Icon,
  title,
  value,
  onClick,
}: {
  icon: typeof Cpu
  title: string
  value: string
  onClick: () => void
}) {
  return (
    <li className="list-row">
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-[60px] w-full items-center gap-3 py-3 text-left active:bg-accent"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-soft">
          <Icon className="size-4 text-primary" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-body">{title}</span>
          <span className="mt-0.5 block truncate text-caption text-muted-foreground">{value}</span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </li>
  )
}
