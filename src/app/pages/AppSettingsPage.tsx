import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Bell, Trash2 } from 'lucide-react'

import { usePageTitle } from '@/app/layout/PageTitle'
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
  usePageTitle('应用设置')
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
      toast({ title: '保存失败', description: (error as Error).message, tone: 'danger' })
      void load()
    }
  }

  const toggleTrigger = async (trigger: AppTrigger) => {
    const next = { ...trigger, enabled: !trigger.enabled }
    setTriggers((list) => list.map((item) => (item.id === trigger.id ? next : item)))
    try {
      await saveTrigger(next)
    } catch (error) {
      toast({ title: '保存失败', description: (error as Error).message, tone: 'danger' })
      void load()
    }
  }

  const removeTrigger = async (trigger: AppTrigger) => {
    setTriggers((list) => list.filter((item) => item.id !== trigger.id))
    try {
      await deleteTrigger(trigger.id)
      toast({ title: `已删除「${trigger.name}」`, tone: 'info' })
    } catch (error) {
      toast({ title: '删除失败', description: (error as Error).message, tone: 'danger' })
      void load()
    }
  }

  if (app === undefined || settings === null) {
    return (
      <div className="flex min-h-[50dvh] items-center justify-center">
        <Spinner label="正在读取设置" />
      </div>
    )
  }

  if (app === null) {
    return <EmptyState title="找不到这个应用" description="它可能已经被删除了。" />
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
              通知与触发器只影响这个工具。
            </p>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="px-4 pt-3">
          <p className="text-body font-medium">通知</p>
          <p className="mt-0.5 text-caption text-muted-foreground">
            提醒显示在门户顶部的横幅，不会推送到系统通知栏。
          </p>
        </div>
        <ul className="mt-1">
          <SettingRow
            label="允许这个工具提醒我"
            description="关闭后，它主动发的提醒和触发器提醒都会被忽略。"
            checked={notifications.enabled}
            onChange={(checked) =>
              void updateSettings({
                notifications: { ...notifications, enabled: checked },
              })
            }
          />
          <SettingRow
            label="显示横幅"
            description="在门户顶部弹出提醒；关闭后只记录触发，不打扰。"
            checked={notifications.banner}
            disabled={!notifications.enabled}
            onChange={(checked) =>
              void updateSettings({
                notifications: { ...notifications, banner: checked },
              })
            }
          />
          <SettingRow
            label="提醒时震动"
            description="依赖手机的震动能力；浏览器预览没有效果。"
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
          <p className="text-body font-medium">触发器</p>
          <p className="mt-0.5 text-caption text-muted-foreground">
            由这个工具注册。时间触发器在门户打开时检查；位置触发器在它运行且你允许定位时检查。
          </p>
        </div>
        {triggers.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="还没有触发器"
              description="这个工具可以按时间或位置注册触发器，例如「每天 21:00 提醒记账」。"
            />
          </div>
        ) : (
          <ul className="mt-1">
            {triggers.map((trigger) => (
              <li key={trigger.id} className="list-row items-center py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body">{trigger.name}</p>
                  <p className="mt-0.5 text-caption text-muted-foreground">
                    {describeTrigger(trigger)}
                  </p>
                  <p className="mt-0.5 text-caption text-muted-foreground">
                    {trigger.lastFiredAt
                      ? `最近触发 ${formatDateTime(trigger.lastFiredAt)} · 共 ${trigger.firedCount} 次`
                      : '还没触发过'}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={trigger.enabled}
                  aria-label={`${trigger.enabled ? '停用' : '启用'}「${trigger.name}」`}
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
                  aria-label={`删除「${trigger.name}」`}
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
            门户是网页应用，没有系统级后台唤醒：关闭门户后触发器不会执行；错过的一次性 / 每日提醒会在下次打开时补发，
            超过 30 分钟就不再补。
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
