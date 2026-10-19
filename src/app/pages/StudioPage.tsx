import { useEffect, useRef, useState, type RefObject } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CircleHelp,
  ChevronDown,
  CircleSlash,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'

import { usePageTitle } from '@/app/layout/PageTitle'
import { cn } from '@/shared/lib/cn'
import { getApp, listApps, saveApp } from '@/shared/portal/db'
import { takeSnapshot } from '@/shared/portal/backup'
import { pickFile } from '@/shared/portal/file-picker'
import {
  answerJobQuestions,
  cancelJob,
  deleteRevision,
  getJob,
  inferPlan,
  inferRequirements,
  reviseApp,
  rollbackRevision,
  startGeneration,
  subscribeJob,
} from '@/shared/portal/generator'
import { isLlmConfigured, readLlmSettings } from '@/shared/portal/llm'
import type {
  ClarifyQuestion,
  GenerationJob,
  JobStep,
  PortalApp,
  RequirementAttachment,
} from '@/shared/portal/types'
import { formatDateTime, now, uid } from '@/shared/portal/utils'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Dialog'
import { DotMark, DotPulse } from '@/shared/ui/Dot'
import { Spinner } from '@/shared/ui/Feedback'
import { useToast } from '@/shared/ui/Toast'

const RUNNING_PHASES: GenerationJob['phase'][] = [
  'preparing',
  'planning',
  'asking',
  'generating',
  'checking',
  'repairing',
  'saving',
]

const MAX_IMAGES = 2
const MAX_IMAGE_BYTES = 800_000
const MAX_TEXT_BYTES = 50_000

/** 一键填入的起步示例：和首次引导里的例子保持一致 */
const EXAMPLE_BRIEFS = [
  '记每天喝了几杯水',
  '做个没有广告的番茄钟',
  '帮我做一个跳一跳小游戏',
  '帮我做一个可以弹奏的钢琴APP',
]

function bytesToDataUrl(bytes: Uint8Array, name: string): Promise<string> {
  const mime = /\.png$/i.test(name)
    ? 'image/png'
    : /\.webp$/i.test(name)
      ? 'image/webp'
      : /\.gif$/i.test(name)
        ? 'image/gif'
        : 'image/jpeg'
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime })
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('读取附件失败'))
    reader.readAsDataURL(blob)
  })
}

/**
 * 新建工具：只给一个输入框和附件按钮。
 * 数据怎么存、要不要联网、界面用哪种结构，都由生成器自己判断；
 * 拿不准时按更少权限的方式做，不再让用户逐项选择。
 */
export function StudioPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const requestedAppId = searchParams.get('app')
  const { toast } = useToast()

  const [app, setApp] = useState<PortalApp | null>(null)
  const [loading, setLoading] = useState(true)
  const [brief, setBrief] = useState('')
  const [attachments, setAttachments] = useState<RequirementAttachment[]>([])
  const [job, setJob] = useState<GenerationJob | undefined>()
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const handledJobRef = useRef('')
  const liveBoxRef = useRef<HTMLPreElement>(null)
  const thinkingBoxRef = useRef<HTMLPreElement>(null)
  const [elapsed, setElapsed] = useState(0)
  const streamEndRef = useRef<HTMLDivElement>(null)
  const composerDockRef = useRef<HTMLDivElement>(null)
  const [composerHeight, setComposerHeight] = useState(0)
  const hasHtml = Boolean(app?.html)
  usePageTitle(hasHtml ? '继续开发' : '新建工具')

  /*
   * 只有带 ?app=<id> 时才是「继续开发」某个应用；
   * 从加号或菜单进来一律是空白新建，不去翻旧草稿。
   */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        if (!requestedAppId) {
          // 从「继续开发」切回「新建」：清掉上一个应用的上下文，避免旧应用一直挂在页面上
          if (!alive) return
          setApp(null)
          setBrief('')
          setFeedback('')
          setAttachments([])
          setJob(undefined)
          setError(null)
          return
        }
        const apps = await listApps()
        const draft = apps.find((item) => item.id === requestedAppId)
        if (!alive || !draft) return
        setApp(draft)
        setBrief(draft.requirements.brief)
        setAttachments(draft.requirements.attachments ?? [])
        const existingJob = getJob(draft.id)
        if (existingJob) setJob(existingJob)
      } catch (cause) {
        setError((cause as Error).message)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [requestedAppId])

  /* 订阅生成任务 */
  useEffect(() => {
    if (!app) return
    const unsubscribe = subscribeJob(app.id, setJob)
    const existing = getJob(app.id)
    if (existing) setJob(existing)
    return unsubscribe
  }, [app?.id])

  /* 任务结束：同步数据库里的应用 */
  useEffect(() => {
    if (!app || !job) return
    if (job.phase !== 'done' && job.phase !== 'failed' && job.phase !== 'cancelled') return
    const key = `${job.startedAt}-${job.phase}`
    if (handledJobRef.current === key) return
    handledJobRef.current = key
    void (async () => {
      const latest = await getApp(app.id)
      if (latest) setApp(latest)
      if (job.phase === 'done') {
        toast({ title: '做好了，已经放进我的应用', tone: 'success' })
        await takeSnapshot('生成应用')
      }
    })()
  }, [job?.phase, job?.startedAt, app?.id, toast])

  useEffect(() => {
    if (job?.phase === 'failed' && job.error) setError(job.error)
  }, [job?.phase, job?.error])

  // 点击后立刻进入生成态：即使任务对象还没回流，也先给用户一个卡片，而不是停在原地
  const generating = Boolean(
    (job && RUNNING_PHASES.includes(job.phase)) || (busy && !hasHtml),
  )

  // 底部输入栏是 fixed 浮层：内容末尾要留出它的实际高度，否则最后一张卡片会被压住。
  // 附件会让输入栏变高，所以用 ResizeObserver 跟随，而不是写死一个占位高度。
  useEffect(() => {
    const element = composerDockRef.current
    if (!element) return
    const measure = () => setComposerHeight(element.getBoundingClientRect().height)
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [hasHtml, generating, attachments.length])

  // 生成期间给用户一个「正在等进行多久」的实感
  useEffect(() => {
    if (!generating) {
      setElapsed(0)
      return
    }
    const start = job?.startedAt ?? Date.now()
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [generating, job?.startedAt])

  // 流式输出跟着底部滚动
  useEffect(() => {
    const box = liveBoxRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [job?.live])

  // 思考内容同样跟着底部滚动
  useEffect(() => {
    const box = thinkingBoxRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [job?.thinking])

  // 整个对话流在生成时跟着最新内容走
  useEffect(() => {
    if (!generating) return
    streamEndRef.current?.scrollIntoView({ block: 'end' })
  }, [generating, job?.steps?.length, job?.live, job?.thinking])

  const addAttachment = async () => {
    try {
      const picked = await pickFile('image/*,.txt,.md,.json,.csv,text/*')
      if (!picked) return
      const isImage = /\.(png|jpe?g|webp|gif|bmp)$/i.test(picked.name)
      if (isImage) {
        if (picked.bytes.byteLength > MAX_IMAGE_BYTES) {
          toast({ title: '图片太大', description: '请选 800KB 以内的图片', tone: 'warning' })
          return
        }
        if (attachments.filter((item) => item.kind === 'image').length >= MAX_IMAGES) {
          toast({ title: `最多附 ${MAX_IMAGES} 张图片`, tone: 'warning' })
          return
        }
        const content = await bytesToDataUrl(picked.bytes, picked.name)
        setAttachments((current) => [...current, { name: picked.name, kind: 'image', content }])
      } else {
        if (picked.bytes.byteLength > MAX_TEXT_BYTES) {
          toast({ title: '文件太大', description: '文本附件请控制在 50KB 以内', tone: 'warning' })
          return
        }
        const content = new TextDecoder().decode(picked.bytes).slice(0, 20_000)
        setAttachments((current) => [
          ...current,
          { name: picked.name, kind: 'text', content },
        ])
      }
    } catch (cause) {
      toast({ title: '添加附件失败', description: (cause as Error).message, tone: 'danger' })
    }
  }

  const ensureModel = async (): Promise<boolean> => {
    const settings = await readLlmSettings()
    if (isLlmConfigured(settings)) return true
    toast({
      title: '先配置模型',
      description: '生成需要连接一个模型服务',
      tone: 'warning',
    })
    navigate('/settings/model')
    return false
  }

  const submitNew = async () => {
    const text = brief.trim()
    if (text.length < 4) {
      toast({ title: '再多说一点', description: '用一句话描述你想做的工具', tone: 'warning' })
      return
    }
    if (!(await ensureModel())) return

    setBusy(true)
    setError(null)
    try {
      const requirements = inferRequirements(text, attachments)
      const plan = inferPlan(requirements)
      const id = app?.id ?? uid('a_')
      const timestamp = now()
      const draft: PortalApp = {
        id,
        name: '未命名工具',
        emoji: '🧩',
        description: '正在生成',
        html: '',
        manifest: {
          id,
          name: '未命名工具',
          version: '1.0.0',
          entry: 'app/index.html',
          capabilities: plan.capabilities,
          permission_card: { can: [], cannot: [], why: '' },
          generated: { at: 0, model: '', turns: 0 },
        },
        requirements,
        plan,
        status: 'draft',
        step: 'generate',
        createdAt: app?.createdAt ?? timestamp,
        updatedAt: timestamp,
        lastOpenedAt: 0,
        turns: app?.turns ?? 0,
        revisions: app?.revisions ?? [],
      }
      await saveApp(draft)
      setApp(draft)
      await startGeneration(id)
      setAttachments([])
    } catch (cause) {
      const message = (cause as Error).message
      if (message && message !== '已取消') setError(message)
    } finally {
      setBusy(false)
    }
  }

  const submitRevision = async () => {
    if (!app || !feedback.trim()) {
      toast({ title: '说说想改哪里', tone: 'warning' })
      return
    }
    if (!(await ensureModel())) return
    setBusy(true)
    setError(null)
    try {
      await reviseApp(app.id, feedback.trim(), attachments)
      setFeedback('')
      setAttachments([])
      const latest = await getApp(app.id)
      if (latest) setApp(latest)
    } catch (cause) {
      const message = (cause as Error).message
      if (message && message !== '已取消') setError(message)
    } finally {
      setBusy(false)
    }
  }

  const submit = () => {
    if (generating) return
    if (hasHtml) void submitRevision()
    else void submitNew()
  }

  const rollback = async (index: number) => {
    if (!app || generating) return
    setBusy(true)
    try {
      await rollbackRevision(app.id, index)
      const latest = await getApp(app.id)
      if (latest) setApp(latest)
      toast({ title: '已回到这一版', tone: 'success' })
    } catch (cause) {
      toast({ title: '回溯失败', description: (cause as Error).message, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const removeRevision = async () => {
    if (!app || deleteTarget === null) return
    setDeleting(true)
    try {
      const removedCount = app.revisions.length - deleteTarget
      await deleteRevision(app.id, deleteTarget)
      const latest = await getApp(app.id)
      if (latest) setApp(latest)
      setDeleteTarget(null)
      toast({
        title:
          removedCount > 1 ? `已删除这一版及之后 ${removedCount - 1} 条记录` : '已删除这一版',
        description: '工具已回退到这一版之前',
        tone: 'success',
      })
    } catch (cause) {
      toast({ title: '删除失败', description: (cause as Error).message, tone: 'danger' })
    } finally {
      setDeleting(false)
    }
  }

  const retry = () => {
    setError(null)
    if (hasHtml) void submitRevision()
    else void submitNew()
  }

  if (loading) {
    return (
      <div className="flex min-h-[50dvh] items-center justify-center">
        <Spinner label="正在准备" />
      </div>
    )
  }

  return (
    <div className="page">
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 p-3">
          <CircleSlash className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-body font-medium text-danger">这一步没走通</p>
            <p className="mt-0.5 break-words text-caption text-muted-foreground">{error}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={retry}>
                <RefreshCw className="size-3.5" aria-hidden />
                重试
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setError(null)}>
                先不管
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 全新新建 */}
      {!hasHtml && !generating && (
        <>
          {app && (
            <div className="mb-3 rounded-lg border border-border bg-muted p-3">
              <p className="text-body font-medium">上一次生成没有完成</p>
              <p className="mt-0.5 text-caption text-muted-foreground">
                可能是在切到后台时被系统暂停了。需求和附件还在，可以从头再生成一次。
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => void submitNew()}
                disabled={busy}
              >
                继续生成
              </Button>
            </div>
          )}

          <header className="flex flex-col items-center pb-4 pt-6 text-center">
            <DotMark size="xl" className="mb-3" />
            <h1 className="text-display font-semibold">想做点什么？</h1>
          </header>

          <Composer
            value={brief}
            onChange={setBrief}
            placeholder="例如：一个记录每天喝水杯数的小工具，能看这周喝了几杯"
            rows={5}
            attachments={attachments}
            onAddAttachment={() => void addAttachment()}
            onRemoveAttachment={(index) =>
              setAttachments((current) => current.filter((_, position) => position !== index))
            }
            onSubmit={submit}
            submitLabel="开始"
            loading={busy}
          />


          <div className="mt-4">
            <p className="text-center text-caption text-muted-foreground">试试</p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {EXAMPLE_BRIEFS.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setBrief(example)}
                  className="min-h-tap rounded-full border border-border bg-surface px-3.5 text-caption text-foreground shadow-sm transition-colors duration-fast ease-standard active:bg-accent"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* 纯聊天式对话流：需求 → 生成过程 → 每次修改与过程 */}
      {(hasHtml || generating) && (
        <div>
          {hasHtml && app && (
            <section className="mb-3 flex items-center gap-3 rounded-xl border border-border bg-surface p-3 shadow-sm">
              <span
                className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-emoji"
                aria-hidden
              >
                {app.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-medium">{app.name}</p>
                <p className="line-clamp-1 text-caption text-muted-foreground">
                  {app.description}
                </p>
              </div>
              <Button onClick={() => navigate(`/app/${app.id}`)}>
                打开
                <ArrowUpRight className="size-4" aria-hidden />
              </Button>
            </section>
          )}

          <div className="space-y-3">
            <ChatBubble role="user" text={hasHtml ? app?.requirements.brief ?? '' : brief} />

            {!generating && app && (
              <AssistantTurn
                title={`已生成「${app.name}」`}
                meta={formatDateTime(app.createdAt)}
                steps={app.generationSteps}
                onOpen={
                  app.revisions.length === 0 ? () => navigate(`/app/${app.id}`) : undefined
                }
              />
            )}

            {app?.revisions.map((revision, index) => (
              <div key={`${revision.at}-${index}`} className="space-y-3">
                <ChatBubble role="user" text={revision.request} />
                <AssistantTurn
                  title="已按你的意见更新"
                  meta={formatDateTime(revision.at)}
                  steps={revision.steps}
                  onRollback={generating ? undefined : () => void rollback(index)}
                  onDelete={generating ? undefined : () => setDeleteTarget(index)}
                  onOpen={
                    app && index === app.revisions.length - 1
                      ? () => navigate(`/app/${app.id}`)
                      : undefined
                  }
                />
              </div>
            ))}

            {generating && (
              <AssistantTurn
                title={job?.message ?? '正在准备'}
                running
                elapsed={elapsed}
                progress={job?.progress ?? 0}
                steps={job?.steps}
                live={job?.live}
                thinking={job?.thinking}
                liveRef={liveBoxRef}
                thinkingRef={thinkingBoxRef}
                onCancel={app ? () => cancelJob(app.id) : undefined}
              />
            )}

            {generating && job?.phase === 'asking' && job.questions && (
              <AskCard
                questions={job.questions}
                onSubmit={(answers) => answerJobQuestions(app!.id, answers)}
              />
            )}

            {generating && (
              <p className="text-center text-caption text-muted-foreground">
                {job?.phase === 'asking'
                  ? '在等你确认上面这几个关键点。'
                  : job && ['checking', 'repairing', 'saving'].includes(job.phase)
                    ? '代码写完了，正在做最后的检查与保存。'
                    : !job?.live && !job?.thinking
                    ? `模型还没开始输出，已等待 ${elapsed} 秒…`
                    : '生成时请保持门户在前台。'}
              </p>
            )}

            <div ref={streamEndRef} />
            {!generating && <div style={{ height: composerHeight }} aria-hidden />}
          </div>

          {!generating && (
            <div
              ref={composerDockRef}
              className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background px-4 pb-safe-bottom pt-2"
            >
              <div className="mx-auto w-full max-w-[640px]">
                <Composer
                  value={feedback}
                  onChange={setFeedback}
                  placeholder="继续说想改什么，比如「标题小一点」「加一个导出按钮」"
                  rows={2}
                  attachments={attachments}
                  onAddAttachment={() => void addAttachment()}
                  onRemoveAttachment={(index) =>
                    setAttachments((current) =>
                      current.filter((_, position) => position !== index),
                    )
                  }
                  onSubmit={submit}
                  submitLabel="继续修改"
                  loading={busy}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <Dialog
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleting) setDeleteTarget(null)
        }}
        title="删除这一版？"
        description="工具会回退到这一版之前的状态；这一版之后、依赖它的修改记录也会一起删除。此操作不可撤销。"
        footer={
          <>
            <Button variant="ghost" disabled={deleting} onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button variant="danger" loading={deleting} onClick={() => void removeRevision()}>
              删除并回退
            </Button>
          </>
        }
      >
        {deleteTarget !== null && app && app.revisions[deleteTarget] && (
          <div className="rounded-md bg-muted p-3">
            <p className="line-clamp-2 text-body">{app.revisions[deleteTarget].request}</p>
            <p className="mt-1 text-caption text-muted-foreground">
              {formatDateTime(app.revisions[deleteTarget].at)}
            </p>
          </div>
        )}
      </Dialog>
    </div>
  )
}

/** 聊天输入栏：附件 + 输入 + 发送，新建和继续开发共用 */
function Composer({
  value,
  onChange,
  placeholder,
  rows,
  attachments,
  onAddAttachment,
  onRemoveAttachment,
  onSubmit,
  submitLabel,
  loading,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  rows: number
  attachments: RequirementAttachment[]
  onAddAttachment: () => void
  onRemoveAttachment: (index: number) => void
  onSubmit: () => void
  submitLabel: string
  loading: boolean
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-2 shadow-sm transition-colors duration-fast focus-within:border-primary/40">
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="field-plain w-full resize-none bg-transparent px-2 py-2 text-body placeholder:text-muted-foreground"
      />

      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2 px-1 pb-1">
          {attachments.map((item, index) => (
            <li
              key={`${item.name}-${index}`}
              className="flex items-center gap-1.5 rounded-full bg-muted pl-2.5 pr-1 text-caption"
            >
              <span className="max-w-[140px] truncate">{item.name}</span>
              <button
                type="button"
                aria-label={`移除 ${item.name}`}
                onClick={() => onRemoveAttachment(index)}
                className="flex size-8 items-center justify-center rounded-full text-muted-foreground active:bg-accent"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-2 px-1">
        <button
          type="button"
          onClick={onAddAttachment}
          className="flex min-h-tap items-center gap-1.5 rounded-md px-2 text-caption text-muted-foreground active:bg-accent"
        >
          <Paperclip className="size-4" aria-hidden />
          附件
        </button>
        <Button variant="spark" loading={loading} onClick={onSubmit}>
          <Sparkles className="size-4" aria-hidden />
          {submitLabel}
        </Button>
      </div>
    </section>
  )
}

/** 助手的一轮回复：结论 + 可展开的过程 */
function AssistantTurn({
  title,
  meta,
  steps,
  running,
  elapsed,
  progress,
  live,
  thinking,
  liveRef,
  thinkingRef,
  onOpen,
  onDelete,
  onCancel,
  onRollback,
}: {
  title: string
  meta?: string
  steps?: JobStep[]
  running?: boolean
  elapsed?: number
  progress?: number
  live?: string
  thinking?: string
  liveRef?: RefObject<HTMLPreElement | null>
  thinkingRef?: RefObject<HTMLPreElement | null>
  /** 结果卡片上的一键打开：放在用户此刻正在看的卡片底部 */
  onOpen?: () => void
  /** 删除这一版（同时回退代码）；只在历史回合上出现 */
  onDelete?: () => void
  onCancel?: () => void
  onRollback?: () => void
}) {
  // 默认展开：让用户一眼看到这一步做了哪些事
  const [open, setOpen] = useState(true)

  const hasSteps = Boolean(steps && steps.length > 0)

  return (
    <div className="flex justify-start">
      <div className="w-full rounded-lg border border-border bg-surface p-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-md',
              running ? 'bg-primary-soft' : 'bg-success/10',
            )}
          >
            {running ? (
              <DotPulse className="text-primary" />
            ) : (
              <Check className="size-4 text-success" strokeWidth={3} aria-hidden />
            )}
          </span>
          <p className="min-w-0 flex-1 truncate text-body font-medium">{title}</p>
          {meta && <span className="shrink-0 text-caption text-muted-foreground">{meta}</span>}
        </div>

        {running && typeof progress === 'number' && (
          <div className="mt-3">
            <div className="flex items-baseline justify-between text-caption text-muted-foreground">
              <span>生成进度</span>
              <span className="tabular-nums text-foreground">
                {Math.max(0, Math.min(100, Math.round(progress)))}%
              </span>
            </div>
            <div
              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={Math.round(progress)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="relative h-full overflow-hidden rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${Math.max(4, Math.min(100, progress))}%` }}
              >
                <span className="progress-shine" aria-hidden />
              </div>
            </div>
          </div>
        )}

        {hasSteps && (
          <>
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="mt-2 flex min-h-tap w-full items-center justify-between border-t border-border pt-2 text-caption text-muted-foreground"
            >
              <span>
                {running
                  ? `进行中${typeof elapsed === 'number' && elapsed > 0 ? ` · 已用 ${elapsed} 秒` : ''}`
                  : '过程'}
              </span>
              <ChevronDown
                className={cn('size-3.5 transition-transform duration-200', open && 'rotate-180')}
                aria-hidden
              />
            </button>
            {open && (
              <div className="mt-1">
                <StepList
                  steps={steps ?? []}
                  live={live}
                  thinking={thinking}
                  liveRef={liveRef}
                  thinkingRef={thinkingRef}
                />
              </div>
            )}
          </>
        )}

        {onOpen && (
          <Button block className="mt-3" onClick={onOpen}>
            打开工具
            <ArrowUpRight className="size-4" aria-hidden />
          </Button>
        )}

        {running && onCancel && (
          <div className="mt-2 flex justify-end border-t border-border pt-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              <X className="size-3.5" aria-hidden />
              停止生成
            </Button>
          </div>
        )}

        {!running && (onRollback || onDelete) && (
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-1">
            {onRollback ? (
              <button
                type="button"
                onClick={onRollback}
                className="flex min-h-tap items-center gap-1.5 text-left text-caption text-muted-foreground active:opacity-70"
              >
                <RotateCcw className="size-3.5" aria-hidden />
                回到这一版
              </button>
            ) : (
              <span />
            )}
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="flex min-h-tap items-center gap-1.5 text-caption text-danger active:opacity-70"
              >
                <Trash2 className="size-3.5" aria-hidden />
                删除这一版
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** 关键疑问确认卡：计划阶段模型提出的问题，点选项或自填 */
function AskCard({
  questions,
  onSubmit,
}: {
  questions: ClarifyQuestion[]
  onSubmit: (answers: Record<string, string>) => void
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const answeredAll = questions.every((question) => (answers[question.id] ?? '').trim().length > 0)

  return (
    <section className="onboarding-rise rounded-xl border border-spark/40 bg-spark-soft/60 p-4">
      <header className="flex items-center gap-2">
        <CircleHelp className="size-4 text-spark" aria-hidden />
        <p className="text-body font-medium">有几个关键点需要你定</p>
      </header>
      <p className="mt-0.5 text-caption text-muted-foreground">
        都能自己猜的就直接做了，这几个答案会明显改变做法。
      </p>

      <ol className="mt-3 space-y-3">
        {questions.map((question) => (
          <li key={question.id}>
            <p className="text-body">{question.question}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {question.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setAnswers((current) => ({ ...current, [question.id]: option }))}
                  className={cn(
                    'min-h-tap rounded-full border px-3.5 text-caption transition-colors duration-fast ease-standard',
                    answers[question.id] === option
                      ? 'border-spark bg-spark text-spark-foreground'
                      : 'border-border bg-surface text-foreground active:bg-accent',
                  )}
                >
                  {option}
                </button>
              ))}
              <input
                value={answers[question.id] ?? ''}
                onChange={(event) =>
                  setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                }
                placeholder="或自己写"
                maxLength={60}
                className="min-h-tap min-w-[7rem] flex-1 rounded-full border border-input bg-surface px-3.5 text-caption outline-none focus:border-primary"
              />
            </div>
          </li>
        ))}
      </ol>

      <Button
        block
        variant="spark"
        className="mt-4"
        disabled={!answeredAll}
        onClick={() => onSubmit(answers)}
      >
        继续
      </Button>
    </section>
  )
}

function ChatBubble({
  role,
  text,
  meta,
}: {
  role: 'user' | 'assistant'
  text: string
  meta?: string
}) {
  const isUser = role === 'user'
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[86%] rounded-lg px-3 py-2 text-body',
          isUser
            ? 'rounded-br-sm border border-primary/15 bg-primary-soft text-foreground'
            : 'rounded-bl-sm bg-muted text-foreground',
        )}
      >
        <p className="whitespace-pre-wrap break-words">{text}</p>
        {meta && <p className="mt-1 text-caption">{meta}</p>}
      </div>
    </div>
  )
}

/** 流式内容里尽量把 html 字段还原成代码，预览更像「正在写应用」 */
function previewLive(live: string): string {
  let text = live
  const marker = live.indexOf('"html"')
  if (marker >= 0) {
    const colon = live.indexOf(':', marker)
    if (colon >= 0) {
      text = live.slice(colon + 1).trimStart()
      if (text.startsWith('"')) text = text.slice(1)
    }
  }
  const normalized = text
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '  ')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
  return normalized.length > 3500 ? `…${normalized.slice(-3500)}` : normalized
}

function StepIcon({ status }: { status: JobStep['status'] }) {
  if (status === 'done') return <Check className="size-4 text-success" aria-hidden />
  if (status === 'active') return <DotPulse className="text-primary" />
  if (status === 'warn') return <AlertTriangle className="size-4 text-warning" aria-hidden />
  if (status === 'error') return <CircleSlash className="size-4 text-danger" aria-hidden />
  return <span className="size-4 rounded-full border border-border" aria-hidden />
}

function StepList({
  steps,
  live,
  thinking,
  liveRef,
  thinkingRef,
}: {
  steps: JobStep[]
  live?: string
  thinking?: string
  liveRef?: RefObject<HTMLPreElement | null>
  thinkingRef?: RefObject<HTMLPreElement | null>
}) {
  const [expanded, setExpanded] = useState<string[]>([])
  const activeId = steps.find((step) => step.status === 'active')?.id

  // 当前步骤默认展开；用户手动收起后不强行再展开
  useEffect(() => {
    if (!activeId) return
    setExpanded((current) => (current.includes(activeId) ? current : [...current, activeId]))
  }, [activeId])

  const toggle = (id: string) => {
    setExpanded((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  if (steps.length === 0) {
    return <p className="text-caption text-muted-foreground">正在规划要做的步骤…</p>
  }

  return (
    <ol className="space-y-0.5">
      {steps.map((step, index) => {
        const open = expanded.includes(step.id)
        const seconds =
          step.status === 'active' && step.startedAt
            ? Math.max(0, Math.floor((Date.now() - step.startedAt) / 1000))
            : step.startedAt && step.finishedAt
              ? Math.max(0, Math.round((step.finishedAt - step.startedAt) / 1000))
              : 0
        return (
          <li key={step.id} className="relative">
            {index < steps.length - 1 && (
              <span
                className="absolute left-3 top-7 h-[calc(100%-12px)] w-px bg-border"
                aria-hidden
              />
            )}
            <button
              type="button"
              onClick={() => toggle(step.id)}
              aria-expanded={open}
              className="flex min-h-tap w-full items-center gap-2 text-left"
            >
              <span className="relative z-10 grid size-4 shrink-0 place-items-center rounded-full bg-surface">
                <StepIcon status={step.status} />
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-body',
                  step.status === 'pending'
                    ? 'text-muted-foreground'
                    : step.status === 'active'
                      ? 'font-medium text-foreground'
                      : 'text-foreground',
                )}
              >
                {step.title}
              </span>
              {step.status !== 'pending' && (
                <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                  {step.logs.length > 0 ? `${step.logs.length} 条` : ''}
                  {step.logs.length > 0 && seconds > 0 ? ' · ' : ''}
                  {seconds > 0 ? `${seconds}s` : ''}
                </span>
              )}
              <ChevronDown
                className={cn(
                  'size-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
                  open && 'rotate-180',
                )}
                aria-hidden
              />
            </button>

            {open && (
              <div className="mb-1 ml-6 border-l border-border pl-3">
                {step.detail && (
                  <p className="py-1 text-caption text-muted-foreground">{step.detail}</p>
                )}
                {step.logs.map((log) => (
                  <div key={log.id} className="flex gap-2 py-0.5">
                    <span
                      className={cn(
                        'mt-1.5 size-1.5 shrink-0 rounded-full',
                        log.kind === 'ok'
                          ? 'bg-success'
                          : log.kind === 'warn'
                            ? 'bg-warning'
                            : log.kind === 'error'
                              ? 'bg-danger'
                              : log.kind === 'act'
                                ? 'bg-primary'
                                : 'bg-muted-foreground',
                      )}
                      aria-hidden
                    />
                    <p
                      className={cn(
                        'min-w-0 flex-1 break-words text-caption leading-relaxed',
                        log.kind === 'error'
                          ? 'text-danger'
                          : log.kind === 'ok'
                            ? 'text-foreground'
                            : 'text-muted-foreground',
                      )}
                    >
                      {log.text}
                    </p>
                  </div>
                ))}
                {step.status === 'active' && thinking && (
                  <div className="mt-2 overflow-hidden rounded-lg bg-foreground">
                    <div className="flex items-center gap-2 border-b border-background/10 px-2.5 py-1.5">
                      <span
                        className="dot-pulse-core size-1.5 rounded-full bg-spark-bright"
                        aria-hidden
                      />
                      <span className="text-caption font-medium text-background/85">模型思考 · 实时</span>
                    </div>
                    <pre
                      ref={thinkingRef}
                      className="max-h-[30dvh] overflow-y-auto whitespace-pre-wrap break-words p-2.5 text-caption leading-relaxed text-background/65"
                    >
                      {thinking}
                    </pre>
                  </div>
                )}
                {step.status === 'active' && live && (
                  <div className="mt-2 overflow-hidden rounded-lg bg-foreground">
                    <div className="flex items-center gap-2 border-b border-background/10 px-2.5 py-1.5">
                      <span
                        className="dot-pulse-core size-1.5 rounded-full bg-spark-bright"
                        aria-hidden
                      />
                      <span className="text-caption font-medium text-background/85">正在写代码 · 实时</span>
                    </div>
                    <pre
                      ref={liveRef}
                      className="max-h-[40dvh] overflow-y-auto whitespace-pre-wrap break-all p-2.5 font-mono text-caption leading-relaxed text-background/75"
                    >
                      {previewLive(live)}
                    </pre>
                  </div>
                )}
                {step.logs.length === 0 && !(step.id === 'write' && (live || thinking)) && (
                  <p className="py-1 text-caption text-muted-foreground">
                    {step.status === 'pending' ? '等待中' : '这一步还没有输出'}
                  </p>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
