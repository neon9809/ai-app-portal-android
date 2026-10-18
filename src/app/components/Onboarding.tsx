import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { Code2, Gamepad2, Repeat2, type LucideIcon } from 'lucide-react'

import { cn } from '@/shared/lib/cn'
import { APP_NAME } from '@/shared/config/app'
import { settingGet, settingSet } from '@/shared/portal/db'

const SEEN_KEY = 'onboardingSeen'

interface GuideStep {
  icon: LucideIcon
  title: string
  body: string
  tip?: string
}

const STEPS: GuideStep[] = [
  {
    icon: Code2,
    title: '把 GitHub 项目搬进来',
    body: '把一个简单的 GitHub 项目地址发给内置的 Coding Assistant，它会重写成能在这里直接运行的小工具。',
    tip: '适合把命令行小工具、脚本改成点开就能用的应用。',
  },
  {
    icon: Repeat2,
    title: '把重复劳动交给它',
    body: '描述你日常最耗时、最重复的那件事——整理表格、对账、写周报——让它做个工具替你完成。',
    tip: '越具体越好：说清楚输入什么、希望得到什么结果。',
  },
  {
    icon: Gamepad2,
    title: '装个没有广告的小应用',
    body: '围棋、数独、番茄钟这类小应用广告太多？直接让它做一个只属于你的版本，数据还留在本机。',
    tip: '第一次使用前，先到「设置 → AI 模型」填一个模型服务。',
  },
]

interface OnboardingContextValue {
  open: () => void
}

const OnboardingContext = createContext<OnboardingContextValue>({ open: () => undefined })

/** 首次启动自动展示使用说明；之后可从左上角菜单重新打开 */
export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      const seen = await settingGet<boolean>(SEEN_KEY)
      if (alive && !seen) setVisible(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  const open = useCallback(() => {
    setClosing(false)
    setVisible(true)
  }, [])

  const close = useCallback(() => {
    setClosing(true)
    void settingSet(SEEN_KEY, true)
    window.setTimeout(() => {
      setVisible(false)
      setClosing(false)
    }, 220)
  }, [])

  return (
    <OnboardingContext.Provider value={{ open }}>
      {children}
      {visible && <Onboarding closing={closing} onDone={close} />}
    </OnboardingContext.Provider>
  )
}

export function useOnboarding(): OnboardingContextValue {
  return useContext(OnboardingContext)
}

function Onboarding({ closing, onDone }: { closing: boolean; onDone: () => void }) {
  const [index, setIndex] = useState(0)
  const step = STEPS[index]
  const Icon = step.icon
  const isLast = index === STEPS.length - 1

  // 自动翻页；到最后一张就停住，等用户自己开始
  useEffect(() => {
    if (isLast) return
    const timer = window.setTimeout(() => setIndex((current) => current + 1), 5600)
    return () => window.clearTimeout(timer)
  }, [index, isLast])

  return (
    <div
      className={cn(
        'fixed inset-0 z-[60] flex h-screen-dvh flex-col overflow-hidden bg-primary text-primary-foreground',
        closing ? 'onboarding-closing' : 'onboarding-card',
      )}
      role="dialog"
      aria-modal="true"
      aria-label="使用说明"
    >
      {/* 背景点阵：与图标同一套元素 */}
      <div className="pointer-events-none absolute -right-8 top-24 grid grid-cols-4 gap-4 opacity-10" aria-hidden>
        {Array.from({ length: 16 }).map((_, dot) => (
          <span key={dot} className="size-2 rounded-full bg-primary-foreground" />
        ))}
      </div>
      <div className="pointer-events-none absolute -left-10 bottom-24 grid grid-cols-4 gap-4 opacity-10" aria-hidden>
        {Array.from({ length: 16 }).map((_, dot) => (
          <span key={dot} className="size-2 rounded-full bg-primary-foreground" />
        ))}
      </div>

      <div className="flex items-center justify-between px-4 pt-safe-top">
        <span className="text-caption">使用说明</span>
        <button
          type="button"
          onClick={onDone}
          className="flex min-h-tap items-center text-caption text-primary-foreground active:opacity-80"
        >
          跳过
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col justify-center px-4">
        <div className="flex flex-col items-center">
          <div className="grid grid-cols-3 gap-2.5" aria-hidden>
            {Array.from({ length: 9 }).map((_, dot) => (
              <span
                key={dot}
                className={cn(
                  'onboarding-dot size-3 rounded-full',
                  dot === 8 ? 'onboarding-dot-accent' : 'bg-primary-foreground',
                )}
                style={{ animationDelay: `${dot * 45}ms` }}
              />
            ))}
          </div>
          <p className="mt-3 text-title font-semibold">{APP_NAME}</p>
          <p className="mt-1 text-caption">用一句话，做出一个能直接用的工具</p>
        </div>

        <div
          key={index}
          className="onboarding-card mt-6 flex min-h-[38dvh] flex-col rounded-xl border border-primary-foreground/20 bg-primary-foreground/10 p-4"
        >
          <span className="flex size-12 items-center justify-center rounded-lg bg-primary-foreground text-primary">
            <Icon className="size-6" aria-hidden />
          </span>
          <h2 className="mt-3 text-display font-semibold">{step.title}</h2>
          <p className="mt-2 text-body">{step.body}</p>
          {step.tip && <p className="mt-2 text-caption">{step.tip}</p>}

          <div className="mt-auto flex items-center gap-1 pt-4">
            {STEPS.map((item, position) => (
              <button
                key={item.title}
                type="button"
                aria-label={`第 ${position + 1} 条：${item.title}`}
                aria-current={position === index ? 'step' : undefined}
                onClick={() => setIndex(position)}
                className="flex size-11 items-center justify-center"
              >
                <span
                  className={cn(
                    'h-1.5 rounded-full transition-all duration-200',
                    position === index
                      ? 'w-6 bg-primary-foreground'
                      : 'w-1.5 bg-primary-foreground/40',
                  )}
                />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 pb-safe-bottom">
        <button
          type="button"
          onClick={() => (isLast ? onDone() : setIndex((current) => current + 1))}
          className="flex min-h-[52px] w-full items-center justify-center rounded-md bg-primary-foreground text-title font-medium text-primary transition-transform duration-fast active:scale-[0.98]"
        >
          {isLast ? '开始使用' : '下一步'}
        </button>
      </div>
    </div>
  )
}
