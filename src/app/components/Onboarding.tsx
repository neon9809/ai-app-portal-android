import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Check, ChevronLeft, Loader2, Sparkles } from 'lucide-react'

import { cn } from '@/shared/lib/cn'
import { invokeNative } from '@/shared/bridge'
import { isLlmConfigured, readLlmSettings } from '@/shared/portal/llm'
import { settingGet, settingSet } from '@/shared/portal/db'
import { Button } from '@/shared/ui/Button'

/**
 * 首次启动的使用说明。
 *
 * 不讲功能点，而是让用户亲手走一遍真实流程：
 *   第一幕 说一句话（点例子会自动填进去）→ 第二幕 看它把工具做出来 → 第三幕 点开示例小工具。
 * 点阵是主角：它对应应用图标里的「九个点 + 一个橙点」，会随输入起涟漪、在生成时排成
 * 轨道让橙点接力、完成后收拢，把「一句话 → 工具」这件事演给用户看。
 *
 * 关掉后从左上角菜单可以重新打开（见 SideMenu）。
 */

const SEEN_KEY = 'onboardingSeenV2'

const EXAMPLES = ['帮我做一个可以弹奏的钢琴APP', '做个没有广告的番茄钟']

const BUILD_STEPS = ['读懂你要什么', '画出界面', '写好逻辑和存储', '在本机自检'] as const

/** 口袋里的小钢琴：八个白键，C4–C5 */
const PIANO_KEYS = [
  { note: 'Do', freq: 261.63 },
  { note: 'Re', freq: 293.66 },
  { note: 'Mi', freq: 329.63 },
  { note: 'Fa', freq: 349.23 },
  { note: 'Sol', freq: 392.0 },
  { note: 'La', freq: 440.0 },
  { note: 'Si', freq: 493.88 },
  { note: 'Do', freq: 523.25 },
] as const

type Scene = 'say' | 'build' | 'use'

const SCENE_INDEX: Record<Scene, number> = { say: 0, build: 1, use: 2 }

const SCENE_LABELS = ['一句话', '它来做', '直接用'] as const

const SCENE_ANNOUNCE: Record<Scene, string> = {
  say: '第 1 步，共 3 步：说一句话',
  build: '第 2 步，共 3 步：它来做',
  use: '第 3 步，共 3 步：直接用',
}

/** 点阵布局：grid 静置 / ring 生成中 / gather 收拢成一个种子 */
type DotMode = 'grid' | 'ring' | 'gather'

const DOT_COUNT = 9
const GRID_STEP = 46
const RING_RADIUS = 64

interface DotSpot {
  x: number
  y: number
  scale: number
  opacity: number
}

function buildLayouts(): Record<DotMode, DotSpot[]> {
  const grid = Array.from({ length: DOT_COUNT }, (_, index) => ({
    x: ((index % 3) - 1) * GRID_STEP,
    y: (Math.floor(index / 3) - 1) * GRID_STEP,
    scale: 1,
    opacity: 1,
  }))
  const ring = Array.from({ length: DOT_COUNT }, (_, index) => {
    const angle = (index / DOT_COUNT) * Math.PI * 2 - Math.PI / 2
    return {
      x: Math.cos(angle) * RING_RADIUS,
      y: Math.sin(angle) * RING_RADIUS,
      scale: 0.86,
      opacity: 1,
    }
  })
  const gather = grid.map(() => ({ x: 0, y: 0, scale: 0.24, opacity: 0.9 }))
  return { grid, ring, gather }
}

const LAYOUTS = buildLayouts()

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 轻触反馈：真机壳走原生振动，浏览器预览里由 mock 兜底 */
function tick(type: 'light' | 'medium' = 'light') {
  void invokeNative('vibrateShort', { type }).catch(() => undefined)
}

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
  const navigate = useNavigate()
  const rootRef = useRef<HTMLDivElement>(null)
  const [scene, setScene] = useState<Scene>('say')
  const [draft, setDraft] = useState('')
  const [built, setBuilt] = useState('')
  const [modelReady, setModelReady] = useState(true)

  useEffect(() => {
    let alive = true
    void readLlmSettings()
      .then((settings) => {
        if (alive) setModelReady(isLlmConfigured(settings))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  // 进入时把焦点放到弹层本身，但不自动聚焦输入框（避免一进来就弹键盘）
  useEffect(() => {
    rootRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDone()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDone])

  const startBuild = useCallback((text: string) => {
    setDraft(text)
    setBuilt(text)
    setScene('build')
  }, [])

  const goUse = useCallback(() => setScene('use'), [])

  const configureModel = useCallback(() => {
    onDone()
    navigate('/settings/model')
  }, [navigate, onDone])

  // 焦点圈在弹层内：Tab 走到两端时回到另一端
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const root = rootRef.current
    if (!root) return
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), a[href]',
      ),
    )
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="使用说明"
      onKeyDown={onKeyDown}
      className={cn(
        'fixed inset-0 z-[60] flex h-screen-dvh flex-col overflow-hidden bg-primary text-primary-foreground outline-none',
        closing ? 'onboarding-closing' : 'onboarding-shell',
      )}
    >
      {/* 背景点阵：与图标同一套元素，缓慢呼吸。整层裁切，避免负定位把弹层撑出横向滚动 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="onboarding-ambient absolute -right-8 top-24 grid grid-cols-4 gap-4">
          {Array.from({ length: 16 }).map((_, dot) => (
            <span key={dot} className="size-2 rounded-full bg-primary-foreground" />
          ))}
        </div>
        <div className="onboarding-ambient absolute -left-10 bottom-24 grid grid-cols-4 gap-4">
          {Array.from({ length: 16 }).map((_, dot) => (
            <span key={dot} className="size-2 rounded-full bg-primary-foreground" />
          ))}
        </div>
      </div>

      <header className="relative shrink-0 px-4 pt-safe-top">
        <div className="flex min-h-11 items-center justify-between">
          {scene === 'say' ? (
            <span className="text-caption text-primary-foreground/80">使用说明</span>
          ) : (
            <button
              type="button"
              onClick={() => setScene('say')}
              aria-label="返回上一步"
              className="-ml-2 flex size-11 items-center justify-center rounded-md active:bg-primary-foreground/10"
            >
              <ChevronLeft className="size-6" aria-hidden />
            </button>
          )}
          <button
            type="button"
            onClick={onDone}
            className="flex min-h-tap items-center px-1 text-caption text-primary-foreground active:opacity-80"
          >
            跳过
          </button>
        </div>

        <ol className="mb-3 mt-1 flex gap-2" aria-label="引导进度">
          {SCENE_LABELS.map((label, index) => {
            const current = index === SCENE_INDEX[scene]
            const passed = index < SCENE_INDEX[scene]
            return (
              <li key={label} className="flex-1" aria-current={current ? 'step' : undefined}>
                <span
                  className={cn(
                    'block h-1 rounded-full transition-colors duration-300',
                    current || passed ? 'bg-primary-foreground' : 'bg-primary-foreground/25',
                  )}
                />
                <span
                  className={cn(
                    'mt-1.5 block text-caption transition-colors duration-300',
                    current
                      ? 'font-medium text-primary-foreground'
                      : 'text-primary-foreground/80',
                  )}
                >
                  {label}
                </span>
              </li>
            )
          })}
        </ol>
      </header>

      <main className="relative min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {scene === 'say' && <SayScene initialDraft={draft} onStart={startBuild} />}
        {scene === 'build' && <BuildScene brief={built} onDone={goUse} onSkip={goUse} />}
        {scene === 'use' && (
          <UseScene brief={built} modelReady={modelReady} onConfigure={configureModel} />
        )}
        <p className="sr-only" aria-live="polite">
          {SCENE_ANNOUNCE[scene]}
        </p>
      </main>

      {scene === 'use' && (
        <footer className="shrink-0 px-4 pb-safe-bottom">
          <div className="pb-4 pt-2">
            <Button
              block
              size="lg"
              onClick={modelReady ? onDone : configureModel}
              className="bg-primary-foreground text-primary hover:brightness-100"
            >
              {modelReady ? '开始使用' : '添加大模型API'}
            </Button>
            {!modelReady && (
              <p className="mt-2 text-center text-caption text-primary-foreground/80">
                生成工具需要一个模型服务，Key 只保存在这台手机上
              </p>
            )}
          </div>
        </footer>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * 第一幕：说一句话
 * ------------------------------------------------------------------ */

function SayScene({
  initialDraft,
  onStart,
}: {
  initialDraft: string
  onStart: (text: string) => void
}) {
  const [draft, setDraft] = useState(initialDraft)
  const [pulse, setPulse] = useState(0)
  const [mode, setMode] = useState<DotMode>('grid')
  const [leaving, setLeaving] = useState(false)
  const [typing, setTyping] = useState(false)
  const typingRef = useRef<number | null>(null)
  const leaveRef = useRef<number | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(
    () => () => {
      if (typingRef.current !== null) window.clearInterval(typingRef.current)
      if (leaveRef.current !== null) window.clearTimeout(leaveRef.current)
    },
    [],
  )

  const stopTyping = () => {
    if (typingRef.current !== null) {
      window.clearInterval(typingRef.current)
      typingRef.current = null
    }
    setTyping(false)
  }

  // 点例子后在输入框里逐字写出来，让用户看清「例子变成了我要说的话」
  const typeInto = (text: string) => {
    stopTyping()
    setDraft('')
    setPulse((value) => value + 1)
    if (prefersReducedMotion()) {
      setDraft(text)
      return
    }
    setTyping(true)
    let index = 0
    typingRef.current = window.setInterval(() => {
      index += 1
      setDraft(text.slice(0, index))
      setPulse((value) => value + 1)
      if (index >= text.length) stopTyping()
    }, 34)
  }

  const submit = () => {
    const text = draft.trim()
    if (!text || leaving) return
    stopTyping()
    inputRef.current?.blur()
    setLeaving(true)
    // 点阵先收拢成一个种子，下一幕再从同一个位置展开成轨道
    setMode('gather')
    leaveRef.current = window.setTimeout(() => onStart(text), 340)
  }

  const canSubmit = draft.trim().length > 0 && !leaving && !typing

  return (
    <div className="onboarding-scene flex min-h-full flex-col">
      <div className="flex flex-col items-center pt-2">
        <DotStage mode={mode} active={8} pulse={pulse} />
        <h2 className="mt-1 text-center text-display font-semibold">用一句话，做个能用的工具</h2>
        <p className="mt-1.5 text-center text-body text-primary-foreground/80">
          说清你要什么，界面、逻辑和存储都由它做好。
        </p>
      </div>

      <div className="mt-auto pt-5">
        <section
          className={cn(
            'rounded-xl bg-surface p-2 text-surface-foreground shadow-lg transition-[opacity,box-shadow] duration-200 focus-within:ring-2 focus-within:ring-primary-foreground/70',
            leaving && 'opacity-0',
          )}
        >
          <textarea
            ref={inputRef}
            value={draft}
            rows={2}
            maxLength={120}
            onChange={(event) => {
              stopTyping()
              setDraft(event.target.value)
              setPulse((value) => value + 1)
            }}
            onFocus={() => {
              // 键盘弹出后把输入区留在可视范围里
              window.requestAnimationFrame(() =>
                inputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
              )
            }}
            placeholder="例如：一个记录每天喝水杯数的小工具"
            className="field-plain w-full resize-none bg-transparent px-2 py-2 text-body placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-end px-1 pb-1">
            <Button variant="spark" onClick={submit} disabled={!canSubmit}>
              <Sparkles className="size-4" aria-hidden />
              开始
            </Button>
          </div>
        </section>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <span className="text-caption text-primary-foreground/80">试试</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                tick()
                typeInto(example)
              }}
              className="min-h-tap rounded-full border border-primary-foreground/25 bg-primary-foreground/10 px-3.5 text-caption active:bg-primary-foreground/20"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * 点阵舞台
 * ------------------------------------------------------------------ */

function DotStage({
  mode,
  active,
  pulse = 0,
  spinning = false,
}: {
  mode: DotMode
  active: number
  pulse?: number
  spinning?: boolean
}) {
  const spots = LAYOUTS[mode]
  const [ripples, setRipples] = useState<number[]>([])

  useEffect(() => {
    if (pulse === 0) return
    // 最多同时留三个涟漪，快速输入时不会堆出一串元素
    setRipples((current) => [...current.slice(-2), pulse])
  }, [pulse])

  return (
    <div className="onboarding-stage" aria-hidden>
      <span className="onboarding-stage-glow" />
      {ripples.map((id) => (
        <span
          key={id}
          className="onboarding-ripple"
          onAnimationEnd={() => setRipples((current) => current.filter((item) => item !== id))}
        />
      ))}
      <div className={cn('onboarding-dots', spinning && 'onboarding-dots-ring')}>
        {spots.map((spot, index) => (
          <span
            key={index}
            className="onboarding-dot-pos"
            style={{
              transform: `translate(${spot.x}px, ${spot.y}px) scale(${spot.scale})`,
              opacity: spot.opacity,
              transitionDelay: `${index * 18}ms`,
            }}
          >
            <span
              className={cn(
                'onboarding-dot-core',
                index === active && 'onboarding-dot-core-accent',
              )}
              style={{ animationDelay: `${(index % 3) * 170 + Math.floor(index / 3) * 110}ms` }}
            />
          </span>
        ))}
      </div>
    </div>
  )
}

/** 应用图标里的九点小标：结果卡片的图标，和舞台是同一套语言 */
function MiniMark({ className }: { className?: string }) {
  return (
    <span className={cn('grid grid-cols-3 gap-1', className)}>
      {Array.from({ length: 9 }).map((_, index) => (
        <span
          key={index}
          className={cn(
            'size-1.5 rounded-full',
            index === 8 ? 'bg-spark-bright' : 'bg-primary-foreground',
          )}
        />
      ))}
    </span>
  )
}

/* ------------------------------------------------------------------ *
 * 第二幕：它来做
 * ------------------------------------------------------------------ */

function BuildScene({
  brief,
  onDone,
  onSkip,
}: {
  brief: string
  onDone: () => void
  onSkip: () => void
}) {
  const [mode, setMode] = useState<DotMode>('gather')
  const [spinning, setSpinning] = useState(false)
  const [step, setStep] = useState(0)
  const [done, setDone] = useState(false)
  const [active, setActive] = useState(8)

  useEffect(() => {
    const reduced = prefersReducedMotion()
    // 先让「种子」画到屏幕上，再展开成轨道；轨道铺好后开始旋转
    const expand = window.setTimeout(() => setMode('ring'), 40)
    const spin = window.setTimeout(() => setSpinning(true), 640)
    const per = reduced ? 340 : 560
    const timers = BUILD_STEPS.map((_, index) =>
      window.setTimeout(() => setStep(index + 1), per * (index + 1)),
    )
    let leave: number | null = null
    const finish = window.setTimeout(
      () => {
        setDone(true)
        leave = window.setTimeout(onDone, reduced ? 350 : 950)
      },
      per * BUILD_STEPS.length + 320,
    )
    return () => {
      window.clearTimeout(expand)
      window.clearTimeout(spin)
      window.clearTimeout(finish)
      timers.forEach((timer) => window.clearTimeout(timer))
      if (leave !== null) window.clearTimeout(leave)
    }
  }, [onDone])

  // 橙点在轨道上逐个接力，表示「活儿在往前走」
  useEffect(() => {
    if (done) return
    const timer = window.setInterval(
      () => setActive((current) => (current + 1) % DOT_COUNT),
      180,
    )
    return () => window.clearInterval(timer)
  }, [done])

  // 做完了：轨道收拢，再切到结果
  useEffect(() => {
    if (!done) return
    setSpinning(false)
    setMode('gather')
  }, [done])

  return (
    <div className="onboarding-scene flex min-h-full flex-col">
      <div className="mt-auto flex flex-col items-center pt-2">
        <DotStage mode={mode} active={active} spinning={spinning} />
        <p className="mt-1 text-caption text-primary-foreground/80">你刚才说的</p>
        <p className="mt-1 line-clamp-2 px-2 text-center text-body">「{brief}」</p>
      </div>

      <div className="mb-auto pt-4">
        <section className="onboarding-rise rounded-xl bg-surface p-4 text-surface-foreground shadow-lg">
          <header className="flex items-center gap-3">
            <span
              className={cn(
                'grid size-10 shrink-0 place-items-center rounded-lg',
                done ? 'bg-success text-success-foreground' : 'bg-primary text-primary-foreground',
              )}
            >
              {done ? (
                <Check className="onboarding-pop size-5" strokeWidth={3} aria-hidden />
              ) : (
                <Sparkles className="size-5" aria-hidden />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-title font-semibold">{done ? '做好了' : '正在把它做出来'}</p>
              <p className="text-caption text-muted-foreground">
                {done ? '马上就能打开用' : '不用等太久，先看看它是怎么做的'}
              </p>
            </div>
            {done && <span className="shrink-0 text-caption text-success">完成</span>}
          </header>

          <ol className="mt-4 space-y-2.5">
            {BUILD_STEPS.map((label, index) => {
              const state = index < step ? 'done' : index === step ? 'active' : 'todo'
              return (
                <li key={label} className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      'grid size-5 shrink-0 place-items-center rounded-full',
                      state === 'done'
                        ? 'bg-primary text-primary-foreground'
                        : state === 'active'
                          ? 'border border-primary'
                          : 'border border-border',
                    )}
                  >
                    {state === 'done' && (
                      <Check className="onboarding-pop size-3.5" strokeWidth={3} aria-hidden />
                    )}
                    {state === 'active' && (
                      <Loader2 className="size-3 animate-spin text-primary" aria-hidden />
                    )}
                  </span>
                  <span
                    className={cn(
                      'text-body',
                      state === 'todo' ? 'text-muted-foreground' : 'text-surface-foreground',
                    )}
                  >
                    {label}
                  </span>
                </li>
              )
            })}
          </ol>

          <div className="mt-4 flex gap-1" aria-hidden>
            {BUILD_STEPS.map((label, index) => (
              <span
                key={label}
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors duration-300',
                  index < step ? 'bg-primary' : 'bg-muted',
                )}
              />
            ))}
          </div>
          <p className="sr-only" aria-live="polite">
            {done
              ? '工具做好了'
              : step < BUILD_STEPS.length
                ? `正在${BUILD_STEPS[step]}`
                : '正在收尾'}
          </p>
        </section>

        <button
          type="button"
          onClick={onSkip}
          className="mx-auto mt-3 flex min-h-tap items-center text-caption text-primary-foreground/80 underline decoration-primary-foreground/40 underline-offset-4 active:opacity-80"
        >
          跳过演示，直接看结果
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * 第三幕：直接用
 * ------------------------------------------------------------------ */

function UseScene({
  brief,
  modelReady,
  onConfigure,
}: {
  brief: string
  modelReady: boolean
  onConfigure: () => void
}) {
  return (
    <div className="onboarding-scene flex min-h-full flex-col">
      <div className="my-auto">
        <div className="text-center">
          <h2 className="text-display font-semibold">点开就能用</h2>
          <p className="mt-1.5 line-clamp-1 text-body text-primary-foreground/80">「{brief}」</p>
          <p className="mt-1 text-caption text-primary-foreground/80">
            你的那句话，会变成这样一个小工具
          </p>
        </div>

        <section className="onboarding-app-in mt-4 rounded-xl bg-surface p-4 text-surface-foreground shadow-lg">
          <header className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary">
              <MiniMark />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-title font-semibold">口袋钢琴</p>
              <p className="text-caption text-muted-foreground">一句话生成 · 点两下试试</p>
            </div>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">
              示例
            </span>
          </header>

          <PocketPiano />

          <p className="mt-2 text-center text-caption text-muted-foreground">
            声音走系统媒体音量，弹奏不会上传
          </p>
        </section>

        <p className="mt-3 text-center text-caption text-primary-foreground/80">
          每个权限都会先问你，可随时收回
        </p>

        {!modelReady && (
          <button
            type="button"
            onClick={onConfigure}
            className="mx-auto mt-1 flex min-h-tap items-center gap-1 text-caption text-primary-foreground underline decoration-primary-foreground/50 underline-offset-4 active:opacity-80"
          >
            还没填 AI 模型？去设置
            <ArrowRight className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  )
}

/** 演示用的小钢琴：Web Audio 合成，不加载任何外部音频 */
function PocketPiano() {
  const [played, setPlayed] = useState<number | null>(null)
  const audioRef = useRef<AudioContext | null>(null)
  const resetRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (resetRef.current !== null) window.clearTimeout(resetRef.current)
      void audioRef.current?.close().catch(() => undefined)
    },
    [],
  )

  const play = (index: number) => {
    tick('light')
    setPlayed(index)
    if (resetRef.current !== null) window.clearTimeout(resetRef.current)
    resetRef.current = window.setTimeout(() => setPlayed(null), 260)
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      const context = audioRef.current ?? new Ctor()
      audioRef.current = context
      void context.resume()
      const now = context.currentTime
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'triangle'
      oscillator.frequency.value = PIANO_KEYS[index].freq
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.16, now + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.05)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(now)
      oscillator.stop(now + 1.1)
    } catch {
      // 浏览器禁用音频时静默，演示仍可继续
    }
  }

  return (
    <div className="mt-4">
      <div className="flex h-32 items-stretch gap-1" role="group" aria-label="口袋钢琴琴键">
        {PIANO_KEYS.map((key, index) => (
          <button
            key={`${key.note}-${index}`}
            type="button"
            onClick={() => play(index)}
            aria-label={`弹 ${key.note}`}
            className={cn(
              'flex min-w-0 flex-1 flex-col items-center justify-end rounded-b-lg border border-border pb-2 text-caption transition-transform duration-100',
              index === PIANO_KEYS.length - 1
                ? 'bg-spark-soft text-spark'
                : 'bg-background text-muted-foreground',
              played === index
                ? '-translate-y-1 border-primary bg-primary-soft text-primary shadow-sm'
                : 'active:translate-y-0.5',
            )}
          >
            {key.note}
          </button>
        ))}
      </div>
      <p className="mt-2 text-center text-caption text-muted-foreground" aria-live="polite">
        {played === null ? '点一下琴键，听听看' : `正在弹 ${PIANO_KEYS[played].note}`}
      </p>
    </div>
  )
}
