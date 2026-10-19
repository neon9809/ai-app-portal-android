import { useCallback, useEffect, useState } from 'react'
import { Download, RotateCcw, ShieldCheck, Upload } from 'lucide-react'

import { usePageTitle } from '@/app/layout/PageTitle'
import { useI18n } from '@/shared/i18n'
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
  const { t, locale } = useI18n()
  usePageTitle(t('backup.title'))
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
      toast({ title: t('backup.shortPass'), description: t('backup.shortPassDesc'), tone: 'warning' })
      return
    }
    if (passphrase !== confirmPassphrase) {
      toast({ title: t('backup.mismatch'), tone: 'warning' })
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
        title: t('backup.exported'),
        description: t('backup.exportedDesc'),
        tone: 'success',
      })
    } catch (error) {
      toast({ title: t('backup.exportFail'), description: (error as Error).message, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const handlePickFile = async () => {
    try {
      const picked = await pickFile('.aapbackup,.zwbackup,.neon-backup,application/octet-stream')
      if (!picked) return
      setFileName(picked.name)
      setPendingBytes(picked.bytes)
    } catch (error) {
      toast({ title: t('backup.readFail'), description: (error as Error).message, tone: 'danger' })
    }
  }

  const decryptPending = async () => {
    if (!pendingBytes) {
      toast({ title: t('backup.pickFirst'), tone: 'warning' })
      return
    }
    if (!restorePassphrase.trim()) {
      toast({ title: t('backup.enterPass'), tone: 'warning' })
      return
    }
    setBusy(true)
    try {
      const payload = await decryptBackup(pendingBytes, restorePassphrase)
      setPendingRestore(payload)
      setRestorePassphrase('')
    } catch (error) {
      toast({ title: t('backup.cantOpen'), description: (error as Error).message, tone: 'danger' })
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
      toast({ title: t('backup.restored'), description: t('backup.restoredDesc'), tone: 'success' })
    } catch (error) {
      toast({ title: t('backup.restoreFail'), description: (error as Error).message, tone: 'danger' })
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
      toast({ title: t('backup.snapshotRestored'), tone: 'success' })
    } catch (error) {
      toast({ title: t('backup.restoreFail'), description: (error as Error).message, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const createSnapshot = async () => {
    setBusy(true)
    try {
      await takeSnapshot(t('backup.snapshotManual'))
      await load()
      toast({ title: t('backup.snapshotSaved'), tone: 'success' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page space-y-3">
      <section className="rounded-lg border border-border bg-surface p-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" aria-hidden />
          <p className="text-body font-medium">{t('backup.lastBackupTitle')}</p>
        </div>
        <p className="mt-1 text-body">
          {lastBackup ? `${formatRelativeTime(lastBackup, locale)}（${formatDateTime(lastBackup)}）` : t('backup.noBackupYet')}
        </p>
        <p className="mt-1 text-caption text-muted-foreground">
          {t('backup.whatTitle')}
          {t('backup.whatWarn')}
        </p>
      </section>

      <section className="rounded-lg border border-border bg-surface p-3">
        <p className="text-body font-medium">{t('backup.exportTitle')}</p>
        <label htmlFor="backup-pass" className="mt-2 block text-caption font-medium">
          {t('backup.setPass')}
        </label>
        <input
          id="backup-pass"
          type="password"
          autoCapitalize="off"
          autoCorrect="off"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          placeholder={t('backup.passPlaceholder')}
          className="mt-1 w-full rounded-md border border-input bg-surface px-3 py-2.5 text-body outline-none focus:border-primary"
        />
        <label htmlFor="backup-pass2" className="mt-2 block text-caption font-medium">
          {t('backup.passAgain')}
        </label>
        <input
          id="backup-pass2"
          type="password"
          autoCapitalize="off"
          autoCorrect="off"
          value={confirmPassphrase}
          onChange={(event) => setConfirmPassphrase(event.target.value)}
          placeholder={t('backup.passConfirm')}
          className="mt-1 w-full rounded-md border border-input bg-surface px-3 py-2.5 text-body outline-none focus:border-primary"
        />
        <Button className="mt-3" block loading={busy} onClick={() => void handleExport()}>
          <Download className="size-4" aria-hidden />
          {t('backup.exportBtn')}
        </Button>
        <p className="mt-2 text-caption text-muted-foreground">
          {t('backup.cryptoNote')}
        </p>
      </section>

      <section className="rounded-lg border border-border bg-surface p-3">
        <p className="text-body font-medium">{t('backup.restoreTitle')}</p>
        <p className="mt-0.5 text-caption text-muted-foreground">
          {t('backup.restoreWarn')}
        </p>
        <Button variant="outline" className="mt-2" block onClick={() => void handlePickFile()}>
          <Upload className="size-4" aria-hidden />
          {fileName || t('backup.pickFile')}
        </Button>
        <label htmlFor="restore-pass" className="mt-2 block text-caption font-medium">
          {t('backup.passLabel')}
        </label>
        <input
          id="restore-pass"
          type="password"
          autoCapitalize="off"
          autoCorrect="off"
          value={restorePassphrase}
          onChange={(event) => setRestorePassphrase(event.target.value)}
          placeholder={t('backup.passEnter')}
          className="mt-1 w-full rounded-md border border-input bg-surface px-3 py-2.5 text-body outline-none focus:border-primary"
        />
        <Button className="mt-2" variant="outline" block loading={busy} onClick={() => void decryptPending()}>
          {t('backup.unlock')}
        </Button>
      </section>

      <section className="rounded-lg border border-border bg-surface p-3">
        <div className="flex items-center justify-between">
          <p className="text-body font-medium">{t('backup.snapshotsTitle')}</p>
          <Button size="sm" variant="ghost" loading={busy} onClick={() => void createSnapshot()}>
            {t('backup.saveNow')}
          </Button>
        </div>
        <p className="mt-0.5 text-caption text-muted-foreground">
          {t('backup.snapshotsNote')}
        </p>
        {snapshots.length === 0 ? (
          <p className="mt-2 text-caption text-muted-foreground">{t('backup.noSnapshots')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {snapshots.map((snapshot) => (
              <li key={snapshot.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-body">{snapshot.reason}</span>
                  <span className="text-caption text-muted-foreground">
                    {t('backup.snapshotMeta', { time: formatDateTime(snapshot.at), count: snapshot.apps })}
                  </span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => setPendingSnapshot(snapshot)}>
                  <RotateCcw className="size-3.5" aria-hidden />
                  {t('backup.restore')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog
        open={pendingRestore !== null}
        onClose={() => setPendingRestore(null)}
        title={t('backup.overwriteTitle')}
        description={t('backup.overwriteDesc')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingRestore(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void confirmRestore()}>
              {t('backup.overwriteBtn')}
            </Button>
          </>
        }
      >
        {pendingRestore && (
          <div className="space-y-1 text-body">
            <p>{t('backup.backupTime', { time: formatDateTime(pendingRestore.exportedAt) })}</p>
            <p>{t('backup.containsApps', { count: pendingRestore.apps.length })}</p>
            <p>{t('backup.kvCount', { count: pendingRestore.kv.length })}</p>
          </div>
        )}
      </Dialog>

      <Dialog
        open={pendingSnapshot !== null}
        onClose={() => setPendingSnapshot(null)}
        title={t('backup.snapshotTitle')}
        description={t('backup.snapshotDesc')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingSnapshot(null)}>
              {t('common.cancel')}
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
