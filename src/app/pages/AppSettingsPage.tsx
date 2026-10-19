import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Bell, Trash2 } from 'lucide-react'

import { usePageTitle } from '@/app/layout/PageTitle'
import { useI18n } from '@/shared/i18n'
import {
  deleteTrigger,
  getApp,
  getAppSettings,
  listTriggers,
  saveAppSettings,
  saveTrigger,
} from '@/shared/portal/db'
import { describeTrigger, formatDateTime } from '@/shared/portal/triggers'
import type { AppTrigger, AppUserSettings, PortalApp } from '@/shared/portal/types'
import { cn } from '@/shared/lib/cn'
import { EmptyState, Spinner } from '@/shared/ui/Feedback'
import { useToast } from '@/shared/ui/Toast'

/**
 * 应用设置：通知偏好 + 触发器管理。
 *
 * 通知是门户内横幅（可选震动），不是系统通知栏推送；
 * 触发器只在门户打开时检查，关闭门户后不会在后台唤醒。
 */
export function AppSettingsPage() {
  const { t, locale } = useI18n()
  usePageTitle(t('appSettings.title'))
  const { id = '' } = useParams()
  const { toast } = useToast()
  const [app, setApp] = useState<PortalApp | null | undefined>(undefined)
  const [triggers, setTriggers] = useState<AppTrigger[]>([])
  const [settings, setSettings] = useState<AppUserSettings | null>(null)

  const load = useCallback(async () => {
    const found = await getApp(id)
    setApp(found ?? null)
    if (!found) return
    const [list, stored] = await Promise.all([listTriggers(id), getAppSettings(id)])
    setTriggers(list)
    setSettings(stored)
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const updateSettings = async (next: AppUserSettings) => {
    setSettings(next)
    try {
      await saveAppSettings(id, next)
    } catch (error) {
      toast({ title: t('appSettings.saveFail'), description: (error as Error).message, tone: 'danger' })
      void load()
    }
  }

  const toggleTrigger = async (trigger: AppTrigger) => {
    const next = { ...trigger, enabled: !trigger.enabled }
    setTriggers((list) => list.map((item) => (item.id === trigger.id ? next : item)))
    try {
      await saveTrigger(next)
    } catch (error) {
      toast({ title: t('appSettings.saveFail'), description: (error as Error).message, tone: 'danger' })
      void load()
    }
  }

  const removeTrigger = async (trigger: AppTrigger) => {
    setTriggers((list) => list.filter((item) => item.id !== trigger.id))
    try {
      await deleteTrigger(trigger.id)
      toast({ title: t('appSettings.triggerDeleted', { name: trigger.name }), tone: 'info' })
    } catch (error) {
      toast({ title: t('appSettings.deleteFail'), description: (error as Error).message, tone: 'danger' })
      void load()
    }
  }

  if (app === undefined || settings === null) {
    return (
      <div className="flex min-h-[50dvh] items-center justify-center">
        <Spinner label={t('appSettings.loading')} />
      </div>
    )
  }

  if (app === null) {
    return <EmptyState title={t('appSettings.notFound')} description={t('appSettings.notFoundDesc')} />
  }

  const notifications = settings.notifications

  return (
    <div className="page space-y-3">
      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-start gap-3">
          <span
            className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-display leading-none"
            aria-hidden
          >
            {app.emoji}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-title font-semibold">{app.name}</h2>
            <p className="mt-0.5 text-caption text-muted-foreground">
              {t('appSettings.scopeNote')}
            </p>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="px-4 pt-3">
          <p className="text-body font-medium">{t('appSettings.notifyTitle')}</p>
          <p className="mt-0.5 text-caption text-muted-foreground">
            {t('appSettings.notifyHint')}
          </p>
        </div>
        <ul className="mt-1">
          <SettingRow
            label={t('appSettings.allowAlerts')}
            description={t('appSettings.allowAlertsDesc')}
            checked={notifications.enabled}
            onChange={(checked) =>
              void updateSettings({
                notifications: { ...notifications, enabled: checked },
              })
            }
          />
          <SettingRow
            label={t('appSettings.banner')}
            description={t('appSettings.bannerDesc')}
            checked={notifications.banner}
            disabled={!notifications.enabled}
            onChange={(checked) =>
              void updateSettings({
                notifications: { ...notifications, banner: checked },
              })
            }
          />
          <SettingRow
            label={t('appSettings.vibrate')}
            description={t('appSettings.vibrateDesc')}
            checked={notifications.vibrate}
            disabled={!notifications.enabled}
            onChange={(checked) =>
              void updateSettings({
                notifications: { ...notifications, vibrate: checked },
              })
            }
          />
        </ul>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="px-4 pt-3">
          <p className="text-body font-medium">{t('appSettings.triggersTitle')}</p>
          <p className="mt-0.5 text-caption text-muted-foreground">
            {t('appSettings.triggersHint')}
          </p>
        </div>
        {triggers.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={t('appSettings.noTriggers')}
              description={t('appSettings.noTriggersDesc')}
            />
          </div>
        ) : (
          <ul className="mt-1">
            {triggers.map((trigger) => (
              <li key={trigger.id} className="list-row items-center py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body">{trigger.name}</p>
                  <p className="mt-0.5 text-caption text-muted-foreground">
                    {describeTrigger(trigger, locale)}
                  </p>
                  <p className="mt-0.5 text-caption text-muted-foreground">
                    {trigger.lastFiredAt
                      ? t('appSettings.lastFired', { time: formatDateTime(trigger.lastFiredAt), count: trigger.firedCount })
                      : t('appSettings.neverFired')}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={trigger.enabled}
                  aria-label={`${trigger.enabled ? t('appSettings.disable') : t('appSettings.enable')}「${trigger.name}」`}
                  onClick={() => void toggleTrigger(trigger)}
                  className="flex h-11 w-14 shrink-0 items-center justify-center"
                >
                  <span
                    className={cn(
                      'relative h-6 w-11 rounded-full transition-colors',
                      trigger.enabled ? 'bg-primary' : 'bg-muted',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-0.5 size-5 rounded-full bg-surface transition-transform',
                        trigger.enabled ? 'translate-x-[22px]' : 'translate-x-0.5',
                      )}
                    />
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={t('appSettings.deleteTrigger', { name: trigger.name })}
                  onClick={() => void removeTrigger(trigger)}
                  className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground active:bg-accent"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-start gap-2">
          <Bell className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-caption text-muted-foreground">
            {t('appSettings.limitNote')}
          </p>
        </div>
      </section>
    </div>
  )
}

function SettingRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <li className={cn('list-row items-center py-3', disabled && 'opacity-60')}>
      <div className="min-w-0 flex-1">
        <p className="text-body">{label}</p>
        <p className="mt-0.5 text-caption text-muted-foreground">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="flex h-11 w-14 shrink-0 items-center justify-center"
      >
        <span
          className={cn(
            'relative h-6 w-11 rounded-full transition-colors',
            checked ? 'bg-primary' : 'bg-muted',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 size-5 rounded-full bg-surface transition-transform',
              checked ? 'translate-x-[22px]' : 'translate-x-0.5',
            )}
          />
        </span>
      </button>
    </li>
  )
}
