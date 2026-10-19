import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { addAudit, saveApp } from '@/shared/portal/db'
import { takeSnapshot } from '@/shared/portal/backup'
import { pickFile } from '@/shared/portal/file-picker'
import { inspectHtml } from '@/shared/portal/generator'
import { installImport, parsePackageBytes, type PendingImport } from '@/shared/portal/package'
import { now, uid } from '@/shared/portal/utils'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Dialog'
import { useToast } from '@/shared/ui/Toast'
import { useI18n } from '@/shared/i18n'

interface ImportContextValue {
  openImport: () => void
}

const ImportContext = createContext<ImportContextValue>({ openImport: () => undefined })

/**
 * 导入 .neon-aap 的全局入口：货架和侧边菜单都能调用。
 * 选中文件后先展示权限卡，用户确认才安装。
 */
export function ImportProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [pending, setPending] = useState<PendingImport | null>(null)
  const { t } = useI18n()
  const [installing, setInstalling] = useState(false)

  const openImport = useCallback(async () => {
    try {
      const picked = await pickFile('.neon-aap,application/zip,application/octet-stream')
      if (!picked) return
      setPending(parsePackageBytes(picked.bytes))
    } catch (error) {
      toast({ title: t('import.fail'), description: (error as Error).message, tone: 'danger' })
    }
  }, [toast])

  const confirmImport = async () => {
    if (!pending) return
    setInstalling(true)
    try {
      const app = installImport(pending)
      const issues = inspectHtml(app.html, app.manifest.capabilities)
      const blocking = issues.filter((issue) => issue.level === 'error')
      if (blocking.length > 0) {
        toast({
          title: t('import.unsafe'),
          description: blocking[0].message,
          tone: 'danger',
        })
        return
      }
      await saveApp(app)
      await addAudit({
        id: uid('au_'),
        appId: app.id,
        appName: app.name,
        kind: 'app.import',
        detail: t('import.auditDetail', { bytes: pending.bytes }),
        at: now(),
      })
      await takeSnapshot(t('import.snapshot'))
      setPending(null)
      toast({ title: t('import.installed', { name: app.name }), tone: 'success' })
      navigate(`/app/${app.id}`)
    } catch (error) {
      toast({ title: t('import.installFail'), description: (error as Error).message, tone: 'danger' })
    } finally {
      setInstalling(false)
    }
  }

  return (
    <ImportContext.Provider value={{ openImport: () => void openImport() }}>
      {children}
      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending ? t('import.titleOf', { name: pending.manifest.name }) : t('import.title')}
        description={t('import.desc')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              {t('common.cancel')}
            </Button>
            <Button loading={installing} onClick={() => void confirmImport()}>
              {t('import.confirm')}
            </Button>
          </>
        }
      >
        {pending && (
          <div className="space-y-3 text-body">
            <div>
              <p className="text-caption font-medium text-muted-foreground">{t('import.capsNeeded')}</p>
              <p className="mt-1">
                {pending.manifest.capabilities.storage ? t('import.capStorage') : t('import.noStorage')}
                {pending.manifest.capabilities.llm ? t('import.capLlm') : ''}
                {pending.manifest.capabilities.network.length > 0
                  ? t('import.capNetwork', { hosts: pending.manifest.capabilities.network.join(', ') })
                  : t('import.noNetwork')}
                {pending.manifest.capabilities.device?.length
                  ? t('import.capDevice', { count: pending.manifest.capabilities.device.length })
                  : ''}
              </p>
            </div>
            <div>
              <p className="text-caption font-medium text-muted-foreground">{t('import.can')}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-body">
                {pending.manifest.permission_card.can.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-caption font-medium text-muted-foreground">{t('import.cannot')}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-body">
                {pending.manifest.permission_card.cannot.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <p className="text-caption text-muted-foreground">
              {t('import.note')}
            </p>
          </div>
        )}
      </Dialog>
    </ImportContext.Provider>
  )
}

export function useImport(): ImportContextValue {
  return useContext(ImportContext)
}
