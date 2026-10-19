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
import { useI18n } from '@/shared/i18n'
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
import { deleteRevision, rollbackRevision } from '@/shared/portal/generator'
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
  storage: 'cap.storage.title',
  llm: 'cap.llm.title',
  network: 'cap.network.title',
  clipboard: 'cap.clipboard.title',
  files: 'cap.files.title',
  bluetooth: 'cap.bluetooth.title',
  record: 'cap.record.title',
  camera: 'cap.camera.title',
  location: 'cap.location.title',
  notifications: 'cap.notifications.title',
  triggers: 'cap.triggers.title',
  deviceApps: 'cap.deviceApps.title',
  deviceFiles: 'cap.deviceFiles.title',
  deviceUpload: 'cap.deviceUpload.title',
  deviceHaptics: 'cap.deviceHaptics.title',
  deviceSpeech: 'cap.deviceSpeech.title',
  deviceSystem: 'cap.deviceSystem.title',
  deviceRecorder: 'cap.deviceRecorder.title',
  deviceCameraModes: 'cap.deviceCameraModes.title',
  deviceWeather: 'cap.deviceWeather.title',
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
  const [confirmClear, setConfirmClear] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const [logs, setLogs] = useState<LogRecord[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const [budget, setBudgetValue] = useState<number | null>(null)
  const [monthTokens, setMonthTokens] = useState(0)
  const [showBudget, setShowBudget] = useState(false)
  const [budgetInput, setBudgetInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null)
  const [deletingRevision, setDeletingRevision] = useState(false)

  const { t } = useI18n()
  usePageTitle(app?.name ?? t('detail.title'))

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
    if (copied) {
      toast({ title: t('detail.copied'), tone: 'success' })
    } else {
      toast({ title: t('detail.copyFail'), description: t('detail.copyFailDesc'), tone: 'danger' })
    }
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
        title: t('detail.exported'),
        description: t('detail.exportedDesc'),
        tone: 'success',
      })
    } catch (error) {
      toast({ title: t('detail.exportFail'), description: (error as Error).message, tone: 'danger' })
    }
  }

  const clearData = async () => {
    if (!app) return
    setBusy(true)
    try {
      await kvClear(app.id)
      await addAudit({
        id: uid('au_'),
        appId: app.id,
        appName: app.name,
        kind: 'storage.clear',
        detail: t('detail.clearAudit'),
        at: now(),
      })
      setBytes(0)
      setConfirmClear(false)
      toast({ title: t('detail.cleared'), tone: 'success' })
    } catch (error) {
      toast({ title: t('detail.clearFail'), description: (error as Error).message, tone: 'danger' })
    } finally {
      setBusy(false)
    }
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
      detail: t('detail.revokeAudit', { cap: t(CAPABILITY_LABEL[capability]) }),
      at: now(),
    })
    setGrants((current) => current.filter((item) => item.capability !== capability))
    toast({ title: t('detail.revoked', { cap: t(CAPABILITY_LABEL[capability]) }), tone: 'info' })
  }

  const rollback = async (index: number) => {
    if (!app) return
    setBusy(true)
    try {
      await rollbackRevision(app.id, index)
      await load()
      toast({ title: t('studio.rolledBack'), tone: 'success' })
    } catch (error) {
      toast({ title: t('studio.rollbackFail'), description: (error as Error).message, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const removeRevision = async () => {
    if (!app || deleteTarget === null) return
    setDeletingRevision(true)
    try {
      const removedCount = app.revisions.length - deleteTarget
      await deleteRevision(app.id, deleteTarget)
      setDeleteTarget(null)
      await load()
      toast({
        title:
          removedCount > 1
            ? t('studio.deletedMany', { count: removedCount - 1 })
            : t('studio.deletedOne'),
        description: t('studio.deletedDesc'),
        tone: 'success',
      })
    } catch (error) {
      toast({ title: t('studio.deleteFail'), description: (error as Error).message, tone: 'danger' })
    } finally {
      setDeletingRevision(false)
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
        detail: t('detail.deleteAudit'),
        at: now(),
      })
      toast({ title: t('detail.deletedApp'), tone: 'info' })
      navigate('/')
    } catch (error) {
      toast({ title: t('studio.deleteFail'), description: (error as Error).message, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  if (app === undefined) {
    return (
      <div className="flex min-h-[50dvh] items-center justify-center">
        <Spinner label={t('detail.opening')} />
      </div>
    )
  }

  if (app === null) {
    return (
      <EmptyState
        title={t('detail.notFound')}
        description={t('detail.notFoundDesc')}
        action={<Button onClick={() => navigate('/')}>{t('detail.backHome')}</Button>}
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
            <span className="text-body">{t('detail.appSettings')}</span>
            <span className="text-caption text-muted-foreground">{t('detail.appSettingsHint')}</span>
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <ul>
          <li className="list-row py-3">
            <div className="min-w-0 flex-1">
              <p className="text-body">{t('detail.genModel')}</p>
              <p className="text-caption text-muted-foreground">
                {app.manifest.generated.model || t('detail.unknown')} · {t('detail.turns', { count: app.turns })}
              </p>
            </div>
            <span className="text-caption text-muted-foreground">
              {app.manifest.generated.at > 0 ? formatDateTime(app.manifest.generated.at) : '—'}
            </span>
          </li>
          <li className="list-row py-3">
            <div className="min-w-0 flex-1">
              <p className="text-body">{t('detail.usage')}</p>
              <p className="text-caption text-muted-foreground">
                {t('detail.usageValue', { count: usage.length, in: totalIn, out: totalOut })}
              </p>
              {app.manifest.capabilities.llm && (
                <p className="mt-0.5 text-caption text-muted-foreground">
                  {budget
                    ? t('detail.monthBudget', { tokens: monthTokens, budget })
                    : t('detail.monthNoBudget', { tokens: monthTokens })}
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
                {t('detail.budget')}
              </Button>
            )}
          </li>
          <li className="list-row py-3">
            <div className="min-w-0 flex-1">
              <p className="text-body">{t('detail.storage')}</p>
              <p className="text-caption text-muted-foreground">{formatBytes(bytes)}</p>
            </div>
            {bytes > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)}>
                {t('detail.clear')}
              </Button>
            )}
          </li>
        </ul>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="px-4 pt-3">
          <p className="text-body font-medium">{t('detail.capsTitle')}</p>
          <p className="mt-0.5 text-caption text-muted-foreground">
            {t('detail.capsHint')}
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
                    {t('detail.revoke')}
                  </button>
                ) : (
                  <span className="text-caption text-muted-foreground">{t('detail.notGranted')}</span>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <section className="rounded-lg border border-border bg-surface p-3">
        <div className="flex items-center gap-2">
          <Code2 className="size-4 text-muted-foreground" aria-hidden />
          <p className="text-body font-medium">{t('detail.devPanel')}</p>
        </div>
        <p className="mt-1 text-caption text-muted-foreground">
          {t('detail.devPanelHint')}
        </p>
        <Button
          className="mt-2"
          block
          onClick={() => navigate(`/studio?app=${app.id}`)}
        >
          <MessageSquarePlus className="size-4" aria-hidden />
          {t('detail.continueDev')}
        </Button>
        <button
          type="button"
          onClick={() => setShowSource((value) => !value)}
          className="mt-3 flex min-h-tap w-full items-center justify-between border-t border-border pt-2 text-left"
        >
          <span className="flex items-center gap-2 text-body">
            <FileCode2 className="size-4 text-muted-foreground" aria-hidden />
            {t('detail.viewSource')}
          </span>
          <span className="text-caption text-muted-foreground">{showSource ? t('detail.collapse') : t('detail.expand')}</span>
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
            {t('detail.debugLogs')}
          </span>
          <span className="text-caption text-muted-foreground">{t('detail.logCount', { count: logs.length })}</span>
        </button>
      </section>

      <section className="rounded-lg border border-border bg-surface p-3">
        <p className="text-body font-medium">{t('detail.shareTitle')}</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => void exportPackage()}>
            <Download className="size-4" aria-hidden />
            {t('detail.exportPackage')}
          </Button>
          <Button variant="outline" onClick={() => void copySource()}>
            <Clipboard className="size-4" aria-hidden />
            {t('detail.copySource')}
          </Button>
        </div>
        <p className="mt-2 text-caption text-muted-foreground">
          {t('detail.exportNote')}
        </p>
      </section>

      {app.revisions.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="flex items-center gap-2 px-4 pt-3">
            <History className="size-4 text-muted-foreground" aria-hidden />
            <p className="text-body font-medium">{t('detail.revisionsTitle')}</p>
          </div>
          <ul className="mt-1">
            {app.revisions.map((revision, index) => (
              <li key={`${revision.at}-${index}`} className="list-row items-start py-3">
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-body">{revision.request}</p>
                  <p className="mt-0.5 text-caption text-muted-foreground">
                    {formatDateTime(revision.at)} · {revision.summary}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy}
                    onClick={() => void rollback(index)}
                  >
                    {t('studio.backToVersion')}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger-ghost"
                    disabled={busy}
                    onClick={() => setDeleteTarget(index)}
                  >
                    {t('studio.deleteVersion')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Button variant="danger-ghost" block onClick={() => setConfirmDelete(true)}>
        <Trash2 className="size-4" aria-hidden />
        {t('detail.deleteApp')}
      </Button>
      <p className="pb-2 text-center text-caption text-muted-foreground">
        {t('detail.deleteAppNote')}
      </p>

      <Dialog
        open={showBudget}
        onClose={() => setShowBudget(false)}
        title={t('detail.budgetTitle')}
        description={t('detail.budgetDesc')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowBudget(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => {
                void (async () => {
                  const value = Number(budgetInput)
                  await setBudget(app.id, Number.isFinite(value) && value > 0 ? value : null)
                  setShowBudget(false)
                  await load()
                  toast({ title: t('detail.budgetSaved'), tone: 'success' })
                })()
              }}
            >
              保存
            </Button>
          </>
        }
      >
        <label htmlFor="budget-input" className="text-caption font-medium">
          {t('detail.budgetLabel')}
        </label>
        <input
          id="budget-input"
          type="number"
          inputMode="numeric"
          min={0}
          value={budgetInput}
          onChange={(event) => setBudgetInput(event.target.value)}
          placeholder={t('detail.budgetPlaceholder')}
          className="mt-1 w-full rounded-md border border-input bg-surface px-3 py-2.5 text-body outline-none focus:border-primary"
        />
        <p className="mt-2 text-caption text-muted-foreground">
          {t('detail.budgetUsed', { tokens: monthTokens })}
        </p>
      </Dialog>

      <Dialog
        open={showLogs}
        onClose={() => setShowLogs(false)}
        title={t('detail.logsTitle')}
        description={t('detail.logsDesc')}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                void clearLogs(app.id).then(() => {
                  setLogs([])
                  setShowLogs(false)
                  toast({ title: t('detail.logsCleared'), tone: 'info' })
                })
              }}
            >
              {t('detail.clearLogs')}
            </Button>
            <Button variant="outline" onClick={() => setShowLogs(false)}>
              {t('common.close')}
            </Button>
          </>
        }
      >
        {logs.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t('detail.noLogs')}</p>
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
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={t('detail.clearDataTitle')}
        description={t('detail.clearDataDesc')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={() => void clearData()} disabled={busy}>
              {busy ? t('detail.clearing') : t('detail.clearDataBtn')}
            </Button>
          </>
        }
      >
        <p className="text-caption text-muted-foreground">{t('detail.clearDataNote')}</p>
      </Dialog>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t('detail.deleteAppTitle')}
        description={t('detail.deleteAppDesc')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void remove()}>
              {t('detail.deleteBtn')}
            </Button>
          </>
        }
      >
        <p className="text-body">{t('detail.deletingName', { name: app.name })}</p>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onClose={() => {
          if (!deletingRevision) setDeleteTarget(null)
        }}
        title={t('studio.deleteTitle')}
        description={t('studio.deleteDesc')}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={deletingRevision}
              onClick={() => setDeleteTarget(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={deletingRevision}
              onClick={() => void removeRevision()}
            >
              {t('studio.deleteConfirm')}
            </Button>
          </>
        }
      >
        {deleteTarget !== null && app.revisions[deleteTarget] && (
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
