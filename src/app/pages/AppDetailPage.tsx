import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ChevronRight,
  Clipboard,
  Download,
  FileCode2,
  History,
  Settings,
  Trash2,
  ScrollText,
  MessageSquarePlus,
  Code2,
} from 'lucide-react'

import { usePageTitle } from '@/app/layout/PageTitle'
import { invokeNative } from '@/shared/bridge'
import {
  addAudit,
  deleteApp,
  deleteAppTriggers,
  deleteGrant,
  getApp,
  kvBytes,
  kvClear,
  clearLogs,
  listGrants,
  listLogs,
  listTriggers,
  listUsage,
  saveTrigger,
} from '@/shared/portal/db'
import { buildPackage } from '@/shared/portal/package'
import { isDeviceGroup } from '@/shared/portal/device'
import { rollbackRevision } from '@/shared/portal/generator'
import { getBudget, monthAppTokens, setBudget } from '@/shared/portal/budget'
import type {
  AppCapabilityKey,
  CapabilityGrant,
  LogRecord,
  PortalApp,
  UsageRecord,
} from '@/shared/portal/types'
import { downloadBlob, formatBytes, formatDateTime, formatRelativeTime, now, uid } from '@/shared/portal/utils'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Dialog'
import { EmptyState, Spinner } from '@/shared/ui/Feedback'
import { useToast } from '@/shared/ui/Toast'

const CAPABILITY_LABEL: Record<AppCapabilityKey, string> = {
  storage: '保存数据到本机',
  llm: '使用 AI',
  network: '访问网络',
  clipboard: '读写剪贴板',
  files: '使用文件',
  bluetooth: '使用蓝牙',
  record: '使用麦克风',
  camera: '使用相机',
  location: '获取位置',
  notifications: '给你发提醒',
  triggers: '设置触发器',
  deviceApps: '打开其它应用',
  deviceFiles: '管理本机文件',
  deviceUpload: '上传文件',
  deviceHaptics: '震动反馈',
  deviceSpeech: '语音播报',
  deviceSystem: '修改系统设置',
  deviceRecorder: '用快记录音',
  deviceCameraModes: '相机模式',
  deviceWeather: '查询天气',
}

const CAPABILITY_ORDER: AppCapabilityKey[] = [
  'storage',
  'llm',
  'network',
  'clipboard',
  'files',
  'bluetooth',
  'record',
  'camera',
  'location',
  'notifications',
  'triggers',
  'deviceApps',
  'deviceFiles',
  'deviceUpload',
  'deviceHaptics',
  'deviceSpeech',
  'deviceSystem',
  'deviceRecorder',
  'deviceCameraModes',
  'deviceWeather',
]

export function AppDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [app, setApp] = useState<PortalApp | null | undefined>(undefined)
  const [grants, setGrants] = useState<CapabilityGrant[]>([])
  const [usage, setUsage] = useState<UsageRecord[]>([])
  const [bytes, setBytes] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const [logs, setLogs] = useState<LogRecord[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const [budget, setBudgetValue] = useState<number | null>(null)
  const [monthTokens, setMonthTokens] = useState(0)
  const [showBudget, setShowBudget] = useState(false)
  const [budgetInput, setBudgetInput] = useState('')
  const [busy, setBusy] = useState(false)

  usePageTitle(app?.name ?? '应用详情')

  const load = useCallback(async () => {
    const found = await getApp(id)
    setApp(found ?? null)
    if (!found) return
    const [grantList, usageList, size, logList, limit, monthly] = await Promise.all([
      listGrants(found.id),
      listUsage(),
      kvBytes(found.id),
      listLogs(found.id),
      getBudget(found.id),
      monthAppTokens(found.id),
    ])
    setGrants(grantList)
    setUsage(usageList.filter((item) => item.appId === found.id))
    setBytes(size)
    setLogs(logList)
    setBudgetValue(limit)
    setMonthTokens(monthly)
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const copySource = async () => {
    if (!app) return
    let copied = false
    try {
      await invokeNative('setClipboardData', { data: app.html })
      copied = true
    } catch {
      copied = false
    }
    if (!copied) {
      try {
        await navigator.clipboard.writeText(app.html)
        copied = true
      } catch {
        copied = false
      }
    }
    toast({
      title: copied ? '源码已复制' : '复制失败',
      description: copied ? '可以粘贴到任意文本编辑器里保存' : '请长按下方源码手动选择',
      tone: copied ? 'success' : 'danger',
    })
  }

  const exportPackage = async () => {
    if (!app) return
    try {
      const { bytes: data, filename } = buildPackage(app)
      downloadBlob(new Blob([data as unknown as BlobPart], { type: 'application/zip' }), filename)
      await addAudit({
        id: uid('au_'),
        appId: app.id,
        appName: app.name,
        kind: 'app.export',
        detail: filename,
        at: now(),
      })
      toast({
        title: '已导出 .neon-aap',
        description: '如果系统没有弹出保存，可以用「复制源码」保存',
        tone: 'success',
      })
    } catch (error) {
      toast({ title: '导出失败', description: (error as Error).message, tone: 'danger' })
    }
  }

  const clearData = async () => {
    if (!app) return
    await kvClear(app.id)
    await addAudit({
      id: uid('au_'),
      appId: app.id,
      appName: app.name,
      kind: 'storage.clear',
      detail: '清空应用数据',
      at: now(),
    })
    setBytes(0)
    toast({ title: '数据已清空', tone: 'success' })
  }

  const revoke = async (capability: CapabilityGrant['capability']) => {
    if (!app) return
    await deleteGrant(app.id, capability)
    // 撤回触发器能力时一并清掉它注册的触发器；撤回定位时停用位置触发器
    if (capability === 'triggers') {
      await deleteAppTriggers(app.id)
    } else if (capability === 'location') {
      const list = await listTriggers(app.id)
      for (const item of list) {
        if (item.kind === 'location') await saveTrigger({ ...item, enabled: false })
      }
    }
    await addAudit({
      id: uid('au_'),
      appId: app.id,
      appName: app.name,
      kind: 'capability.revoke',
      detail: `撤回「${CAPABILITY_LABEL[capability]}」`,
      at: now(),
    })
    setGrants((current) => current.filter((item) => item.capability !== capability))
    toast({ title: `已撤回「${CAPABILITY_LABEL[capability]}」`, tone: 'info' })
  }

  const rollback = async (index: number) => {
    if (!app) return
    setBusy(true)
    try {
      await rollbackRevision(app.id, index)
      await load()
      toast({ title: '已回到那一版', tone: 'success' })
    } catch (error) {
      toast({ title: '回滚失败', description: (error as Error).message, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!app) return
    setBusy(true)
    try {
      await deleteApp(app.id)
      await addAudit({
        id: uid('au_'),
        appId: app.id,
        appName: app.name,
        kind: 'app.delete',
        detail: '删除应用与数据',
        at: now(),
      })
      toast({ title: '已删除', tone: 'info' })
      navigate('/')
    } catch (error) {
      toast({ title: '删除失败', description: (error as Error).message, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  if (app === undefined) {
    return (
      <div className="flex min-h-[50dvh] items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (app === null) {
    return (
      <EmptyState
        title="找不到这个应用"
        description="它可能已经被删除了。"
        action={<Button onClick={() => navigate('/')}>回到我的工具</Button>}
      />
    )
  }

  const totalIn = usage.reduce((sum, item) => sum + item.inputTokens, 0)
  const totalOut = usage.reduce((sum, item) => sum + item.outputTokens, 0)
  const granted = new Set(grants.map((item) => item.capability))

  return (
    <div className="page space-y-3">
      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-start gap-3 p-4">
          <span
            className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-display leading-none"
            aria-hidden
          >
            {app.emoji}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-title font-semibold">{app.name}</h2>
              <span className="rounded-sm bg-muted px-1.5 py-0.5 text-caption text-muted-foreground">
                v{app.manifest.version}
              </span>
            </div>
            <p className="mt-1 text-body text-muted-foreground">{app.description}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate(`/app/${app.id}/settings`)}
          className="list-row w-full items-center border-t border-border py-3 text-left active:bg-accent"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Settings className="size-4 text-muted-foreground" aria-hidden />
            <span className="text-body">应用设置</span>
            <span className="text-caption text-muted-foreground">通知与触发器</span>
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <ul>
          <li className="list-row py-3">
            <div className="min-w-0 flex-1">
              <p className="text-body">生成模型</p>
              <p className="text-caption text-muted-foreground">
                {app.manifest.generated.model || '未知'} · {app.turns} 轮
              </p>
            </div>
            <span className="text-caption text-muted-foreground">
              {app.manifest.generated.at > 0 ? formatDateTime(app.manifest.generated.at) : '—'}
            </span>
          </li>
          <li className="list-row py-3">
            <div className="min-w-0 flex-1">
              <p className="text-body">用量</p>
              <p className="text-caption text-muted-foreground">
                {usage.length} 次调用 · 输入 {totalIn} / 输出 {totalOut} tokens
              </p>
              {app.manifest.capabilities.llm && (
                <p className="mt-0.5 text-caption text-muted-foreground">
                  本月应用 AI：{monthTokens} tokens{budget ? ` / 上限 ${budget}` : ' · 不限'}
                </p>
              )}
            </div>
            {app.manifest.capabilities.llm && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setBudgetInput(budget ? String(budget) : '')
                  setShowBudget(true)
                }}
              >
                额度
              </Button>
            )}
          </li>
          <li className="list-row py-3">
            <div className="min-w-0 flex-1">
              <p className="text-body">本机数据</p>
              <p className="text-caption text-muted-foreground">{formatBytes(bytes)}</p>
            </div>
            {bytes > 0 && (
              <Button size="sm" variant="ghost" onClick={() => void clearData()}>
                清空
              </Button>
            )}
          </li>
        </ul>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="px-4 pt-3">
          <p className="text-body font-medium">能力授权</p>
          <p className="mt-0.5 text-caption text-muted-foreground">
            应用第一次用到某项能力时会问你；这里可以随时撤回。
          </p>
        </div>
        <ul className="mt-1">
          {CAPABILITY_ORDER.map((capability) => {
            const declared =
              capability === 'network'
                ? app.manifest.capabilities.network.length > 0
                : isDeviceGroup(capability)
                  ? Boolean(app.manifest.capabilities.device?.includes(capability))
                  : Boolean(app.manifest.capabilities[capability])
            if (!declared) return null
            return (
              <li key={capability} className="list-row py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-body">{CAPABILITY_LABEL[capability]}</p>
                  {capability === 'network' && (
                    <p className="text-caption text-muted-foreground">
                      {app.manifest.capabilities.network.join('、')}
                    </p>
                  )}
                </div>
                {granted.has(capability) ? (
                  <button
                    type="button"
                    onClick={() => void revoke(capability)}
                    className="min-h-tap text-caption text-danger"
                  >
                    撤回
                  </button>
                ) : (
                  <span className="text-caption text-muted-foreground">未授权</span>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <section className="rounded-lg border border-border bg-surface p-3">
        <div className="flex items-center gap-2">
          <Code2 className="size-4 text-muted-foreground" aria-hidden />
          <p className="text-body font-medium">开发面板</p>
        </div>
        <p className="mt-1 text-caption text-muted-foreground">
          继续用对话改这个应用；最早的开发记录也在里面。
        </p>
        <Button
          className="mt-2"
          block
          onClick={() => navigate(`/studio?app=${app.id}`)}
        >
          <MessageSquarePlus className="size-4" aria-hidden />
          继续开发
        </Button>
        <button
          type="button"
          onClick={() => setShowSource((value) => !value)}
          className="mt-3 flex min-h-tap w-full items-center justify-between border-t border-border pt-2 text-left"
        >
          <span className="flex items-center gap-2 text-body">
            <FileCode2 className="size-4 text-muted-foreground" aria-hidden />
            查看源码
          </span>
          <span className="text-caption text-muted-foreground">{showSource ? '收起' : '展开'}</span>
        </button>
        {showSource && (
          <pre className="mt-2 max-h-[50dvh] overflow-auto rounded-md bg-muted p-3 font-mono text-caption leading-relaxed">
            {app.html}
          </pre>
        )}
        <button
          type="button"
          onClick={() => setShowLogs(true)}
          className="flex min-h-tap w-full items-center justify-between border-t border-border pt-2 text-left"
        >
          <span className="flex items-center gap-2 text-body">
            <ScrollText className="size-4 text-muted-foreground" aria-hidden />
            调试日志
          </span>
          <span className="text-caption text-muted-foreground">{logs.length} 条</span>
        </button>
      </section>

      <section className="rounded-lg border border-border bg-surface p-3">
        <p className="text-body font-medium">分享与审计</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => void exportPackage()}>
            <Download className="size-4" aria-hidden />
            导出包
          </Button>
          <Button variant="outline" onClick={() => void copySource()}>
            <Clipboard className="size-4" aria-hidden />
            复制源码
          </Button>
        </div>
        <p className="mt-2 text-caption text-muted-foreground">
          导出的是 .neon-aap 文件，包含 manifest 与完整源码，任何人可打开审计。
        </p>
      </section>

      {app.revisions.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="flex items-center gap-2 px-4 pt-3">
            <History className="size-4 text-muted-foreground" aria-hidden />
            <p className="text-body font-medium">修改记录</p>
          </div>
          <ul className="mt-1">
            {app.revisions.map((revision, index) => (
              <li key={`${revision.at}-${index}`} className="list-row py-3">
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-body">{revision.request}</p>
                  <p className="mt-0.5 text-caption text-muted-foreground">
                    {formatDateTime(revision.at)} · {revision.summary}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy}
                  onClick={() => void rollback(index)}
                >
                  回到这一版
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Button variant="danger-ghost" block onClick={() => setConfirmDelete(true)}>
        <Trash2 className="size-4" aria-hidden />
        删除这个应用与它的数据
      </Button>
      <p className="pb-2 text-center text-caption text-muted-foreground">
        删除后本机数据不可恢复，建议先导出或备份。
      </p>

      <Dialog
        open={showBudget}
        onClose={() => setShowBudget(false)}
        title="AI 月度额度"
        description="只统计这个应用调用 AI 的 token；留空表示不限。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowBudget(false)}>
              取消
            </Button>
            <Button
              onClick={() => {
                void (async () => {
                  const value = Number(budgetInput)
                  await setBudget(app.id, Number.isFinite(value) && value > 0 ? value : null)
                  setShowBudget(false)
                  await load()
                  toast({ title: '额度已更新', tone: 'success' })
                })()
              }}
            >
              保存
            </Button>
          </>
        }
      >
        <label htmlFor="budget-input" className="text-caption font-medium">
          每月最多使用（tokens）
        </label>
        <input
          id="budget-input"
          type="number"
          inputMode="numeric"
          min={0}
          value={budgetInput}
          onChange={(event) => setBudgetInput(event.target.value)}
          placeholder="留空表示不限"
          className="mt-1 w-full rounded-md border border-input bg-surface px-3 py-2.5 text-body outline-none focus:border-primary"
        />
        <p className="mt-2 text-caption text-muted-foreground">
          本月已用 {monthTokens} tokens。达到上限后，应用里的 AI 功能会提示你调整额度。
        </p>
      </Dialog>

      <Dialog
        open={showLogs}
        onClose={() => setShowLogs(false)}
        title="调试日志"
        description="只在本机保留最近 500 条，按时间倒序。"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                void clearLogs(app.id).then(() => {
                  setLogs([])
                  setShowLogs(false)
                  toast({ title: '日志已清空', tone: 'info' })
                })
              }}
            >
              清空日志
            </Button>
            <Button variant="outline" onClick={() => setShowLogs(false)}>
              关闭
            </Button>
          </>
        }
      >
        {logs.length === 0 ? (
          <p className="text-caption text-muted-foreground">这个工具还没有产生日志。</p>
        ) : (
          <ul className="max-h-[55dvh] space-y-2 overflow-y-auto">
            {logs.slice(0, 60).map((log) => (
              <li key={log.id} className="rounded-md bg-muted p-2">
                <div className="flex items-center gap-2 text-caption">
                  <span
                    className={
                      log.level === 'error'
                        ? 'font-medium text-danger'
                        : log.level === 'warn'
                          ? 'font-medium text-warning'
                          : 'text-muted-foreground'
                    }
                  >
                    {log.level}
                  </span>
                  <span className="text-muted-foreground">{formatRelativeTime(log.at)}</span>
                  <span className="ml-auto font-mono text-caption text-muted-foreground">
                    {log.traceId}
                  </span>
                </div>
                <p className="mt-1 break-words text-caption">{log.message}</p>
                {log.data && (
                  <p className="mt-1 break-all font-mono text-caption text-muted-foreground">
                    {log.data.slice(0, 300)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Dialog>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="删除这个应用？"
        description="应用代码和它保存的所有数据都会被移除，无法恢复。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              取消
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void remove()}>
              删除
            </Button>
          </>
        }
      >
        <p className="text-body">要删除的是「{app.name}」。</p>
      </Dialog>
    </div>
  )
}
