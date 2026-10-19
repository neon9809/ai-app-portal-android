import { useEffect, useState } from 'react'
import { Plug, Plus, RefreshCw, Trash2, X } from 'lucide-react'

import { usePageTitle } from '@/app/layout/PageTitle'
import { useI18n } from '@/shared/i18n'
import {
  BUILTIN_TOOLS,
  EMPTY_MCP_CONFIG,
  cachedServerState,
  connectServer,
  forgetServerState,
  readMcpConfig,
  readMcpServers,
  writeMcpConfig,
  writeMcpServers,
  type McpConfig,
  type McpServerConfig,
} from '@/shared/portal/mcp'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Dialog'
import { Input, Switch } from '@/shared/ui/Input'
import { useToast } from '@/shared/ui/Toast'

interface ServerDraft {
  id: string
  name: string
  url: string
  headers: Array<{ key: string; value: string }>
  enabled: boolean
}

const EMPTY_DRAFT: ServerDraft = { id: '', name: '', url: '', headers: [], enabled: true }

/**
 * MCP 集中配置：
 *  - 外部 MCP 服务器（Streamable HTTP）：手动填地址与请求头，保存即连接并发现工具；
 *  - 内置工具简表：逐个启停。
 * 生成器每次运行时聚合启用的内置工具 + 已连接外部服务器的工具下发给模型。
 */
export function McpSettingsPage() {
  const { t } = useI18n()
  usePageTitle(t('mcp.title'))
  const { toast } = useToast()
  const [config, setConfig] = useState<McpConfig>(EMPTY_MCP_CONFIG)
  const [servers, setServers] = useState<McpServerConfig[]>([])
  const [editing, setEditing] = useState<ServerDraft | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      setConfig(await readMcpConfig())
      setServers(await readMcpServers())
    })()
  }, [])

  const toggleBuiltin = (name: string, enabled: boolean) => {
    setConfig((current) => {
      const next: McpConfig = {
        disabled: enabled
          ? current.disabled.filter((item) => item !== name)
          : current.disabled.includes(name)
            ? current.disabled
            : [...current.disabled, name],
      }
      void writeMcpConfig(next)
      return next
    })
  }

  const saveServer = async () => {
    if (!editing) return
    if (!editing.name.trim() || !editing.url.trim()) {
      toast({ title: t('mcp.connectFail'), description: t('mcp.nameUrlRequired'), tone: 'warning' })
      return
    }
    setConnecting(true)
    const server: McpServerConfig = {
      id: editing.id || `mcps_${Date.now().toString(36)}`,
      name: editing.name.trim(),
      url: editing.url.trim(),
      headers: editing.headers.filter((item) => item.key.trim()),
      enabled: editing.enabled,
    }
    try {
      forgetServerState(server.id)
      const state = await connectServer(server)
      const next = editing.id
        ? servers.map((item) => (item.id === server.id ? server : item))
        : [...servers, server]
      setServers(next)
      await writeMcpServers(next)
      setEditing(null)
      toast({
        title: t('mcp.connectedTools', {
          count: state.tools.length,
          names: state.tools.map((tool) => tool.name).join('、').slice(0, 80),
        }),
        tone: 'success',
      })
    } catch (error) {
      toast({ title: t('mcp.connectFail'), description: (error as Error).message, tone: 'danger' })
    } finally {
      setConnecting(false)
    }
  }

  const reconnect = async (server: McpServerConfig) => {
    setBusyId(server.id)
    try {
      forgetServerState(server.id)
      const state = await connectServer(server)
      toast({
        title: t('mcp.connectedTools', {
          count: state.tools.length,
          names: state.tools.map((tool) => tool.name).join('、').slice(0, 80),
        }),
        tone: 'success',
      })
    } catch (error) {
      toast({ title: t('mcp.connectFail'), description: (error as Error).message, tone: 'danger' })
    } finally {
      setBusyId(null)
    }
  }

  const removeServer = async (server: McpServerConfig) => {
    const next = servers.filter((item) => item.id !== server.id)
    setServers(next)
    await writeMcpServers(next)
    forgetServerState(server.id)
  }

  const toggleServer = async (server: McpServerConfig, enabled: boolean) => {
    const next = servers.map((item) => (item.id === server.id ? { ...item, enabled } : item))
    setServers(next)
    await writeMcpServers(next)
  }

  return (
    <div className="page">
      <section>
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2">
            <Plug className="size-4 text-primary" aria-hidden />
            <p className="text-body font-medium">{t('mcp.serversTitle')}</p>
          </div>
          <Button size="sm" onClick={() => setEditing({ ...EMPTY_DRAFT })}>
            <Plus className="size-3.5" aria-hidden />
            {t('mcp.addServer')}
          </Button>
        </div>
        <p className="mt-1 px-1 text-caption text-muted-foreground">{t('mcp.serversHint')}</p>

        {servers.length === 0 ? (
          <p className="mt-3 px-1 text-caption text-muted-foreground">{t('mcp.noServers')}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {servers.map((server) => {
              const cached = cachedServerState(server.id)
              return (
                <li key={server.id} className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        className="block w-full text-left"
                        onClick={() =>
                          setEditing({
                            id: server.id,
                            name: server.name,
                            url: server.url,
                            headers: server.headers.map((item) => ({ ...item })),
                            enabled: server.enabled,
                          })
                        }
                      >
                        <p className="truncate text-body font-medium">{server.name}</p>
                        <p className="truncate font-mono text-caption text-muted-foreground">{server.url}</p>
                        {cached && (
                          <p className="mt-0.5 truncate text-caption text-muted-foreground">
                            {t('mcp.toolCount', { count: cached.tools.length })}
                          </p>
                        )}
                      </button>
                    </div>
                    <Switch checked={server.enabled} onChange={(checked) => void toggleServer(server, checked)} />
                  </div>
                  <div className="mt-2 flex items-center justify-end gap-1 border-t border-border pt-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busyId === server.id}
                      onClick={() => void reconnect(server)}
                    >
                      <RefreshCw className="size-3.5" aria-hidden />
                      {t('mcp.reconnect')}
                    </Button>
                    <Button size="sm" variant="danger-ghost" onClick={() => void removeServer(server)}>
                      <Trash2 className="size-3.5" aria-hidden />
                      {t('common.delete')}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="mt-5">
        <p className="px-1 text-body font-medium">{t('mcp.builtinTitle')}</p>
        <ul className="mt-2 overflow-hidden rounded-lg border border-border bg-surface">
          {BUILTIN_TOOLS.map((tool) => {
            const enabled = !config.disabled.includes(tool.name)
            return (
              <li key={tool.name} className="list-row py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-body">{tool.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-caption text-muted-foreground">{tool.description}</p>
                </div>
                <Switch checked={enabled} onChange={(checked) => toggleBuiltin(tool.name, checked)} />
              </li>
            )
          })}
        </ul>
      </section>

      <Dialog
        open={editing !== null}
        onClose={() => {
          if (!connecting) setEditing(null)
        }}
        title={editing?.id ? t('mcp.editServer') : t('mcp.addServer')}
        footer={
          <>
            <Button variant="ghost" disabled={connecting} onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button loading={connecting} onClick={() => void saveServer()}>
              {connecting ? t('mcp.connecting') : t('mcp.saveConnect')}
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-3">
            <Input
              label={t('mcp.serverName')}
              value={editing.name}
              onChange={(event) => setEditing({ ...editing, name: event.target.value })}
              placeholder="example"
            />
            <Input
              label={t('mcp.serverUrl')}
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              value={editing.url}
              onChange={(event) => setEditing({ ...editing, url: event.target.value })}
              placeholder="https://example.com/mcp"
            />
            <div>
              <p className="text-caption font-medium text-muted-foreground">{t('mcp.headers')}</p>
              {editing.headers.map((header, index) => (
                <div key={index} className="mt-1.5 flex items-center gap-1.5">
                  <input
                    value={header.key}
                    onChange={(event) => {
                      const headers = [...editing.headers]
                      headers[index] = { ...header, key: event.target.value }
                      setEditing({ ...editing, headers })
                    }}
                    placeholder={t('mcp.headerKey')}
                    className="w-32 rounded-md border border-input bg-surface px-2.5 py-2 text-caption outline-none focus:border-primary"
                  />
                  <input
                    value={header.value}
                    onChange={(event) => {
                      const headers = [...editing.headers]
                      headers[index] = { ...header, value: event.target.value }
                      setEditing({ ...editing, headers })
                    }}
                    placeholder={t('mcp.headerValue')}
                    className="min-w-0 flex-1 rounded-md border border-input bg-surface px-2.5 py-2 text-caption outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    aria-label={t('common.delete')}
                    onClick={() =>
                      setEditing({
                        ...editing,
                        headers: editing.headers.filter((_, position) => position !== index),
                      })
                    }
                    className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground active:bg-accent"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setEditing({ ...editing, headers: [...editing.headers, { key: '', value: '' }] })}
                className="mt-1.5 flex min-h-tap items-center gap-1 text-caption text-primary active:opacity-70"
              >
                <Plus className="size-3.5" aria-hidden />
                {t('mcp.addHeader')}
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}
