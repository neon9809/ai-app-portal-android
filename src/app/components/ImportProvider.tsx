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
  const [installing, setInstalling] = useState(false)

  const openImport = useCallback(async () => {
    try {
      const picked = await pickFile('.neon-aap,application/zip,application/octet-stream')
      if (!picked) return
      setPending(parsePackageBytes(picked.bytes))
    } catch (error) {
      toast({ title: '导入失败', description: (error as Error).message, tone: 'danger' })
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
          title: '这个应用包没有通过安全检查',
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
        detail: `导入 .neon-aap（${pending.bytes} 字节）`,
        at: now(),
      })
      await takeSnapshot('导入应用')
      setPending(null)
      toast({ title: `已安装「${app.name}」`, tone: 'success' })
      navigate(`/app/${app.id}`)
    } catch (error) {
      toast({ title: '安装失败', description: (error as Error).message, tone: 'danger' })
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
        title={pending ? `导入「${pending.manifest.name}」` : '导入应用'}
        description="请先确认这个工具的能力范围"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              取消
            </Button>
            <Button loading={installing} onClick={() => void confirmImport()}>
              确认安装
            </Button>
          </>
        }
      >
        {pending && (
          <div className="space-y-3 text-body">
            <div>
              <p className="text-caption font-medium text-muted-foreground">它需要的能力</p>
              <p className="mt-1">
                {pending.manifest.capabilities.storage ? '保存数据到本机' : '不保存数据'}
                {pending.manifest.capabilities.llm ? ' · 调用 AI' : ''}
                {pending.manifest.capabilities.network.length > 0
                  ? ` · 联网（${pending.manifest.capabilities.network.join('、')}）`
                  : ' · 不联网'}
                {pending.manifest.capabilities.device?.length
                  ? ` · 手机能力 ${pending.manifest.capabilities.device.length} 组`
                  : ''}
              </p>
            </div>
            <div>
              <p className="text-caption font-medium text-muted-foreground">它能做什么</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-body">
                {pending.manifest.permission_card.can.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-caption font-medium text-muted-foreground">它不能做什么</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-body">
                {pending.manifest.permission_card.cannot.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <p className="text-caption text-muted-foreground">
              导入的应用会单独占一份数据，不影响已有工具。
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
