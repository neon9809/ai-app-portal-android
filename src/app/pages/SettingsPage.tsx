import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BookOpen,
  ChevronRight,
  Cpu,
  Gauge,
  Info,
  ScrollText,
  ShieldCheck,
} from 'lucide-react'

import { usePageTitle } from '@/app/layout/PageTitle'
import { APP_VERSION } from '@/shared/config/app'
import { listApps, listAudit, listUsage, settingGet } from '@/shared/portal/db'
import { isLlmConfigured, readLlmSettings } from '@/shared/portal/llm'
import { formatRelativeTime } from '@/shared/portal/utils'

export function SettingsPage() {
  usePageTitle('设置')
  const navigate = useNavigate()
  const [model, setModel] = useState('未配置')
  const [tokens, setTokens] = useState(0)
  const [appCount, setAppCount] = useState(0)
  const [auditCount, setAuditCount] = useState(0)
  const [lastBackup, setLastBackup] = useState<number | null>(null)

  useEffect(() => {
    void (async () => {
      const settings = await readLlmSettings()
      setModel(isLlmConfigured(settings) ? settings.model : '未配置')
      const [usage, apps, audit, backup] = await Promise.all([
        listUsage(),
        listApps(),
        listAudit(),
        settingGet<number>('lastBackupAt'),
      ])
      setTokens(usage.reduce((sum, item) => sum + item.inputTokens + item.outputTokens, 0))
      setAppCount(apps.filter((app) => app.status === 'installed' || Boolean(app.html)).length)
      setAuditCount(audit.length)
      setLastBackup(typeof backup === 'number' ? backup : null)
    })()
  }, [])

  return (
    <div className="page">
      <header className="pb-4">
        <p className="text-body text-muted-foreground">
          模型、用量、备份与本地数据都在这里。
        </p>
      </header>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <ul>
          <SettingRow
            icon={Cpu}
            title="AI 模型"
            value={model}
            onClick={() => navigate('/settings/model')}
          />
          <SettingRow
            icon={Gauge}
            title="用量与存储"
            value={`${tokens} tokens · ${appCount} 个工具`}
            onClick={() => navigate('/settings/usage')}
          />
          <SettingRow
            icon={ShieldCheck}
            title="备份与恢复"
            value={lastBackup ? `上次 ${formatRelativeTime(lastBackup)}` : '还没有备份'}
            onClick={() => navigate('/settings/backup')}
          />
          <SettingRow
            icon={ScrollText}
            title="审计日志"
            value={`${auditCount} 条`}
            onClick={() => navigate('/settings/audit')}
          />
          <SettingRow
            icon={Info}
            title="关于"
            value={`版本 ${APP_VERSION} · 来源与许可`}
            onClick={() => navigate('/settings/about')}
          />
        </ul>
      </div>

      <section className="mt-4 rounded-lg border border-border bg-surface p-3">
        <div className="flex items-center gap-2">
          <BookOpen className="size-4 text-muted-foreground" aria-hidden />
          <p className="text-body font-medium">怎么用</p>
        </div>
        <ol className="mt-2 space-y-1.5 text-caption text-muted-foreground">
          <li>1. 在首页点右上角 +，用一句话说你想做的工具，可以附图片或文本。</li>
          <li>2. 等它写完并自检通过，工具会出现在「我的应用」。</li>
          <li>3. 打开就能用；想改就回到工具里接着说想改什么。</li>
          <li>4. 第一次用到本机能力时会问你，之后可在应用详情里撤回。</li>
        </ol>
        <p className="mt-2 text-caption text-muted-foreground">
          能力范围与限制写在「关于」里。
        </p>
      </section>
    </div>
  )
}

function SettingRow({
  icon: Icon,
  title,
  value,
  onClick,
}: {
  icon: typeof Cpu
  title: string
  value: string
  onClick: () => void
}) {
  return (
    <li className="list-row">
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-[60px] w-full items-center gap-3 py-3 text-left active:bg-accent"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-soft">
          <Icon className="size-4 text-primary" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-body">{title}</span>
          <span className="mt-0.5 block truncate text-caption text-muted-foreground">{value}</span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </li>
  )
}
