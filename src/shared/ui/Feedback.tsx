import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from './Button'
import { DotTile, DotWave } from './Dot'

/**
 * 页面级加载：九点呼吸（品牌点阵），不是转圈。
 * 名字保持 `Spinner` 是为了不打断既有调用点；视觉已经统一到点阵语言。
 */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return <DotWave label={label} className={className} />
}

/** 骨架屏：扫光比纯闪烁更像「正在准备内容」，也不制造额外的注意力。 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-md', className)} aria-hidden />
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="加载中">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-md border border-border bg-surface p-4">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  illustration,
  title,
  description,
  action,
  className,
}: {
  /** 紧凑场景（卡片内、行内）才用图标 */
  icon?: LucideIcon
  /** 整页 / 整块空态优先用插图：传入本地图片（`<img src={xxx} alt="" className="h-24" />`，宽 96–160），
   *  比图标更有情绪、页面不显得干（见 ui-design-skill 的 01 §12 与 02 §8）。二者二选一。 */
  illustration?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {illustration ? (
        <div className="mb-4">{illustration}</div>
      ) : Icon ? (
        <div className="mb-3 flex size-14 items-center justify-center rounded-lg bg-primary-soft">
          <Icon className="size-7 text-primary" aria-hidden />
        </div>
      ) : (
        <DotTile size="lg" className="mb-4" />
      )}
      <p className="text-title font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-caption text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({
  message,
  onRetry,
}: {
  message?: string
  onRetry?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <p className="text-body font-medium text-danger">加载失败</p>
      <p className="mt-1 max-w-sm text-caption text-muted-foreground">{message ?? '请检查网络后重试'}</p>
      {onRetry && (
        <Button variant="outline" className="mt-4" onClick={onRetry}>
          重新加载
        </Button>
      )}
    </div>
  )
}
