import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { Bell, X } from 'lucide-react'

import { invokeNative } from '@/shared/bridge'
import { getAppSettings } from '@/shared/portal/db'
import { runDueTimeTriggers } from '@/shared/portal/triggers'
import { useI18n } from '@/shared/i18n'

export interface PortalNotice {
  id: string
  appId: string
  appName: string
  title: string
  body?: string
  at: number
  /** 触发器自己要求震动（与应用设置里的震动开关取并集） */
  vibrate?: boolean
}


/**
 * 触发器引擎：门户在前台时每 30 秒检查一次时间触发器。
 * 到点后向应用投递事件，并按应用设置显示门户内横幅（不是系统通知栏推送）。
 *
 * 位置触发器由运行页（SandboxFrame）在拿到定位授权后检查，
 * 它触发时同样派发 portal:trigger / portal:notice，由这里统一展示。
 */
export function TriggerEngineProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [queue, setQueue] = useState<PortalNotice[]>([])
  const current = queue[0]

  const push = useCallback((notice: PortalNotice) => {
    void (async () => {
      try {
        const settings = await getAppSettings(notice.appId)
        if (!settings.notifications.enabled) return
        if (settings.notifications.vibrate || notice.vibrate) {
          void invokeNative('vibrateShort', { type: 'medium' }).catch(() => undefined)
        }
        if (!settings.notifications.banner) return
        setQueue((list) => [...list, notice].slice(-5))
      } catch {
        // 设置读不到时按「不打扰」处理
      }
    })()
  }, [])

  // 应用运行页 / 位置触发器通过 window 事件送提醒进来
  useEffect(() => {
    const onNotice = (event: Event) => {
      const detail = (event as CustomEvent<PortalNotice>).detail
      if (detail) push(detail)
    }
    window.addEventListener('portal:notice', onNotice as EventListener)
    return () => window.removeEventListener('portal:notice', onNotice as EventListener)
  }, [push])

  useEffect(() => {
    let alive = true
    const tick = async () => {
      if (!alive || document.visibilityState !== 'visible') return
      try {
        const events = await runDueTimeTriggers()
        for (const event of events) {
          window.dispatchEvent(new CustomEvent('portal:trigger', { detail: event }))
          // 只交给应用处理（run）的触发器不弹横幅
          if (!event.action.notify) continue
          push({
            id: `${event.triggerId}-${event.at}`,
            appId: event.appId,
            appName: event.appName,
            title: event.action.notify.title,
            body: event.action.notify.body,
            at: event.at,
            vibrate: event.action.vibrate,
          })
        }
      } catch {
        // 引擎失败不打扰用户，下次 tick 再试
      }
    }

    void tick()
    const timer = window.setInterval(tick, 30_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [push])

  // 每条提醒停留 5 秒；点击或关闭会提前移除
  useEffect(() => {
    if (!current) return
    const timer = window.setTimeout(() => setQueue((list) => list.slice(1)), 5000)
    return () => window.clearTimeout(timer)
  }, [current])

  const dismiss = () => setQueue((list) => list.slice(1))

  return (
    <>
      {children}
      {current && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-[55] px-4 pt-safe-top">
          <div className="pointer-events-auto mx-auto mt-2 flex max-w-md items-start gap-2 rounded-lg border border-border bg-surface p-3">
            <Bell className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <button
              type="button"
              onClick={() => {
                window.location.hash = `#/app/${current.appId}`
                dismiss()
              }}
              className="min-w-0 flex-1 text-left"
            >
              <p className="truncate text-body font-medium">{current.title}</p>
              {current.body && (
                <p className="mt-0.5 line-clamp-2 text-caption text-muted-foreground">
                  {current.body}
                </p>
              )}
              <p className="mt-0.5 text-caption text-muted-foreground">{current.appName}</p>
            </button>
            <button
              type="button"
              onClick={dismiss}
              aria-label={t('trigger.closeAlert')}
              className="-mr-1 flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground active:bg-accent"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
