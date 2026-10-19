/**
 * 应用沙箱：把生成的应用放进 <iframe sandbox="allow-scripts allow-forms"> 里运行，
 * 并通过 postMessage 提供唯一的能力入口 window.portal。
 *
 * 隔离边界（如实说明）：
 *  - iframe 不给 allow-same-origin，应用拿不到宿主页面的 DOM / localStorage / IndexedDB；
 *  - 应用的数据经 portal.storage 存在宿主按 appId 隔离的 IndexedDB 里；
 *  - 出站请求经 portal.network.fetch 走宿主代理并执行 manifest 里的白名单；
 *  - 这是 H5 层隔离，不是原生进程沙箱——本版本没有系统级隔离。
 */

import { invokeNative, getBridgeMode, initBridge } from '@/shared/bridge'
import type { NativeApiName } from '@/shared/bridge/types'
import { capabilityOfDeviceAbility, DEVICE_ABILITIES, isDeviceGroup } from './device'
import { normalizeTrigger } from './triggers'
import type {
  AppCapabilities,
  AppCapabilityKey,
  AppTrigger,
  AppUserSettings,
} from './types'

/* ------------------------------------------------------------------ *
 * SDK 注入
 * ------------------------------------------------------------------ */

/**
 * 注入到应用 <head> 里的 SDK。
 * 不要用模板字符串里出现 `</script>` 字面量；这里写成普通字符串拼接。
 */
const SDK_SOURCE = `
(function () {
  'use strict';
  var seq = 0;
  var pending = {};
  function call(method, params) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending[id] = { resolve: resolve, reject: reject };
      try {
        parent.postMessage({ __aiPortal: 1, id: id, method: method, params: params || {} }, '*');
      } catch (error) {
        delete pending[id];
        reject(error);
      }
    });
  }
  var listeners = {};
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.__aiPortal !== 1) return;
    if (data.event) {
      var handlers = listeners[data.event] || [];
      for (var i = 0; i < handlers.length; i++) {
        try { handlers[i](data.payload); } catch (error) {}
      }
      return;
    }
    if (!data.reply) return;
    var task = pending[data.id];
    if (!task) return;
    delete pending[data.id];
    if (data.ok) task.resolve(data.result);
    else task.reject(new Error(data.error || '应用能力调用失败'));
  });
  var portal = {
    storage: {
      get: function (key, fallback) { return call('storage.get', { key: String(key), fallback: fallback }); },
      set: function (key, value) { return call('storage.set', { key: String(key), value: value }); },
      remove: function (key) { return call('storage.remove', { key: String(key) }); },
      keys: function () { return call('storage.keys'); }
    },
    llm: {
      chat: function (messages, options) { return call('llm.chat', { messages: messages, options: options || {} }); }
    },
    network: {
      fetch: function (url, init) { return call('network.fetch', { url: String(url), init: init || {} }); }
    },
    log: function (level, message, data) {
      return call('log', { level: level || 'info', message: String(message), data: data });
    },
    clipboard: {
      read: function () { return call('clipboard.read', {}); },
      write: function (text) { return call('clipboard.write', { text: String(text || '') }); }
    },
    files: {
      pick: function (options) { return call('files.pick', options || {}); },
      download: function (url, options) { return call('files.download', { url: String(url), options: options || {} }); }
    },
    bluetooth: {
      call: function (method, params) {
        return call('bluetooth.call', { method: String(method), params: params || {} });
      }
    },
    record: {
      start: function (options) { return call('record.start', options || {}); },
      stop: function () { return call('record.stop', {}); }
    },
    camera: {
      capture: function (options) { return call('camera.capture', options || {}); },
      recordVideo: function (options) { return call('camera.recordVideo', options || {}); }
    },
    location: {
      get: function (options) { return call('location.get', options || {}); }
    },
    device: {
      // 端侧原子能力统一入口；name 必须是连接器提供的能力名
      call: function (name, args) {
        return call('device.call', { name: String(name), args: args || {} });
      },
      // 当前环境是否有可用的设备桥（浏览器预览为 false）
      available: function () { return call('device.available', {}); }
    },
    triggers: {
      // 注册时间 / 位置触发器；门户在前台检查并提醒
      register: function (input) { return call('triggers.register', { trigger: input || {} }); },
      list: function () { return call('triggers.list', {}); },
      remove: function (id) { return call('triggers.remove', { id: String(id) }); },
      setEnabled: function (id, enabled) {
        return call('triggers.setEnabled', { id: String(id), enabled: !!enabled });
      }
    },
    settings: {
      // 应用设置页里的通知偏好（只读，写入由门户负责）
      get: function () { return call('settings.get', {}); }
    },
    mcp: {
      // 调用门户配置的 MCP 工具（须在 capabilities.mcp 里声明，首次调用会询问用户）
      call: function (tool, args) {
        return call('mcp.call', { tool: String(tool), args: args || {} });
      }
    },
    notify: function (input) { return call('notify', { input: input || {} }); },
    on: function (name, handler) {
      if (!listeners[name]) listeners[name] = [];
      listeners[name].push(handler);
      return function () { portal.off(name, handler); };
    },
    off: function (name, handler) {
      var list = listeners[name];
      if (!list) return;
      var index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    }
  };
  window.portal = portal;
  window.addEventListener('error', function (event) {
    try {
      portal.log('error', event.message || '脚本错误', {
        stack: event.error && event.error.stack,
        line: event.lineno
      });
    } catch (_) {}
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    try {
      portal.log('error', 'Promise 未处理异常', {
        reason: reason && (reason.stack || reason.message) || String(reason)
      });
    } catch (_) {}
  });
  // 第二层防线：即使 CSP 没生效，也不允许应用绕过 portal 直接联网
  try {
    window.fetch = function () {
      return Promise.reject(new Error('应用不能直接联网，请使用 window.portal.network.fetch'));
    };
    window.XMLHttpRequest = function () {
      throw new Error('应用不能直接联网，请使用 window.portal.network.fetch');
    };
    window.WebSocket = function () {
      throw new Error('应用不能直接联网');
    };
    window.EventSource = function () {
      throw new Error('应用不能直接联网');
    };
    if (navigator.sendBeacon) {
      navigator.sendBeacon = function () { return false; };
    }
  } catch (_) {}
  window.__aiPortalReady = true;
})();
`.trim()

/**
 * 把 CSP 与 SDK 插入应用 HTML 的 head 最前面。
 * CSP 只放行内联脚本 / 样式、data: 媒体和壳自己的媒体主机；
 * 出站请求全部走 portal.network.fetch，绕不过白名单。
 */
export function injectSandboxSdk(html: string, mediaHost?: string): string {
  const host = mediaHost ?? (typeof location !== 'undefined' ? location.host : '')
  const media = host ? `https://${host}` : ''
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    `img-src data: blob: ${media}`.trim(),
    `media-src data: blob: ${media}`.trim(),
    'font-src data:',
    "connect-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ')
  const tag = `<meta http-equiv="Content-Security-Policy" content="${csp}">\n<script>${SDK_SOURCE}</script>`
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}\n${tag}`)
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (match) => `${match}\n${tag}`)
  }
  return `${tag}\n${html}`
}

/* ------------------------------------------------------------------ *
 * 宿主侧处理
 * ------------------------------------------------------------------ */

export interface SandboxKv {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
  keys(): Promise<string[]>
}

export interface SandboxContext {
  /** MCP 执行器：由宿主提供（聚合内置 + 外部服务器）；未配置时为 undefined */
  callMcpTool?: (tool: string, args: Record<string, unknown>) => Promise<string>
  /** 应用声明过的 MCP 工具清单（capabilities.mcp）；用于声明校验 */
  declaredMcpTools?: readonly string[]
  appId: string
  appName: string
  capabilities: AppCapabilities
  kv: SandboxKv
  /** 首次调用某类能力时向用户确认；返回 false 表示拒绝 */
  ensurePermission: (capability: AppCapabilityKey) => Promise<boolean>
  onLog: (level: string, message: string, data?: unknown) => void
  onNetworkBlocked: (host: string, url: string) => void
  onLlmUsage: (inputTokens: number, outputTokens: number, model: string) => void
  /** 当前环境是否具备设备桥（浏览器预览为 false） */
  deviceAvailable: () => Promise<boolean>
  /** 经宿主转发一次端侧原子能力；失败时抛出脱敏后的错误 */
  callDevice: (name: string, args: Record<string, unknown>) => Promise<unknown>
  /** 注册 / 管理触发器（宿主落库） */
  registerTrigger: (trigger: AppTrigger) => Promise<void>
  listAppTriggers: () => Promise<AppTrigger[]>
  removeTrigger: (id: string) => Promise<void>
  setTriggerEnabled: (id: string, enabled: boolean) => Promise<void>
  /** 应用主动提醒用户（受应用设置里的通知开关约束） */
  notify: (input: { title: string; body?: string }) => Promise<boolean>
  /** 读取应用在门户里的设置（只读） */
  readAppSettings: () => Promise<AppUserSettings>
  /** 自检时禁止联网与真实模型调用 */
  offline?: boolean
}

interface SandboxRequest {
  __aiPortal: 1
  id: number
  method: string
  params: Record<string, unknown>
}

export function isSandboxRequest(data: unknown): data is SandboxRequest {
  return Boolean(data && typeof data === 'object' && (data as SandboxRequest).__aiPortal === 1)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function safeJsonSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length
  } catch {
    return 0
  }
}

function normalizeMessages(raw: unknown): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  if (!Array.isArray(raw)) throw new Error('messages 必须是数组')
  const messages = raw.slice(0, 20).map((item) => {
    const message = asRecord(item)
    const role = message.role === 'system' || message.role === 'assistant' ? message.role : 'user'
    return { role, content: String(message.content ?? '').slice(0, 20_000) } as const
  })
  if (messages.length === 0) throw new Error('messages 不能为空')
  return messages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
}

function hostAllowed(host: string, allow: string[]): boolean {
  const normalized = host.toLowerCase()
  return allow.some((rule) => {
    const item = rule.trim().toLowerCase().replace(/^\*\./, '')
    if (!item) return false
    return normalized === item || normalized.endsWith(`.${item}`)
  })
}

async function proxyFetch(
  url: string,
  init: Record<string, unknown>,
  allow: string[],
  ctx: SandboxContext,
): Promise<{ ok: boolean; status: number; headers: Record<string, string>; body: string }> {
  if (ctx.offline) throw new Error('自检模式下不发起网络请求')

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('请求地址不合法')
  }
  if (parsed.protocol !== 'https:') throw new Error('只允许 https 请求')
  if (!hostAllowed(parsed.hostname, allow)) {
    ctx.onNetworkBlocked(parsed.hostname, url)
    throw new Error(`域名 ${parsed.hostname} 不在应用声明的白名单里`)
  }

  const method = String(init.method ?? 'GET').toUpperCase()
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) {
    throw new Error(`不支持 ${method} 请求`)
  }
  const headers = asRecord(init.headers) as Record<string, string>
  const rawBody = init.body
  const body = typeof rawBody === 'string' ? rawBody : rawBody == null ? undefined : JSON.stringify(rawBody)

  if (body && body.length > 200_000) throw new Error('请求内容超过 200KB 上限')

  await initBridge()
  if (getBridgeMode() === 'native') {
    const result = await invokeNative('request', {
      url,
      method,
      header: headers,
      data: body,
      timeout: 30_000,
      dataType: 'text',
    })
    const payload = typeof result.data === 'string' ? result.data : JSON.stringify(result.data ?? '')
    return {
      ok: result.statusCode >= 200 && result.statusCode < 300,
      status: result.statusCode,
      headers: result.header ?? {},
      body: payload,
    }
  }

  const response = await fetch(url, { method, headers, body })
  const text = await response.text()
  const responseHeaders: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value
  })
  return {
    ok: response.ok,
    status: response.status,
    headers: responseHeaders,
    body: text.slice(0, 500_000),
  }
}

/**
 * 处理来自沙箱的一次能力调用。所有失败都转成结构化错误返回给 iframe，
 * 宿主侧不因为应用出错而崩。
 */
export async function handleSandboxRequest(
  request: SandboxRequest,
  ctx: SandboxContext,
  llmChat: (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => Promise<{
    content: string
    inputTokens: number
    outputTokens: number
    model: string
  }>,
): Promise<unknown> {
  const params = request.params ?? {}

  switch (request.method) {
    case 'storage.get': {
      if (!(await ctx.ensurePermission('storage'))) throw new Error('用户未授权本地存储')
      const fallback = params.fallback
      const value = await ctx.kv.get(String(params.key ?? ''))
      return value === undefined ? fallback ?? null : value
    }
    case 'storage.set': {
      if (!(await ctx.ensurePermission('storage'))) throw new Error('用户未授权本地存储')
      if (safeJsonSize(params.value) > 512_000) throw new Error('单条数据超过 500KB 上限')
      await ctx.kv.set(String(params.key ?? ''), params.value)
      return true
    }
    case 'storage.remove': {
      if (!(await ctx.ensurePermission('storage'))) throw new Error('用户未授权本地存储')
      await ctx.kv.remove(String(params.key ?? ''))
      return true
    }
    case 'storage.keys': {
      if (!(await ctx.ensurePermission('storage'))) throw new Error('用户未授权本地存储')
      return ctx.kv.keys()
    }
    case 'llm.chat': {
      if (!ctx.capabilities.llm) throw new Error('这个应用没有声明 AI 能力')
      if (ctx.offline) throw new Error('自检模式下不调用模型')
      if (!(await ctx.ensurePermission('llm'))) throw new Error('用户未授权 AI 能力')
      const messages = normalizeMessages(params.messages)
      const result = await llmChat(messages)
      ctx.onLlmUsage(result.inputTokens, result.outputTokens, result.model)
      return { content: result.content, model: result.model }
    }
    case 'network.fetch': {
      if (ctx.capabilities.network.length === 0) throw new Error('这个应用没有声明联网能力')
      if (!(await ctx.ensurePermission('network'))) throw new Error('用户未授权联网能力')
      return proxyFetch(String(params.url ?? ''), asRecord(params.init), ctx.capabilities.network, ctx)
    }
    case 'clipboard.read': {
      if (!ctx.capabilities.clipboard) throw new Error('这个应用没有声明剪贴板能力')
      if (!(await ctx.ensurePermission('clipboard'))) throw new Error('用户未授权剪贴板')
      const result = await invokeNative('getClipboardData')
      return result.data
    }
    case 'clipboard.write': {
      if (!ctx.capabilities.clipboard) throw new Error('这个应用没有声明剪贴板能力')
      if (!(await ctx.ensurePermission('clipboard'))) throw new Error('用户未授权剪贴板')
      await invokeNative('setClipboardData', { data: String(params.text ?? '') })
      return true
    }
    case 'files.pick': {
      if (!ctx.capabilities.files) throw new Error('这个应用没有声明文件能力')
      if (ctx.offline) throw new Error('自检模式下不打开文件选择器')
      if (!(await ctx.ensurePermission('files'))) throw new Error('用户未授权文件能力')
      const result = await invokeNative('chooseMessageFile', {
        count: Math.min(5, Math.max(1, Number(params.count) || 1)),
        type: 'file',
        mimeType: params.mimeType ? String(params.mimeType) : undefined,
      })
      return { files: result.tempFiles }
    }
    case 'files.download': {
      if (!ctx.capabilities.files) throw new Error('这个应用没有声明文件能力')
      if (ctx.offline) throw new Error('自检模式下不下载文件')
      const url = String(params.url ?? '')
      if (!/^https:\/\//i.test(url)) throw new Error('下载地址必须是 https')
      const parsed = new URL(url)
      if (!hostAllowed(parsed.hostname, ctx.capabilities.network)) {
        ctx.onNetworkBlocked(parsed.hostname, url)
        throw new Error(`域名 ${parsed.hostname} 不在应用声明的白名单里`)
      }
      const allowHeaders = asRecord(asRecord(params.options).header) as Record<string, string>
      if (!(await ctx.ensurePermission('files'))) throw new Error('用户未授权文件能力')
      return invokeNative('downloadFile', { url, header: allowHeaders, timeout: 60_000 })
    }
    case 'record.start': {
      if (!ctx.capabilities.record) throw new Error('这个应用没有声明录音能力')
      if (ctx.offline) throw new Error('自检模式下不录音')
      if (!(await ctx.ensurePermission('record'))) throw new Error('用户未授权录音')
      const options = asRecord(params)
      return invokeNative('recordAudio', {
        duration: Number(options.duration) || undefined,
        maxDuration: Number(options.maxDuration) || undefined,
        format: options.format === 'amr' ? 'amr' : 'aac',
        sampleRate: Number(options.sampleRate) || undefined,
        numberOfChannels: Number(options.numberOfChannels) || undefined,
        encodeBitRate: Number(options.encodeBitRate) || undefined,
      })
    }
    case 'record.stop': {
      if (!ctx.capabilities.record) throw new Error('这个应用没有声明录音能力')
      if (ctx.offline) throw new Error('自检模式下不录音')
      if (!(await ctx.ensurePermission('record'))) throw new Error('用户未授权录音')
      return invokeNative('stopRecordAudio')
    }
    case 'camera.capture': {
      if (!ctx.capabilities.camera) throw new Error('这个应用没有声明相机能力')
      if (ctx.offline) throw new Error('自检模式下不打开相机')
      if (!(await ctx.ensurePermission('camera'))) throw new Error('用户未授权相机')
      const result = await invokeNative('chooseImage', {
        count: 1,
        sourceType: ['camera'],
      })
      return { tempFilePaths: result.tempFilePaths, tempFiles: result.tempFiles }
    }
    case 'camera.recordVideo': {
      if (!ctx.capabilities.camera) throw new Error('这个应用没有声明相机能力')
      if (ctx.offline) throw new Error('自检模式下不打开相机')
      if (!(await ctx.ensurePermission('camera'))) throw new Error('用户未授权相机')
      const options = asRecord(params)
      return invokeNative('recordVideo', {
        maxDuration: Math.min(600, Math.max(1, Number(options.maxDuration) || 60)),
        camera: options.camera === 'front' ? 'front' : 'back',
        compressed: options.compressed !== false,
      })
    }
    case 'location.get': {
      if (!ctx.capabilities.location) throw new Error('这个应用没有声明定位能力')
      if (ctx.offline) throw new Error('自检模式下不获取定位')
      if (!(await ctx.ensurePermission('location'))) throw new Error('用户未授权定位')
      const options = asRecord(params)
      return invokeNative('getLocation', {
        type: options.type === 'gcj02' ? 'gcj02' : 'wgs84',
        isHighAccuracy: options.isHighAccuracy !== false,
      })
    }
    case 'mcp.call': {
      const tool = String(params.tool ?? '')
      if (!tool) throw new Error('缺少工具名')
      if (!ctx.callMcpTool) throw new Error('门户没有配置可用的 MCP 工具')
      const declared = ctx.capabilities.mcp ?? []
      if (!declared.includes(tool)) {
        throw new Error(`这个应用没有声明 MCP 工具 ${tool}（须写在 capabilities.mcp 里）`)
      }
      if (!(await ctx.ensurePermission('mcp'))) throw new Error('用户拒绝了这个能力')
      const args = asRecord(params.args)
      return ctx.callMcpTool(tool, args)
    }
    case 'device.available': {
      if (ctx.offline) return false
      try {
        return await ctx.deviceAvailable()
      } catch {
        return false
      }
    }
    case 'device.call': {
      const name = String(params.name ?? '')
      const meta = DEVICE_ABILITIES[name]
      if (!meta) throw new Error('这个应用调用了不受支持的设备能力')
      if (ctx.offline) throw new Error('自检模式下不调用设备能力')

      // 先说清楚应用有没有在权限卡里声明这一类能力
      const capability = capabilityOfDeviceAbility(name)
      if (!capability) throw new Error('这个应用调用了不受支持的设备能力')
      const declared = isDeviceGroup(capability)
        ? Boolean(ctx.capabilities.device?.includes(capability))
        : capability === 'clipboard'
          ? Boolean(ctx.capabilities.clipboard)
          : capability === 'location'
            ? Boolean(ctx.capabilities.location)
            : false
      if (!declared) throw new Error('这个应用没有声明这项设备能力')

      if (!(await ctx.deviceAvailable())) {
        throw new Error('当前环境不支持设备能力（浏览器预览只能查看界面），请在手机上的 AI应用门户 里打开')
      }
      if (!(await ctx.ensurePermission(capability))) throw new Error('用户未授权这项设备能力')
      return ctx.callDevice(name, asRecord(params.args))
    }
    case 'triggers.register': {
      if (!ctx.capabilities.triggers) throw new Error('这个应用没有声明触发器能力')
      if (ctx.offline) throw new Error('自检模式下不注册触发器')
      if (!(await ctx.ensurePermission('triggers'))) throw new Error('用户未授权触发器')
      const trigger = normalizeTrigger(
        { id: ctx.appId, name: ctx.appName },
        asRecord(params.trigger),
      )
      if (trigger.kind === 'location' && !ctx.capabilities.location) {
        throw new Error('位置触发器还需要声明定位能力')
      }
      await ctx.registerTrigger(trigger)
      return trigger
    }
    case 'triggers.list': {
      if (!ctx.capabilities.triggers) throw new Error('这个应用没有声明触发器能力')
      if (!(await ctx.ensurePermission('triggers'))) throw new Error('用户未授权触发器')
      return ctx.listAppTriggers()
    }
    case 'triggers.remove': {
      if (!ctx.capabilities.triggers) throw new Error('这个应用没有声明触发器能力')
      if (!(await ctx.ensurePermission('triggers'))) throw new Error('用户未授权触发器')
      await ctx.removeTrigger(String(params.id ?? ''))
      return true
    }
    case 'triggers.setEnabled': {
      if (!ctx.capabilities.triggers) throw new Error('这个应用没有声明触发器能力')
      if (!(await ctx.ensurePermission('triggers'))) throw new Error('用户未授权触发器')
      await ctx.setTriggerEnabled(String(params.id ?? ''), params.enabled === true)
      return true
    }
    case 'notify': {
      if (!ctx.capabilities.notifications) throw new Error('这个应用没有声明通知能力')
      if (ctx.offline) throw new Error('自检模式下不提醒用户')
      if (!(await ctx.ensurePermission('notifications'))) throw new Error('用户未授权通知')
      const input = asRecord(params.input)
      const title = String(input.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
      const body = String(input.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
      if (!title) throw new Error('提醒需要一个标题')
      return ctx.notify({ title, body: body || undefined })
    }
    case 'settings.get': {
      return ctx.readAppSettings()
    }
    case 'bluetooth.call': {
      if (!ctx.capabilities.bluetooth) throw new Error('这个应用没有声明蓝牙能力')
      if (ctx.offline) throw new Error('自检模式下不使用蓝牙')
      if (!(await ctx.ensurePermission('bluetooth'))) throw new Error('用户未授权蓝牙')
      const method = String(params.method ?? '')
      const allowed = new Set([
        'openBluetoothAdapter',
        'closeBluetoothAdapter',
        'getBluetoothAdapterState',
        'startBluetoothDevicesDiscovery',
        'stopBluetoothDevicesDiscovery',
        'getBluetoothDevices',
        'createBLEConnection',
        'closeBLEConnection',
        'getBLEDeviceServices',
        'getBLEDeviceCharacteristics',
        'readBLECharacteristicValue',
        'writeBLECharacteristicValue',
        'notifyBLECharacteristicValueChange',
        'getBLEDeviceRSSI',
      ])
      if (!allowed.has(method)) throw new Error(`不支持蓝牙操作：${method}`)
      return invokeNative(method as NativeApiName, (params.params ?? {}) as never)
    }
    case 'log': {
      const level = ['debug', 'info', 'warn', 'error'].includes(String(params.level))
        ? String(params.level)
        : 'info'
      ctx.onLog(level, String(params.message ?? '').slice(0, 2000), params.data)
      return true
    }
    default:
      throw new Error(`未知能力：${request.method}`)
  }
}

/* ------------------------------------------------------------------ *
 * 自检：离屏运行应用，收集运行时错误
 * ------------------------------------------------------------------ */

export interface RuntimeIssue {
  level: 'error' | 'warn'
  message: string
}

/**
 * 在离屏 iframe 里加载应用 1.8 秒，收集脚本错误。
 * 自检不做真实存储 / 模型 / 网络调用，避免副作用。
 */
export function runSandboxProbe(html: string): Promise<RuntimeIssue[]> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve([])
      return
    }
    const issues: RuntimeIssue[] = []
    // 自检用内存存储：应用启动时读 / 写数据不应因为「自检模式」而报错，
    // 否则会把正常的启动逻辑误判成运行时错误。
    const memory = new Map<string, unknown>()
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-scripts allow-forms')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;left:-9999px;top:0;width:360px;height:640px;opacity:0;pointer-events:none;'
    frame.srcdoc = injectSandboxSdk(html)

    let finished = false
    const cleanup = () => {
      if (finished) return
      finished = true
      window.removeEventListener('message', onMessage)
      frame.remove()
      resolve(issues)
    }

    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return
      // 与运行页一致：只接受 srcdoc 沙箱的不透明源（"null" 或空串）
      if (event.origin !== 'null' && event.origin !== '') return
      const data = event.data
      if (!isSandboxRequest(data)) return
      const params = data.params ?? {}
      // 只收日志；其它能力一律给出自检态的错误，防止探针产生副作用
      if (data.method === 'log') {
        const level = params.level === 'error' ? 'error' : params.level === 'warn' ? 'warn' : 'info'
        if (level !== 'info') {
          issues.push({ level, message: String(params.message ?? '').slice(0, 500) })
        }
        frame.contentWindow?.postMessage(
          { __aiPortal: 1, reply: true, id: data.id, ok: true, result: true },
          '*',
        )
        return
      }

      // 设备桥在自检环境里不存在：返回 false，让应用的「不可用」分支正常渲染
      if (data.method === 'device.available') {
        frame.contentWindow?.postMessage(
          { __aiPortal: 1, reply: true, id: data.id, ok: true, result: false },
          '*',
        )
        return
      }

      // 自检时只读的触发器 / 设置查询给空结果，避免把正常的启动逻辑误判成错误
      if (data.method === 'triggers.list' || data.method === 'settings.get') {
        const result =
          data.method === 'triggers.list'
            ? []
            : { notifications: { enabled: false, banner: false, vibrate: false } }
        frame.contentWindow?.postMessage(
          { __aiPortal: 1, reply: true, id: data.id, ok: true, result },
          '*',
        )
        return
      }

      if (data.method.startsWith('storage.')) {        let result: unknown = true
        const key = String(params.key ?? '')
        if (data.method === 'storage.get') {
          result = memory.has(key) ? memory.get(key) : (params.fallback ?? null)
        } else if (data.method === 'storage.set') {
          memory.set(key, params.value)
        } else if (data.method === 'storage.remove') {
          memory.delete(key)
        } else if (data.method === 'storage.keys') {
          result = Array.from(memory.keys())
        }
        frame.contentWindow?.postMessage(
          { __aiPortal: 1, reply: true, id: data.id, ok: true, result },
          '*',
        )
        return
      }

      frame.contentWindow?.postMessage(
        {
          __aiPortal: 1,
          reply: true,
          id: data.id,
          ok: false,
          error: '自检模式不执行该能力',
        },
        '*',
      )
    }

    window.addEventListener('message', onMessage)
    document.body.appendChild(frame)
    window.setTimeout(cleanup, 1800)
  })
}
