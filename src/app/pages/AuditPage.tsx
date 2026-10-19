import { useEffect, useState } from 'react'
import { ScrollText } from 'lucide-react'

import { usePageTitle } from '@/app/layout/PageTitle'
import { useI18n } from '@/shared/i18n'
import { listAudit } from '@/shared/portal/db'
import type { AuditKind, AuditRecord } from '@/shared/portal/types'
import { formatDateTime } from '@/shared/portal/utils'
import { EmptyState, Spinner } from '@/shared/ui/Feedback'

const KIND_LABEL_KEY: Record<AuditKind, string> = {
  'app.install': 'audit.kind.app.install',
  'app.update': 'audit.kind.app.update',
  'app.delete': 'audit.kind.app.delete',
  'app.export': 'audit.kind.app.export',
  'app.import': 'audit.kind.app.import',
  'capability.grant': 'audit.kind.capability.grant',
  'capability.revoke': 'audit.kind.capability.revoke',
  'network.block': 'audit.kind.network.block',
  'storage.clear': 'audit.kind.storage.clear',
  'backup.export': 'audit.kind.backup.export',
  'backup.restore': 'audit.kind.backup.restore',
}

const TONE: Partial<Record<AuditKind, string>> = {
  'network.block': 'text-warning',
  'app.delete': 'text-danger',
  'capability.revoke': 'text-danger',
}

export function AuditPage() {
  const { t } = useI18n()
  usePageTitle(t('audit.title'))
  const [records, setRecords] = useState<AuditRecord[] | null>(null)

  useEffect(() => {
    void (async () => {
      setRecords(await listAudit())
    })()
  }, [])

  if (records === null) {
    return (
      <div className="flex min-h-[50dvh] items-center justify-center">
        <Spinner label={t('audit.loading')} />
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className="page">
        <EmptyState
          icon={ScrollText}
          title={t('audit.empty')}
          description={t('audit.emptyDesc')}
        />
      </div>
    )
  }

  return (
    <div className="page space-y-2">
      <p className="px-1 text-caption text-muted-foreground">
        {t('audit.hint')}
      </p>
      <ul className="overflow-hidden rounded-lg border border-border bg-surface">
        {records.map((record) => (
          <li key={record.id} className="list-row items-start py-3">
            <span
              className={`mt-0.5 shrink-0 text-caption font-medium ${TONE[record.kind] ?? 'text-primary'}`}
            >
              {t(KIND_LABEL_KEY[record.kind])}
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
