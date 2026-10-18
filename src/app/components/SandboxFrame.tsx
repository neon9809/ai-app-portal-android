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

const CAPABILITY_TEXT: Record<RuntimeCapability, { title: string; description: string }> = {
  storage: {
    title: '保存到本机',
    description: '这个工具想在本机保存数据。数据只留在这台设备上，不会上传。',
  },
  llm: {
    title: '使用 AI',
    description: '这个工具会把你输入的内容发送给你配置的模型服务。',
  },
  network: {
    title: '访问网络',
    description: '这个工具会访问它在权限卡里声明的网站。',
  },
  clipboard: {
    title: '读写剪贴板',
    description: '这个工具会读写系统剪贴板，用来粘贴内容或复制结果。',
  },
  files: {
    title: '使用文件',
    description: '这个工具可以让你选择本机文件，或把 https 文件下载到应用目录。',
  },
  bluetooth: {
    title: '使用蓝牙',
    description: '这个工具会扫描并连接附近的蓝牙设备（BLE）。',
  },
  record: {
    title: '使用麦克风',
    description: '这个工具会打开麦克风录音，录到的音频保存在本机。',
  },
  camera: {
    title: '使用相机',
    description: '这个工具会打开系统相机拍照或录像。',
  },
  location: {
    title: '获取位置',
    description: '这个工具会读取你当前的位置，只用于它自己的功能。',
  },
  notifications: {
    title: '给你发提醒',
    description:
      '这个工具会在门户里给你发提醒（横幅，可选震动）。它不是系统通知栏推送，门户关掉后不会送达。',
  },
  triggers: {
    title: '设置触发器',
    description:
      '这个工具可以按时间或位置注册触发器。门户打开时才会检查；关闭门户后不会在后台唤醒，错过的时间提醒会在下次打开时补发。',
  },
  deviceApps: {
    title: '打开其它应用',
    description:
      '这个工具可以查看你装了哪些应用、按名字或包名打开其它应用、在浏览器里打开网页、发通知，以及读取屏幕尺寸。',
  },
  deviceFiles: {
    title: '管理本机文件',
    description:
      '这个工具可以在本机文件里搜索、列出、创建、移动、重命名文件和文件夹，也能读取回收站列表。它不会上传文件。',
  },
  deviceUpload: {
    title: '上传文件',
    description: '这个工具会把本机文件上传到服务端。上传前请确认文件内容可以外传。',
  },
  deviceHaptics: {
    title: '震动反馈',
    description: '这个工具会让手机震动，用来做点击或计时提醒。',
  },
  deviceSpeech: {
    title: '语音播报',
    description: '这个工具会把文字用系统语音读出来。播报会打断正在播放的音乐或视频。',
  },
  deviceSystem: {
    title: '修改系统设置',
    description:
      '这个工具可以打开系统的网络设置页面，并修改蓝牙开关、媒体音量、锁屏提示音、来电翻转静音等设置。',
  },
  deviceRecorder: {
    title: '用快记录音',
    description:
      '这个工具会打开系统里的「快记」应用开始、暂停或结束录音。录音文件保存在快记里，不会进入这个工具。',
  },
  deviceCameraModes: {
    title: '相机模式',
    description:
      '这个工具会打开系统相机，并切换到美颜或自拍模式。它只打开相机，不会替你拍照。',
  },
  deviceWeather: {
    title: '查询天气',
    description:
      '这个工具会向天气服务查询你指定城市或当前所在地的天气。按当前位置查询时会读取定位。',
  },
}

/**
 * 应用运行沙箱：负责 iframe 渲染、能力调用、首次授权。
 * Studio 的验收预览与正式运行页共用这一个组件。
 */
export function SandboxFrame({ app }: { app: PortalApp }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const traceId = useMemo(() => uid('t_'), [app.id, app.updatedAt])
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
          '当前环境不支持设备能力（浏览器预览只能查看界面），请在手机上的 AI应用门户 里打开',
        )
      }
      if (!(await deviceAvailable())) {
        throw new Error('设备服务暂时不可用，请稍后重试')
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
          message: `设备能力调用失败：${name}（连接器 ${connector}）`,
          at: now(),
        })
        throw new Error('设备能力调用失败，请稍后重试')
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
          message: `设备能力返回失败：${name}（连接器 ${connector}）`,
          at: now(),
        })
        throw new Error('设备能力调用失败，请稍后重试')
      }
      return result.structuredContent ?? result.content ?? null
    },
    [app.id, deviceAvailable, traceId],
  )

  /* ------------------------- 触发器与应用设置 ------------------------- */

  const deliverTrigger = useCallback((event: TriggerEvent) => {
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
            detail: `授权「${CAPABILITY_TEXT[capability].title}」`,
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
            detail: `拦截 ${host}（${url.slice(0, 120)}）`,
            at: now(),
          })
          void addLog({
            id: uid('l_'),
            appId: app.id,
            traceId,
            level: 'warn',
            message: `已拦截未声明白名单的请求：${host}`,
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
              throw new Error('还没有配置模型，请到设置里填写 API Key')
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
          const message = (cause as Error)?.message ?? '能力调用失败'
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
          <p className="text-body font-medium">应用没能打开</p>
          <p className="text-caption text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={() => setReloadKey((value) => value + 1)}>
            <RefreshCw className="size-4" aria-hidden />
            重新加载
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
          onLoad={flushTriggers}
          onError={() => setError('页面加载失败，请重试')}
        />
      )}

      <Dialog
        open={prompt !== null}
        onClose={() => void grant(false)}
        title={prompt ? CAPABILITY_TEXT[prompt].title : ''}
        description={prompt ? CAPABILITY_TEXT[prompt].description : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => void grant(false)}>
              不允许
            </Button>
            <Button onClick={() => void grant(true)}>允许</Button>
          </>
        }
      >
        {prompt === 'network' && (
          <p className="text-body">
            它能访问的地址：<span className="font-medium">{networkHosts.join('、') || '无'}</span>
          </p>
        )}
        {prompt === 'llm' && (
          <p className="text-caption text-muted-foreground">
            内容会发送到你在设置里填写的模型服务；没有配置模型时，这个功能会给出提示。
          </p>
        )}
        <p className="mt-3 text-caption text-muted-foreground">
          这次授权只对这个工具有效，之后可以在设置里撤回。
        </p>
      </Dialog>
    </div>
  )
}
