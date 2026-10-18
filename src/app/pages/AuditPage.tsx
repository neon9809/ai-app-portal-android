import { useEffect, useState } from 'react'
import { ScrollText } from 'lucide-react'

import { usePageTitle } from '@/app/layout/PageTitle'
import { listAudit } from '@/shared/portal/db'
import type { AuditKind, AuditRecord } from '@/shared/portal/types'
import { formatDateTime } from '@/shared/portal/utils'
import { EmptyState, Spinner } from '@/shared/ui/Feedback'

const KIND_LABEL: Record<AuditKind, string> = {
  'app.install': '安装',
  'app.update': '更新',
  'app.delete': '删除',
  'app.export': '导出',
  'app.import': '导入',
  'capability.grant': '授权',
  'capability.revoke': '撤回授权',
  'network.block': '拦截请求',
  'storage.clear': '清空数据',
  'backup.export': '备份',
  'backup.restore': '恢复',
}

const TONE: Partial<Record<AuditKind, string>> = {
  'network.block': 'text-warning',
  'app.delete': 'text-danger',
  'capability.revoke': 'text-danger',
}

export function AuditPage() {
  usePageTitle('审计日志')
  const [records, setRecords] = useState<AuditRecord[] | null>(null)

  useEffect(() => {
    void (async () => {
      setRecords(await listAudit())
    })()
  }, [])

  if (records === null) {
    return (
      <div className="flex min-h-[50dvh] items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className="page">
        <EmptyState
          icon={ScrollText}
          title="还没有记录"
          description="应用被安装、授权能力、拦截请求时，这里会留下记录。"
        />
      </div>
    )
  }

  return (
    <div className="page space-y-2">
      <p className="px-1 text-caption text-muted-foreground">
        只在本机保留最近 500 条。应用内部的调试日志可在应用详情里查看。
      </p>
      <ul className="overflow-hidden rounded-lg border border-border bg-surface">
        {records.map((record) => (
          <li key={record.id} className="list-row items-start py-3">
            <span
              className={`mt-0.5 shrink-0 text-caption font-medium ${TONE[record.kind] ?? 'text-primary'}`}
            >
              {KIND_LABEL[record.kind]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="break-words text-body">{record.detail}</p>
              <p className="mt-0.5 text-caption text-muted-foreground">
                {record.appName} · {formatDateTime(record.at)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
