import { cn } from '@/shared/lib/cn'

/**
 * 点阵：品牌的「九个点 + 一个橙点」。
 *
 * 引导页把点阵演成了「一句话 → 工具」的故事；这里把它收成可复用组件，
 * 让加载、空态、页头这些日常界面也使用同一套语言：
 *  - DotMark：静态点阵标（小尺寸签名）
 *  - DotTile：蓝底点阵方块（应用身份）
 *  - DotWave：九点呼吸（页面级加载，替代转圈）
 *  - DotPulse：三点脉冲（按钮内加载，尺寸小、不抢眼）
 *  - DotField：装饰点阵（卡片角落的底纹）
 */

export type DotSize = 'xs' | 'sm' | 'md' | 'lg'

const DOT_SIZE: Record<DotSize, string> = {
  xs: 'size-[3px]',
  sm: 'size-1',
  md: 'size-1.5',
  lg: 'size-2',
}

const DOT_GAP: Record<DotSize, string> = {
  xs: 'gap-[2px]',
  sm: 'gap-[3px]',
  md: 'gap-1',
  lg: 'gap-[5px]',
}

export type DotTone = 'brand' | 'inverse' | 'muted'

const DOT_TONE: Record<DotTone, string> = {
  brand: 'bg-primary',
  inverse: 'bg-primary-foreground',
  muted: 'bg-muted-foreground',
}

/** 3×3 点阵标：右下角永远是品牌橙点 */
export function DotMark({
  size = 'md',
  tone = 'brand',
  className,
}: {
  size?: DotSize
  tone?: DotTone
  className?: string
}) {
  return (
    <span className={cn('inline-grid grid-cols-3', DOT_GAP[size], className)} aria-hidden>
      {Array.from({ length: 9 }).map((_, index) => (
        <span
          key={index}
          className={cn(
            DOT_SIZE[size],
            'rounded-full',
            index === 8 ? 'bg-spark-bright' : DOT_TONE[tone],
          )}
        />
      ))}
    </span>
  )
}

const TILE_SIZE = {
  sm: 'size-9 rounded-md',
  md: 'size-11 rounded-lg',
  lg: 'size-14 rounded-xl',
} as const

/** 蓝底点阵方块：应用图标 / 页面身份 */
export function DotTile({
  size = 'md',
  className,
}: {
  size?: keyof typeof TILE_SIZE
  className?: string
}) {
  return (
    <span
      className={cn('inline-grid shrink-0 place-items-center bg-primary', TILE_SIZE[size], className)}
      aria-hidden
    >
      <DotMark size={size === 'lg' ? 'lg' : 'md'} tone="inverse" />
    </span>
  )
}

/**
 * 页面级加载：九点依次呼吸，橙点保持常亮。
 * 用 role="status" 把「正在加载」告诉读屏；label 可写得更具体（如「正在打开工具」）。
 */
export function DotWave({
  label,
  tone = 'brand',
  className,
}: {
  label?: string
  tone?: 'brand' | 'inverse'
  className?: string
}) {
  return (
    <span
      role="status"
      className={cn('inline-flex flex-col items-center gap-2.5', className)}
    >
      <span className="inline-grid grid-cols-3 gap-1.5" aria-hidden>
        {Array.from({ length: 9 }).map((_, index) => (
          <span
            key={index}
            className={cn(
              'dot-wave-core size-2 rounded-full',
              index === 8
                ? 'bg-spark-bright'
                : tone === 'inverse'
                  ? 'bg-primary-foreground'
                  : 'bg-primary',
            )}
            style={{
              animationDelay: `${(index % 3) * 110 + Math.floor(index / 3) * 70}ms`,
            }}
          />
        ))}
      </span>
      <span
        className={cn(
          label ? 'text-caption' : 'sr-only',
          tone === 'inverse' ? 'text-primary-foreground/80' : 'text-muted-foreground',
        )}
      >
        {label ?? '加载中'}
      </span>
    </span>
  )
}

/** 按钮内的三点脉冲：继承当前文字颜色，跟着按钮状态走 */
export function DotPulse({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)} aria-hidden>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="dot-pulse-core size-1.5 rounded-full bg-current"
          style={{ animationDelay: `${index * 130}ms` }}
        />
      ))}
    </span>
  )
}

/** 装饰点阵底纹：颜色继承 text-*，由调用方控制透明度与位置 */
export function DotField({
  rows = 3,
  cols = 4,
  className,
}: {
  rows?: number
  cols?: number
  className?: string
}) {
  return (
    <span
      className={cn('pointer-events-none grid gap-3 opacity-[0.14]', className)}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      aria-hidden
    >
      {Array.from({ length: rows * cols }).map((_, index) => (
        <span key={index} className="size-1 rounded-full bg-current" />
      ))}
    </span>
  )
}
