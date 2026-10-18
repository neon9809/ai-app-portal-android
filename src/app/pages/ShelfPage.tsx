import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MoreHorizontal, Plus } from 'lucide-react'

import emptyIllustration from '@/assets/zaowu-empty.svg'
import { listApps } from '@/shared/portal/db'
import type { PortalApp } from '@/shared/portal/types'
import { formatRelativeTime } from '@/shared/portal/utils'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/Feedback'
import { useToast } from '@/shared/ui/Toast'

/**
 * 首页：一进来就是已安装的应用。
 * 新建在顶栏右上角，导入与设置在左上角菜单里，页面本身不再堆放入口。
 */
export function ShelfPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [apps, setApps] = useState<PortalApp[] | null>(null)

  const refresh = useCallback(async () => {
    try {
      const list = await listApps()
      // 已完成的排前面；未完成的草稿也保留入口，避免生成在后台被中断后找不到
      list.sort(
        (a, b) => Number(Boolean(b.html)) - Number(Boolean(a.html)) || b.updatedAt - a.updatedAt,
      )
      setApps(list)
    } catch (error) {
      setApps([])
      toast({ title: '本机存储不可用', description: (error as Error).message, tone: 'danger' })
    }
  }, [toast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (apps === null) {
    return (
      <div className="page">
        <div className="grid grid-cols-2 gap-3" role="status" aria-label="加载中">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="h-[148px] animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    )
  }

  if (apps.length === 0) {
    return (
      <div className="page">
        <EmptyState
          illustration={<img src={emptyIllustration} alt="" className="h-28" />}
          title="还没有应用"
          description="点右上角的 +，用一句话说说你想做的小工具。"
          action={
            <Button onClick={() => navigate('/studio')}>
              <Plus className="size-4" aria-hidden />
              造第一个
            </Button>
          }
          className="min-h-[58dvh] justify-center"
        />
      </div>
    )
  }

  return (
    <div className="page">
      <ul className="grid grid-cols-2 gap-3">
        {apps.map((app) => {
          const pending = !app.html
          return (
            <li key={app.id} className="relative">
              <button
                type="button"
                onClick={() => navigate(pending ? `/studio?app=${app.id}` : `/app/${app.id}`)}
                className="flex h-full w-full flex-col items-start gap-2 rounded-lg border border-border bg-surface p-3 text-left active:bg-accent"
              >
                <span
                  className="flex size-12 items-center justify-center rounded-md bg-primary-soft text-emoji"
                  aria-hidden
                >
                  {app.emoji}
                </span>
                <span className="line-clamp-1 w-full text-body font-medium">{app.name}</span>
                <span className="line-clamp-2 min-h-[32px] w-full text-caption text-muted-foreground">
                  {pending ? '上次生成没有完成，需求和附件还在。' : app.description}
                </span>
                <span
                  className={
                    pending
                      ? 'w-full text-caption text-warning'
                      : 'w-full text-caption text-muted-foreground'
                  }
                >
                  {pending
                    ? '未完成 · 继续生成'
                    : app.lastOpenedAt > 0
                      ? `用过 · ${formatRelativeTime(app.lastOpenedAt)}`
                      : '还没打开过'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => navigate(`/app/${app.id}/detail`)}
                aria-label={`${app.name} 的详情`}
                className="absolute right-0 top-0 flex size-11 items-center justify-center rounded-md text-muted-foreground active:bg-accent"
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>

      <p className="mt-4 text-center text-caption text-muted-foreground">
        所有应用与数据都只保存在这台设备上
      </p>
    </div>
  )
}
