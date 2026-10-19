import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MoreHorizontal } from 'lucide-react'

import emptyIllustration from '@/assets/app-empty.svg'
import { cn } from '@/shared/lib/cn'
import { useModelConfigured } from '@/shared/hooks/useModelConfigured'
import { useI18n } from '@/shared/i18n'
import { listApps } from '@/shared/portal/db'
import type { PortalApp } from '@/shared/portal/types'
import { formatRelativeTime } from '@/shared/portal/utils'
import { DotMark } from '@/shared/ui/Dot'
import { EmptyState } from '@/shared/ui/Feedback'
import { useToast } from '@/shared/ui/Toast'

/**
 * 首页：一进来就是已安装的应用。
 * 新建在顶栏右上角，导入与设置在左上角菜单里，页面本身不再堆放入口。
 *
 * 卡片语言：白底 + 细边 + 很轻的阴影，图标块用品牌浅蓝；
 * 状态用一个 6px 的点表达（未完成是橙点，已完成是蓝点），和引导页的点阵呼应。
 */
export function ShelfPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { t, locale } = useI18n()
  const modelReady = useModelConfigured()
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
      toast({ title: t('shelf.storageFail'), description: (error as Error).message, tone: 'danger' })
    }
  }, [toast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (apps === null) {
    return (
      <div className="page">
        <div className="grid grid-cols-2 gap-3" role="status" aria-label={t('shelf.loading')}>
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="rounded-xl border border-border bg-surface p-3">
              <div className="skeleton size-12 rounded-lg" />
              <div className="skeleton mt-3 h-3.5 w-2/3 rounded" />
              <div className="skeleton mt-2 h-3 w-full rounded" />
              <div className="skeleton mt-1.5 h-3 w-1/2 rounded" />
            </div>
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
          title={t('shelf.emptyTitle')}
          description={
            modelReady
              ? t('shelf.emptyHintReady')
              : t('shelf.emptyHintNoModel')
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
          const meta = pending
            ? t('shelf.pendingResume')
            : app.lastOpenedAt > 0
              ? t('shelf.usedAt', { time: formatRelativeTime(app.lastOpenedAt, locale) })
              : t('shelf.neverOpened')
          return (
            <li key={app.id} className="relative">
              <button
                type="button"
                onClick={() => navigate(pending ? `/studio?app=${app.id}` : `/app/${app.id}`)}
                className="flex h-full w-full flex-col items-start gap-2 rounded-xl border border-border bg-surface p-3 text-left shadow-sm transition-[transform,box-shadow] duration-fast ease-standard active:scale-[0.98] active:shadow-none"
              >
                <span
                  className="flex size-12 items-center justify-center rounded-lg bg-primary-soft text-emoji"
                  aria-hidden
                >
                  {app.emoji}
                </span>
                <span className="line-clamp-1 w-full text-body font-medium">{app.name}</span>
                <span className="line-clamp-2 min-h-[32px] w-full text-caption text-muted-foreground">
                  {pending ? t('shelf.pendingDesc') : app.description}
                </span>
                <span
                  className={cn(
                    'flex w-full items-center gap-1.5 text-caption',
                    pending ? 'text-warning' : 'text-muted-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      pending ? 'bg-spark-bright' : 'bg-primary',
                    )}
                    aria-hidden
                  />
                  {meta}
                </span>
              </button>
              <button
                type="button"
                onClick={() => navigate(`/app/${app.id}/detail`)}
                aria-label={t('shelf.detailOf', { name: app.name })}
                className="absolute right-0.5 top-0.5 flex size-11 items-center justify-center rounded-full text-muted-foreground active:bg-accent"
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>

      <p className="mt-4 flex items-center justify-center gap-2 text-caption text-muted-foreground">
        <DotMark size="xs" />
        <span>{t('shelf.metaCount', { count: apps.length })}</span>
        <span aria-hidden>·</span>
        <span>{t('shelf.metaLocal')}</span>
      </p>
    </div>
  )
}
