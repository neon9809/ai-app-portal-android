import { useCallback, useEffect, useState } from 'react'
import { Download, RotateCcw, ShieldCheck, Upload } from 'lucide-react'

import { usePageTitle } from '@/app/layout/PageTitle'
import {
  decryptBackup,
  exportBackup,
  restoreBackup,
  restoreSnapshot,
  snapshotList,
  takeSnapshot,
  type BackupPayload,
} from '@/shared/portal/backup'
import type { Snapshot } from '@/shared/portal/types'
import { settingGet } from '@/shared/portal/db'
import { pickFile } from '@/shared/portal/file-picker'
import { downloadBlob, formatDateTime, formatRelativeTime } from '@/shared/portal/utils'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Dialog'
import { useToast } from '@/shared/ui/Toast'

export function BackupPage() {
  usePageTitle('备份与恢复')
  const { toast } = useToast()

  const [passphrase, setPassphrase] = useState('')
  const [confirmPassphrase, setConfirmPassphrase] = useState('')
  const [restorePassphrase, setRestorePassphrase] = useState('')
  const [pendingBytes, setPendingBytes] = useState<Uint8Array | null>(null)
  const [pendingRestore, setPendingRestore] = useState<BackupPayload | null>(null)
  const [pendingSnapshot, setPendingSnapshot] = useState<Snapshot | null>(null)
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [lastBackup, setLastBackup] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')

  const load = useCallback(async () => {
    const [stored, snapshotListValue] = await Promise.all([
      settingGet<number>('lastBackupAt'),
      snapshotList(),
    ])
    setSnapshots(snapshotListValue)
    setLastBackup(typeof stored === 'number' ? stored : null)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleExport = async () => {
    if (passphrase.trim().length < 6) {
      toast({ title: '口令太短', description: '至少 6 个字符', tone: 'warning' })
      return
    }
    if (passphrase !== confirmPassphrase) {
      toast({ title: '两次口令不一致', tone: 'warning' })
      return
    }
    setBusy(true)
    try {
      const { blob, filename } = await exportBackup(passphrase)
      downloadBlob(blob, filename)
      setPassphrase('')
      setConfirmPassphrase('')
      await load()
      toast({
        title: '备份已导出',
        description: '请把文件放到你能长期保存的地方，并记住口令',
        tone: 'success',
      })
    } catch (error) {
      toast({ title: '导出失败', description: (error as Error).message, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const handlePickFile = async () => {
    try {
      const picked = await pickFile('.zwbackup,.neon-backup,application/octet-stream')
      if (!picked) return
      setFileName(picked.name)
      setPendingBytes(picked.bytes)
    } catch (error) {
      toast({ title: '读取失败', description: (error as Error).message, tone: 'danger' })
    }
  }

  const decryptPending = async () => {
    if (!pendingBytes) {
      toast({ title: '先选择备份文件', tone: 'warning' })
      return
    }
    if (!restorePassphrase.trim()) {
      toast({ title: '输入口令', tone: 'warning' })
      return
    }
    setBusy(true)
    try {
      const payload = await decryptBackup(pendingBytes, restorePassphrase)
      setPendingRestore(payload)
      setRestorePassphrase('')
    } catch (error) {
      toast({ title: '打不开这个备份', description: (error as Error).message, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const confirmRestore = async () => {
    if (!pendingRestore) return
    setBusy(true)
    try {
      await restoreBackup(pendingRestore)
      setPendingRestore(null)
      setPendingBytes(null)
      await load()
      toast({ title: '恢复完成', description: '应用与数据已回到备份时的状态', tone: 'success' })
    } catch (error) {
      toast({ title: '恢复失败', description: (error as Error).message, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const restoreFromSnapshot = async () => {
    if (!pendingSnapshot) return
    setBusy(true)
    try {
      await restoreSnapshot(pendingSnapshot)
      setPendingSnapshot(null)
      await load()
      toast({ title: '已回到这个快照', tone: 'success' })
    } catch (error) {
      toast({ title: '恢复失败', description: (error as Error).message, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const createSnapshot = async () => {
    setBusy(true)
    try {
      await takeSnapshot('手动快照')
      await load()
      toast({ title: '快照已保存（只在本机）', tone: 'success' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page space-y-3">
      <section className="rounded-lg border border-border bg-surface p-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" aria-hidden />
          <p className="text-body font-medium">上一次备份</p>
        </div>
        <p className="mt-1 text-body">
          {lastBackup ? `${formatRelativeTime(lastBackup)}（${formatDateTime(lastBackup)}）` : '还没有做过备份'}
        </p>
        <p className="mt-1 text-caption text-muted-foreground">
          备份是一个加密文件，包含所有应用、应用数据、偏好与 API Key。
          忘记口令就等于备份作废，没有找回方式。
        </p>
      </section>

      <section className="rounded-lg border border-border bg-surface p-3">
        <p className="text-body font-medium">导出备份</p>
        <label htmlFor="backup-pass" className="mt-2 block text-caption font-medium">
          设置一个口令
        </label>
        <input
          id="backup-pass"
          type="password"
          autoCapitalize="off"
          autoCorrect="off"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          placeholder="至少 6 个字符"
          className="mt-1 w-full rounded-md border border-input bg-surface px-3 py-2.5 text-body outline-none focus:border-primary"
        />
        <label htmlFor="backup-pass2" className="mt-2 block text-caption font-medium">
          再输一次
        </label>
        <input
          id="backup-pass2"
          type="password"
          autoCapitalize="off"
          autoCorrect="off"
          value={confirmPassphrase}
          onChange={(event) => setConfirmPassphrase(event.target.value)}
          placeholder="确认口令"
          className="mt-1 w-full rounded-md border border-input bg-surface px-3 py-2.5 text-body outline-none focus:border-primary"
        />
        <Button className="mt-3" block loading={busy} onClick={() => void handleExport()}>
          <Download className="size-4" aria-hidden />
          导出加密备份
        </Button>
        <p className="mt-2 text-caption text-muted-foreground">
          加密使用 AES-GCM；密钥由口令经 PBKDF2（31 万轮）派生。
          浏览器环境没有 Argon2id，这是本机可实现的最接近方案。
        </p>
      </section>

      <section className="rounded-lg border border-border bg-surface p-3">
        <p className="text-body font-medium">从备份恢复</p>
        <p className="mt-0.5 text-caption text-muted-foreground">
          恢复会用备份内容覆盖本机现有工具与数据。
        </p>
        <Button variant="outline" className="mt-2" block onClick={() => void handlePickFile()}>
          <Upload className="size-4" aria-hidden />
          {fileName || '选择备份文件'}
        </Button>
        <label htmlFor="restore-pass" className="mt-2 block text-caption font-medium">
          备份口令
        </label>
        <input
          id="restore-pass"
          type="password"
          autoCapitalize="off"
          autoCorrect="off"
          value={restorePassphrase}
          onChange={(event) => setRestorePassphrase(event.target.value)}
          placeholder="输入导出时设置的口令"
          className="mt-1 w-full rounded-md border border-input bg-surface px-3 py-2.5 text-body outline-none focus:border-primary"
        />
        <Button className="mt-2" variant="outline" block loading={busy} onClick={() => void decryptPending()}>
          解锁备份
        </Button>
      </section>

      <section className="rounded-lg border border-border bg-surface p-3">
        <div className="flex items-center justify-between">
          <p className="text-body font-medium">本机快照</p>
          <Button size="sm" variant="ghost" loading={busy} onClick={() => void createSnapshot()}>
            立即保存
          </Button>
        </div>
        <p className="mt-0.5 text-caption text-muted-foreground">
          最近 3 份自动快照，不加密，只保存在这台设备上。
        </p>
        {snapshots.length === 0 ? (
          <p className="mt-2 text-caption text-muted-foreground">还没有快照。</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {snapshots.map((snapshot) => (
              <li key={snapshot.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-body">{snapshot.reason}</span>
                  <span className="text-caption text-muted-foreground">
                    {formatDateTime(snapshot.at)} · {snapshot.apps} 个工具
                  </span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => setPendingSnapshot(snapshot)}>
                  <RotateCcw className="size-3.5" aria-hidden />
                  恢复
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog
        open={pendingRestore !== null}
        onClose={() => setPendingRestore(null)}
        title="覆盖本机数据？"
        description="恢复完成后，当前的应用与数据会被备份里的内容替换。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingRestore(null)}>
              取消
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void confirmRestore()}>
              覆盖并恢复
            </Button>
          </>
        }
      >
        {pendingRestore && (
          <div className="space-y-1 text-body">
            <p>备份时间：{formatDateTime(pendingRestore.exportedAt)}</p>
            <p>包含 {pendingRestore.apps.length} 个工具</p>
            <p>数据记录 {pendingRestore.kv.length} 条</p>
          </div>
        )}
      </Dialog>

      <Dialog
        open={pendingSnapshot !== null}
        onClose={() => setPendingSnapshot(null)}
        title="恢复这个快照？"
        description="当前的工具与数据会被快照里的内容替换。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingSnapshot(null)}>
              取消
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void restoreFromSnapshot()}>
              恢复
            </Button>
          </>
        }
      >
        {pendingSnapshot && (
          <p className="text-body">
            {pendingSnapshot.reason} · {formatDateTime(pendingSnapshot.at)}
          </p>
        )}
      </Dialog>
    </div>
  )
}
