import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Database, Eraser } from 'lucide-react'

import { usePageTitle } from '@/app/layout/PageTitle'
import {
  idbDelete,
  kvBytes,
  listApps,
  listUsage,
  STORE,
} from '@/shared/portal/db'
import type { PortalApp, UsageRecord } from '@/shared/portal/types'
import { formatBytes, formatDateTime } from '@/shared/portal/utils'
import { EmptyState, Spinner } from '@/shared/ui/Feedback'
import { useToast } from '@/shared/ui/Toast'

const KIND_LABEL: Record<UsageRecord['kind'], string> = {
  generate: '生成',
  repair: '修复',
  summarize: '整理需求',
  'app-call': '应用调用',
}

export function UsagePage() {
  usePageTitle('用量与存储')
  const navigate = useNavigate()
  const { toast } = useToast()
  const [usage, setUsage] = useState<UsageRecord[] | null>(null)
  const [apps, setApps] = useState<Array<{ app: PortalApp; bytes: number }>>([])

  const load = useCallback(async () => {
    try {
      const [records, allApps] = await Promise.all([listUsage(), listApps()])
      const list = allApps.filter((app) => app.status === 'installed' || Boolean(app.html))
      setUsage(records)
      const sizes = await Promise.all(
        list.map(async (app) => ({ app, bytes: await kvBytes(app.id) })),
      )
      setApps(sizes)
    } catch (error) {
      setUsage([])
      toast({
        title: '读取用量失败',
        description: (error as Error).message,
        tone: 'danger',
      })
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const clearUsage = async () => {
    if (!usage) return
    try {
      for (const record of usage) {
        await idbDelete(STORE.usage, record.id)
      }
      setUsage([])
      toast({ title: '统计已清空', description: '不影响应用与数据', tone: 'info' })
    } catch (error) {
      toast({ title: '清空失败', description: (error as Error).message, tone: 'danger' })
    }
  }

  if (usage === null) {
    return (
      <div className="flex min-h-[50dvh] items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const totalIn = usage.reduce((sum, item) => sum + item.inputTokens, 0)
  const totalOut = usage.reduce((sum, item) => sum + item.outputTokens, 0)
  const generatorUsage = usage.filter((item) => item.kind !== 'app-call')
  const appUsage = usage.filter((item) => item.kind === 'app-call')

  const byApp = new Map<string, { name: string; tokens: number; calls: number }>()
  for (const item of usage) {
    const entry = byApp.get(item.appId) ?? { name: item.appName, tokens: 0, calls: 0 }
    entry.tokens += item.inputTokens + item.outputTokens
    entry.calls += 1
    byApp.set(item.appId, entry)
  }
  const ranking = Array.from(byApp.entries()).sort((a, b) => b[1].tokens - a[1].tokens)
  const maxTokens = ranking[0]?.[1].tokens ?? 1

  return (
    <div className="page space-y-3">
      <section className="rounded-lg border border-border bg-surface p-4">
        <p className="text-caption text-muted-foreground">累计 token</p>
        <p className="mt-0.5 text-display font-semibold tabular-nums">{totalIn + totalOut}</p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Metric label="生成 / 修复" value={generatorUsage.reduce((s, i) => s + i.inputTokens + i.outputTokens, 0)} />
          <Metric label="应用调用" value={appUsage.reduce((s, i) => s + i.inputTokens + i.outputTokens, 0)} />
          <Metric label="调用次数" value={usage.length} />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-3">
        <p className="text-body font-medium">按工具排行</p>
        {ranking.length === 0 ? (
          <p className="mt-2 text-caption text-muted-foreground">还没有调用记录。</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {ranking.map(([appId, entry]) => (
              <li key={appId}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-body">{entry.name}</span>
                  <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                    {entry.tokens} · {entry.calls} 次
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(3, Math.round((entry.tokens / maxTokens) * 100))}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center gap-2 px-4 pt-3">
          <Database className="size-4 text-muted-foreground" aria-hidden />
          <p className="text-body font-medium">各工具的本机数据</p>
        </div>
        {apps.length === 0 ? (
          <EmptyState title="还没有工具" description="生成或导入一个工具后，这里会显示它占用的空间。" className="py-6" />
        ) : (
          <ul className="mt-1">
            {apps.map(({ app, bytes }) => (
              <li key={app.id} className="list-row py-3">
                <button
                  type="button"
                  onClick={() => navigate(`/app/${app.id}/detail`)}
                  className="flex min-h-tap w-full items-center gap-3 text-left"
                >
                  <span className="text-display" aria-hidden>
                    {app.emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body">{app.name}</span>
                    <span className="text-caption text-muted-foreground">
                      {bytes > 0 ? formatBytes(bytes) : '暂无数据'}
                    </span>
                  </span>
                  <span className="text-caption text-muted-foreground">管理</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-3">
        <div className="flex items-center justify-between">
          <p className="text-body font-medium">最近调用</p>
          {usage.length > 0 && (
            <button
              type="button"
              onClick={() => void clearUsage()}
              className="flex min-h-tap items-center gap-1 text-caption text-muted-foreground"
            >
              <Eraser className="size-3.5" aria-hidden />
              清空统计
            </button>
          )}
        </div>
        {usage.length === 0 ? (
          <p className="mt-2 text-caption text-muted-foreground">还没有调用记录。</p>
        ) : (
          <ul className="mt-1 divide-y divide-border">
            {usage.slice(0, 20).map((item) => (
              <li key={item.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body">{item.appName}</span>
                  <span className="text-caption text-muted-foreground">
                    {KIND_LABEL[item.kind]} · {item.model} · {formatDateTime(item.at)}
                  </span>
                </span>
                <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                  {item.inputTokens + item.outputTokens}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="pb-2 text-center text-caption text-muted-foreground">
        记录只在本机；上游账单以模型服务商为准。
      </p>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted px-2 py-2">
      <p className="text-title font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-caption text-muted-foreground">{label}</p>
    </div>
  )
}
