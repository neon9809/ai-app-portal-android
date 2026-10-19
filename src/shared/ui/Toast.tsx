import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useI18n } from '@/shared/i18n'

export type ToastTone = 'info' | 'success' | 'warning' | 'danger'

export interface ToastOptions {
  title: string
  description?: string
  tone?: ToastTone
  /** 毫秒；0 表示不自动关闭 */
  duration?: number
}

interface ToastItem extends Required<Omit<ToastOptions, 'description'>> {
  id: number
  description?: string
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastContextValue>({ toast: () => undefined, dismiss: () => undefined })

const TONE_ICON = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
} as const

/**
 * 应用内 Toast：从屏幕顶部垂下的主题色通知带。
 *
 * 不占用底部输入栏的区域；上部主题色不透明、内容用白色，向下渐隐到透明。
 * 整条带子不拦截点击（只有关闭按钮可点），不会挡住下面的导航。
 * App UI 里的「轻提示」优先用原生 `showToast`；本组件用于需要带描述/图标的富提示，
 * 以及原生接口不可用时的降级。
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(0)
  const { t } = useI18n()

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = (nextId.current += 1)
      const item: ToastItem = {
        id,
        title: options.title,
        description: options.description,
        tone: options.tone ?? 'info',
        duration: options.duration ?? 2600,
      }
      // 同时只保留一条：连续操作时叠三条会遮住页面标题（移动端屏幕高度有限）
      setItems([item])
      if (item.duration > 0) window.setTimeout(() => dismiss(id), item.duration)
    },
    [dismiss],
  )

  const value = useMemo<ToastContextValue>(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="toast-layer pointer-events-none fixed inset-x-0 z-40 flex flex-col"
        role="status"
        aria-live="polite"
      >
        {items.map((item) => {
          const Icon = TONE_ICON[item.tone]
          return (
            <div key={item.id} className="toast-band animate-toast-in w-full px-4">
              <div className="mx-auto flex w-full max-w-[640px] items-start gap-2.5 pt-2">
                <Icon className="mt-0.5 size-4 shrink-0 text-primary-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-body font-medium text-primary-foreground">{item.title}</p>
                  {item.description && (
                    <p className="mt-0.5 break-words text-caption text-primary-foreground/80">
                      {item.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(item.id)}
                  className="pointer-events-auto -mr-2 -mt-2 flex size-11 shrink-0 items-center justify-center rounded-full text-primary-foreground/80 active:bg-primary-foreground/15"
                  aria-label={t('common.closeToast')}
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
              {item.duration > 0 && (
                <span
                  className="mx-auto mt-2 block h-0.5 w-full max-w-[640px] bg-primary-foreground/20"
                  aria-hidden
                >
                  <span
                    className="toast-progress block h-full bg-primary-foreground/85"
                    style={{ animationDuration: `${item.duration}ms` }}
                  />
                </span>
              )}
              <div className="h-10" aria-hidden />
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext)
}
