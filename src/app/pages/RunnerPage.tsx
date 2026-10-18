import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, MoreHorizontal } from 'lucide-react'

import { SandboxFrame } from '@/app/components/SandboxFrame'
import { getApp, saveApp } from '@/shared/portal/db'
import { invokeNative } from '@/shared/bridge'
import type { PortalApp } from '@/shared/portal/types'
import { now } from '@/shared/portal/utils'
import { EmptyState, Spinner } from '@/shared/ui/Feedback'
import { Button } from '@/shared/ui/Button'

/**
 * 应用运行页：沉浸式全屏，不套 AppShell。
 * 顶部保留一条 44px 的工具条（返回 / 名称 / 详情），应用内容从工具条下方开始，
 * 不会被状态栏或手势条压住。
 */
export function RunnerPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [app, setApp] = useState<PortalApp | null | undefined>(undefined)
  const openedRef = useRef(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      const found = await getApp(id)
      if (!alive) return
      setApp(found ?? null)
      if (found) {
        document.title = found.name
        if (!openedRef.current) {
          openedRef.current = true
          await saveApp({ ...found, lastOpenedAt: now() })
        }
      }
    })()
    return () => {
      alive = false
      document.title = 'AI应用门户'
    }
  }, [id])

  useEffect(() => {
    // 浅色工具条：状态栏用深色前景（图标 / 时间）
    void invokeNative('setStatusBarStyle', { light: false }).catch(() => undefined)
  }, [])

  if (app === undefined) {
    return (
      <div className="flex h-screen-dvh items-center justify-center bg-background">
        <Spinner />
      </div>
    )
  }

  if (app === null) {
    return (
      <div className="flex h-screen-dvh flex-col bg-background">
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            title="找不到这个应用"
            description="它可能已经被删除了。"
            action={<Button onClick={() => navigate('/')}>回到我的工具</Button>}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen-dvh flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-border bg-surface pt-safe-top">
        <div className="flex h-11 items-center gap-1 px-2">
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label="返回我的工具"
            className="flex size-11 items-center justify-center rounded-md active:bg-accent"
          >
            <ChevronLeft className="size-6" aria-hidden />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="text-display leading-none" aria-hidden>
              {app.emoji}
            </span>
            <span className="truncate text-body font-medium">{app.name}</span>
          </div>
          <button
            type="button"
            onClick={() => navigate(`/app/${app.id}/detail`)}
            aria-label="应用详情"
            className="flex size-11 items-center justify-center rounded-md active:bg-accent"
          >
            <MoreHorizontal className="size-5" aria-hidden />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 pb-safe-bottom">
        <SandboxFrame app={app} />
      </div>
    </div>
  )
}
