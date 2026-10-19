import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

import { isNativeApiAvailable, invokeNative, onNativeEvent } from '@/shared/bridge'
import {
  addAudit,
  addLog,
  addUsage,
  APP_KV_LIMIT_BYTES,
  deleteTrigger,
  getAppSettings,
  kvDelete,
  kvGet,
  kvKeys,
  kvSet,
  listGrants,
  listTriggers,
  saveTrigger,
  setGrant,
  takeTriggerEvents,
} from '@/shared/portal/db'
import { assertBudget } from '@/shared/portal/budget'
import { connectorOfDeviceAbility, isDeviceGroup } from '@/shared/portal/device'
import { checkLocationTriggers } from '@/shared/portal/triggers'
import type {
  AppCapabilityKey,
  AppTrigger,
  PortalApp,
  TriggerEvent,
} from '@/shared/portal/types'
import { chat, isLlmConfigured, readLlmSettings } from '@/shared/portal/llm'
import {
  handleSandboxRequest,
  injectSandboxSdk,
  isSandboxRequest,
  type SandboxContext,
} from '@/shared/portal/sandbox'
import { now, uid } from '@/shared/portal/utils'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Dialog'
import { resolveLocale, translate } from '@/shared/i18n'

type RuntimeCapability = AppCapabilityKey

/** 壳提供的设备桥：BuilderAppHost APK WebView 里注入 window.mcp */
interface McpCallResult {
  isError?: boolean
  errorCode?: number
  content?: unknown
  structuredContent?: unknown
}

interface McpBridge {
  connect?: () => Promise<unknown>
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
}

function getMcpBridge(): McpBridge | null {
  if (typeof window === 'undefined') return null
  const bridge = (window as unknown as { mcp?: McpBridge }).mcp
  return bridge && typeof bridge.callTool === 'function' ? bridge : null
}

const CAPABILITY_TEXT: Record<RuntimeCapability, { titleKey: string; descriptionKey: string }> = {
  storage: { titleKey: 'cap.storage.title', descriptionKey: 'cap.storage.desc' },
  llm: { titleKey: 'cap.llm.title', descriptionKey: 'cap.llm.desc' },
  network: { titleKey: 'cap.network.title', descriptionKey: 'cap.network.desc' },
  clipboard: { titleKey: 'cap.clipboard.title', descriptionKey: 'cap.clipboard.desc' },
  files: { titleKey: 'cap.files.title', descriptionKey: 'cap.files.desc' },
  bluetooth: { titleKey: 'cap.bluetooth.title', descriptionKey: 'cap.bluetooth.desc' },
  record: { titleKey: 'cap.record.title', descriptionKey: 'cap.record.desc' },
  camera: { titleKey: 'cap.camera.title', descriptionKey: 'cap.camera.desc' },
  location: { titleKey: 'cap.location.title', descriptionKey: 'cap.location.desc' },
  notifications: { titleKey: 'cap.notifications.title', descriptionKey: 'cap.notifications.desc' },
  triggers: { titleKey: 'cap.triggers.title', descriptionKey: 'cap.triggers.desc' },
  deviceApps: { titleKey: 'cap.deviceApps.title', descriptionKey: 'cap.deviceApps.desc' },
  deviceFiles: { titleKey: 'cap.deviceFiles.title', descriptionKey: 'cap.deviceFiles.desc' },
  deviceUpload: { titleKey: 'cap.deviceUpload.title', descriptionKey: 'cap.deviceUpload.desc' },
  deviceHaptics: { titleKey: 'cap.deviceHaptics.title', descriptionKey: 'cap.deviceHaptics.desc' },
  deviceSpeech: { titleKey: 'cap.deviceSpeech.title', descriptionKey: 'cap.deviceSpeech.desc' },
  deviceSystem: { titleKey: 'cap.deviceSystem.title', descriptionKey: 'cap.deviceSystem.desc' },
  deviceRecorder: { titleKey: 'cap.deviceRecorder.title', descriptionKey: 'cap.deviceRecorder.desc' },
  deviceCameraModes: { titleKey: 'cap.deviceCameraModes.title', descriptionKey: 'cap.deviceCameraModes.desc' },
  deviceWeather: { titleKey: 'cap.deviceWeather.title', descriptionKey: 'cap.deviceWeather.desc' },
}

/**
 * 应用运行沙箱：负责 iframe 渲染、能力调用、首次授权。
 * Studio 的验收预览与正式运行页共用这一个组件。
 */
export function SandboxFrame({ app }: { app: PortalApp }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const traceId = useMemo(() => uid('t_'), [app.id, app.updatedAt])
  const locale = resolveLocale()
  const tr = useCallback(
    (key: string, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale],
  )
  const [reloadKey, setReloadKey] = useState(0)
  const [prompt, setPrompt] = useState<RuntimeCapability | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pendingRef = useRef<Array<{ capability: RuntimeCapability; resolve: (ok: boolean) => void }>>([])
  const grantedRef = useRef<Set<RuntimeCapability>>(new Set())
  /** 授权列表的加载 Promise：应用一启动就会请求能力，必须等这份列表读完再判断 */
  const grantsReadyRef = useRef<Promise<void> | null>(null)
  /** 同一能力的并发请求共用一次弹窗，避免应用连读多个 key 时弹很多次 */
  const inFlightRef = useRef<Map<RuntimeCapability, Promise<boolean>>>(new Map())
  /** 本次打开期间被拒绝的能力：应用重试时不再连续弹窗 */
  const deniedRef = useRef<Set<RuntimeCapability>>(new Set())
  /** 设备桥连接成功一次后复用；连接失败重置，允许下次重试 */
  const mcpReadyRef = useRef(false)
  /** iframe 是否已加载完成；触发器事件要等它加载后再投递 */
  const frameReadyRef = useRef(false)
  /** 应用是否自行导航离开了沙箱文档（第二次 load 即视为逃逸） */
  const frameEscapedRef = useRef(false)
  const frameLoadsRef = useRef(0)
  const triggerQueueRef = useRef<TriggerEvent[]>([])

  const html = useMemo(
    () => injectSandboxSdk(app.html, window.location.host),
    [app.html, reloadKey],
  )

  const loadGrants = useCallback(async () => {
    const grants = await listGrants(app.id)
    grantedRef.current = new Set(
      grants.filter((grant) => grant.granted).map((grant) => grant.capability),
    )
  }, [app.id])

  useEffect(() => {
    setError(null)
    pendingRef.current.forEach((item) => item.resolve(false))
    pendingRef.current = []
    inFlightRef.current.clear()
    deniedRef.current = new Set()
    mcpReadyRef.current = false
    frameEscapedRef.current = false
    frameLoadsRef.current = 0
    setPrompt(null)
    grantedRef.current = new Set()
    grantsReadyRef.current = loadGrants()
  }, [app.id, app.updatedAt, loadGrants])

  const settle = useCallback((ok: boolean) => {
    const current = pendingRef.current.shift()
    current?.resolve(ok)
    const next = pendingRef.current[0]
    setPrompt(next ? next.capability : null)
  }, [])

  /** 设备桥是否可用：浏览器预览没有原生桥，返回 false */
  const deviceAvailable = useCallback(async (): Promise<boolean> => {
    const bridge = getMcpBridge()
    if (!bridge) return false
    if (mcpReadyRef.current) return true
    if (!bridge.connect) {
      mcpReadyRef.current = true
      return true
    }
    try {
      await bridge.connect()
      mcpReadyRef.current = true
      return true
    } catch {
      mcpReadyRef.current = false
      return false
    }
  }, [])

  /**
   * 转发一次端侧原子能力。
   * 失败时统一成安全文案；诊断日志只写能力名与连接器，不透传设备返回的原文。
   */
  const callDevice = useCallback(
    async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      const connector = connectorOfDeviceAbility(name) ?? 'unknown'
      const bridge = getMcpBridge()
      if (!bridge) {
        throw new Error(
          tr('cap.deviceUnsupported'),
        )
      }
      if (!(await deviceAvailable())) {
        throw new Error(tr('cap.deviceUnavailable'))
      }

      let raw: unknown
      try {
        raw = await bridge.callTool(name, args)
      } catch {
        mcpReadyRef.current = false
        void addLog({
          id: uid('l_'),
          appId: app.id,
          traceId,
          level: 'error',
          message: tr('cap.deviceCallFail', { name, connector }),
          at: now(),
        })
        throw new Error(tr('cap.deviceCallRetry'))
      }

      const result = (raw ?? {}) as McpCallResult
      if (
        result.isError === true ||
        (typeof result.errorCode === 'number' && result.errorCode !== 0)
      ) {
        void addLog({
          id: uid('l_'),
          appId: app.id,
          traceId,
          level: 'error',
          message: tr('cap.deviceResultFail', { name, connector }),
          at: now(),
        })
        throw new Error(tr('cap.deviceCallRetry'))
      }
      return result.structuredContent ?? result.content ?? null
    },
    [app.id, deviceAvailable, traceId],
  )

  /* ------------------------- 触发器与应用设置 ------------------------- */

  const deliverTrigger = useCallback((event: TriggerEvent) => {
    if (frameEscapedRef.current) return
    if (!frameReadyRef.current) {
      triggerQueueRef.current.push(event)
      return
    }
    frameRef.current?.contentWindow?.postMessage(
      { __aiPortal: 1, event: 'trigger', payload: event },
      '*',
    )
  }, [])

  const flushTriggers = useCallback(() => {
    if (frameEscapedRef.current) return
    frameReadyRef.current = true
    const queue = triggerQueueRef.current
    triggerQueueRef.current = []
    for (const event of queue) {
      frameRef.current?.contentWindow?.postMessage(
        { __aiPortal: 1, event: 'trigger', payload: event },
        '*',
      )
    }
  }, [])

  /**
   * iframe 每次 load 都会进来：第一次是 srcdoc 文档加载完成；
   * 之后再有 load 说明应用把文档导航到了别处（沙箱里的新文档没有 CSP/SDK），
   * 立即拆掉推送通道并卸载，避免把触发事件或原生事件送进攻击者页面。
   */
  const handleFrameLoad = useCallback(() => {
    frameLoadsRef.current += 1
    if (frameLoadsRef.current > 1) {
      frameEscapedRef.current = true
      frameReadyRef.current = false
      triggerQueueRef.current = []
      setError(tr('cap.escaped'))
      return
    }
    flushTriggers()
  }, [flushTriggers])

  const registerTrigger = useCallback(async (trigger: AppTrigger) => {
    await saveTrigger(trigger)
  }, [])

  const listAppTriggers = useCallback(() => listTriggers(app.id), [app.id])

  const removeTrigger = useCallback(
    async (id: string) => {
      const all = await listTriggers(app.id)
      if (all.some((item) => item.id === id)) await deleteTrigger(id)
    },
    [app.id],
  )

  const setTriggerEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      const all = await listTriggers(app.id)
      const found = all.find((item) => item.id === id)
      if (found) await saveTrigger({ ...found, enabled })
    },
    [app.id],
  )

  const notify = useCallback(
    async (input: { title: string; body?: string }) => {
      const settings = await getAppSettings(app.id)
      if (!settings.notifications.enabled) return false
      window.dispatchEvent(
        new CustomEvent('portal:notice', {
          detail: {
            id: `${app.id}-${Date.now()}`,
            appId: app.id,
            appName: app.name,
            title: input.title,
            body: input.body,
            at: now(),
          },
        }),
      )
      return true
    },
    [app.id, app.name],
  )

  const readAppSettings = useCallback(() => getAppSettings(app.id), [app.id])

  // 打开应用时补发离线期间攒下的触发事件；运行期间的触发事件实时投递
  useEffect(() => {
    let alive = true
    frameReadyRef.current = false
    triggerQueueRef.current = []
    const onTrigger = (event: Event) => {
      const detail = (event as CustomEvent<TriggerEvent>).detail
      if (detail && detail.appId === app.id) deliverTrigger(detail)
    }
    window.addEventListener('portal:trigger', onTrigger as EventListener)
    void (async () => {
      const pending = await takeTriggerEvents(app.id)
      if (!alive) return
      for (const event of pending) deliverTrigger(event)
    })()
    return () => {
      alive = false
      window.removeEventListener('portal:trigger', onTrigger as EventListener)
    }
  }, [app.id, app.updatedAt, deliverTrigger])

  const askPermission = useCallback(
    async (capability: RuntimeCapability): Promise<boolean> => {
      const declared = isDeviceGroup(capability)
        ? Boolean(app.manifest.capabilities.device?.includes(capability))
        : capability === 'storage'
          ? app.manifest.capabilities.storage
          : capability === 'llm'
            ? app.manifest.capabilities.llm
            : capability === 'network'
              ? app.manifest.capabilities.network.length > 0
              : Boolean(app.manifest.capabilities[capability])
      if (!declared) return false

      // 端能力还要先确认壳里真的支持，避免应用一直弹授权却调不通
      if (isDeviceGroup(capability)) {
        if (!(await deviceAvailable())) return false
      } else if (capability !== 'notifications' && capability !== 'triggers') {
        if (capability !== 'storage' && capability !== 'llm' && capability !== 'network') {
          const available = await isNativeApiAvailable(
            capability === 'clipboard'
              ? 'getClipboardData'
              : capability === 'files'
                ? 'chooseMessageFile'
                : capability === 'record'
                  ? 'recordAudio'
                  : capability === 'camera'
                    ? 'chooseImage'
                    : capability === 'location'
                      ? 'getLocation'
                      : 'openBluetoothAdapter',
          )
          if (!available) return false
        }
      }

      // 等授权列表读完再判断；应用启动时连续读多个 key 也只会弹一次
      if (!grantsReadyRef.current) grantsReadyRef.current = loadGrants()
      await grantsReadyRef.current
      if (grantedRef.current.has(capability)) return true
      if (deniedRef.current.has(capability)) return false

      const existing = inFlightRef.current.get(capability)
      if (existing) return existing

      const promise = new Promise<boolean>((resolve) => {
        pendingRef.current.push({ capability, resolve })
        setPrompt((current) => current ?? capability)
      })
      inFlightRef.current.set(capability, promise)
      return promise
    },
    [app.manifest.capabilities, deviceAvailable, loadGrants],
  )

  const grant = useCallback(
    async (allowed: boolean) => {
      if (!prompt) return
      const capability = prompt
      let ok = allowed
      if (allowed) {
        try {
          grantedRef.current.add(capability)
          await setGrant({
            appId: app.id,
            capability,
            granted: true,
            grantedAt: now(),
          })
          await addAudit({
            id: uid('au_'),
            appId: app.id,
            appName: app.name,
            kind: 'capability.grant',
            detail: tr('cap.grantDetail', { title: tr(CAPABILITY_TEXT[capability].titleKey) }),
            at: now(),
          })
        } catch {
          // 写授权失败时也要关掉弹窗，不能把用户卡在这里
          grantedRef.current.delete(capability)
          ok = false
        }
      }
      inFlightRef.current.delete(capability)
      if (!ok) deniedRef.current.add(capability)
      settle(ok)
    },
    [app.id, app.name, prompt, settle],
  )

  // 位置触发器：应用运行且已授权定位时，每 2 分钟检查一次
  useEffect(() => {
    if (!app.manifest.capabilities.location) return
    let alive = true
    const check = async () => {
      if (!alive || document.visibilityState !== 'visible') return
      try {
        const all = await listTriggers(app.id)
        if (!all.some((item) => item.enabled && item.kind === 'location')) return
        if (!(await askPermission('location'))) return
        const position = await invokeNative('getLocation', {
          type: 'wgs84',
          isHighAccuracy: false,
        })
        const events = await checkLocationTriggers(app.id, {
          latitude: position.latitude,
          longitude: position.longitude,
        })
        for (const event of events) {
          window.dispatchEvent(new CustomEvent('portal:trigger', { detail: event }))
          if (!event.action.notify) continue
          window.dispatchEvent(
            new CustomEvent('portal:notice', {
              detail: {
                id: `${event.triggerId}-${event.at}`,
                appId: event.appId,
                appName: event.appName,
                title: event.action.notify.title,
                body: event.action.notify.body,
                at: event.at,
                vibrate: event.action.vibrate,
              },
            }),
          )
        }
      } catch {
        // 定位失败或用户拒绝时不打扰，下一轮再试
      }
    }
    const first = window.setTimeout(() => void check(), 6000)
    const timer = window.setInterval(() => void check(), 120_000)
    return () => {
      alive = false
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [app.id, app.manifest.capabilities.location, askPermission])

  // 把壳的蓝牙 / 录音事件转发给沙箱
  useEffect(() => {
    let alive = true
    const cleanups: Array<() => void> = []
    const events = [
      'recordAudioStop',
      'bluetoothAdapterStateChange',
      'bluetoothDeviceFound',
      'BLEConnectionStateChange',
      'BLECharacteristicValueChange',
      'BLEMTUChange',
    ] as const
    void (async () => {
      for (const name of events) {
        const off = await onNativeEvent(name, (payload) => {
          if (frameEscapedRef.current) return
          frameRef.current?.contentWindow?.postMessage(
            { __aiPortal: 1, event: name, payload },
            '*',
          )
        })
        if (alive) cleanups.push(off)
        else off()
      }
    })()
    return () => {
      alive = false
      for (const off of cleanups) off()
    }
  }, [app.id])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return
      if (frameEscapedRef.current) return
      // srcdoc + sandbox（无 allow-same-origin）的文档是不透明源，origin 恒为 "null"
      // （个别内核给空串）。应用若自行导航到外部页面，origin 会变成目标站点，这里直接拒绝，
      // 避免新文档在没有 CSP 的情况下继续以该应用身份调用 portal 能力。
      if (event.origin !== 'null' && event.origin !== '') return
      const data = event.data
      if (!isSandboxRequest(data)) return
      const params = data.params ?? {}

      if (data.method === 'log') {
        const level = ['debug', 'info', 'warn', 'error'].includes(String(params.level))
          ? (String(params.level) as 'debug' | 'info' | 'warn' | 'error')
          : 'info'
        void addLog({
          id: uid('l_'),
          appId: app.id,
          traceId,
          level,
          message: String(params.message ?? '').slice(0, 2000),
          data: params.data === undefined ? undefined : JSON.stringify(params.data).slice(0, 4000),
          at: now(),
        })
        frameRef.current?.contentWindow?.postMessage(
          { __aiPortal: 1, reply: true, id: data.id, ok: true, result: true },
          '*',
        )
        return
      }

      const context: SandboxContext = {
        appId: app.id,
        appName: app.name,
        capabilities: app.manifest.capabilities,
        kv: {
          get: (key) => kvGet(app.id, key),
          set: (key, value) => kvSet(app.id, key, value, APP_KV_LIMIT_BYTES),
          remove: (key) => kvDelete(app.id, key),
          keys: () => kvKeys(app.id),
        },
        ensurePermission: askPermission,
        onLog: (level, message, payload) => {
          void addLog({
            id: uid('l_'),
            appId: app.id,
            traceId,
            level: level as 'debug' | 'info' | 'warn' | 'error',
            message,
            data: payload === undefined ? undefined : JSON.stringify(payload).slice(0, 4000),
            at: now(),
          })
        },
        onNetworkBlocked: (host, url) => {
          void addAudit({
            id: uid('au_'),
            appId: app.id,
            appName: app.name,
            kind: 'network.block',
            detail: tr('cap.blockHost', { host, url: url.slice(0, 120) }),
            at: now(),
          })
          void addLog({
            id: uid('l_'),
            appId: app.id,
            traceId,
            level: 'warn',
            message: tr('cap.blockUndeclared', { host }),
            at: now(),
          })
        },
        onLlmUsage: (inputTokens, outputTokens, model) => {
          void addUsage({
            id: uid('u_'),
            appId: app.id,
            appName: app.name,
            kind: 'app-call',
            model,
            inputTokens,
            outputTokens,
            at: now(),
          })
        },
        deviceAvailable,
        callDevice,
        registerTrigger,
        listAppTriggers,
        removeTrigger,
        setTriggerEnabled,
        notify,
        readAppSettings,
      }

      void (async () => {
        try {
          const result = await handleSandboxRequest(data, context, async (messages) => {
            const settings = await readLlmSettings()
            if (!isLlmConfigured(settings)) {
              throw new Error(tr('cap.noModel'))
            }
            await assertBudget(app.id)
            const model = settings.appModel.trim() || settings.model
            const response = await chat(messages, { settings, model })
            return response
          })
          frameRef.current?.contentWindow?.postMessage(
            { __aiPortal: 1, reply: true, id: data.id, ok: true, result },
            '*',
          )
        } catch (cause) {
          const message = (cause as Error)?.message ?? tr('cap.callFailed')
          void addLog({
            id: uid('l_'),
            appId: app.id,
            traceId,
            level: 'error',
            message: `[${data.method}] ${message}`,
            at: now(),
          })
          frameRef.current?.contentWindow?.postMessage(
            { __aiPortal: 1, reply: true, id: data.id, ok: false, error: message },
            '*',
          )
        }
      })()
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [app.id, app.manifest.capabilities, app.name, askPermission, callDevice, deviceAvailable, listAppTriggers, notify, readAppSettings, registerTrigger, removeTrigger, setTriggerEnabled, traceId])

  const networkHosts = app.manifest.capabilities.network

  return (
    <div className="relative h-full w-full bg-surface">
      {error ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <AlertTriangle className="size-8 text-warning" aria-hidden />
          <p className="text-body font-medium">{tr('cap.openFailed')}</p>
          <p className="text-caption text-muted-foreground">{error}</p>
          <Button
            variant="outline"
            onClick={() => {
              frameEscapedRef.current = false
              frameLoadsRef.current = 0
              frameReadyRef.current = false
              setReloadKey((value) => value + 1)
            }}
          >
            <RefreshCw className="size-4" aria-hidden />
            {tr('cap.reload')}
          </Button>
        </div>
      ) : (
        <iframe
          key={`${app.id}-${app.updatedAt}-${reloadKey}`}
          ref={frameRef}
          title={app.name}
          srcDoc={html}
          sandbox="allow-scripts allow-forms"
          className="h-full w-full border-0 bg-surface"
          onLoad={handleFrameLoad}
          onError={() => setError(tr('cap.loadFailed'))}
        />
      )}

      <Dialog
        open={prompt !== null}
        onClose={() => void grant(false)}
        title={prompt ? tr(CAPABILITY_TEXT[prompt].titleKey) : ''}
        description={prompt ? tr(CAPABILITY_TEXT[prompt].descriptionKey) : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => void grant(false)}>
              {tr('cap.deny')}
            </Button>
            <Button onClick={() => void grant(true)}>{tr('cap.allow')}</Button>
          </>
        }
      >
        {prompt === 'network' && (
          <p className="text-body">
            {tr('cap.networkHosts')}<span className="font-medium">{networkHosts.join(', ') || tr('cap.none')}</span>
          </p>
        )}
        {prompt === 'llm' && (
          <p className="text-caption text-muted-foreground">
            {tr('cap.llmNote')}
          </p>
        )}
        <p className="mt-3 text-caption text-muted-foreground">
          {tr('cap.scopeNote')}
        </p>
      </Dialog>
    </div>
  )
}
