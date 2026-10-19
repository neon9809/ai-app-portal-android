/**
 * 内置 MCP 工具：生成过程中模型可以调用的本机工具。
 *
 * 走 OpenAI 兼容的 function calling 协议（Chat Completions 与 Responses 都支持），
 * 工具由门户内置、在门户侧执行——不开放任意网络或 shell，能力范围可控。
 * 生成时间线里会记录每次工具调用与结果（见 generator 的 trace）。
 */

import { getBridgeMode, initBridge, invokeNative } from '@/shared/bridge'
import { resolveLocale, translate } from '@/shared/i18n'
import { now } from './utils'
import { settingGet, settingSet } from './db'

/** 壳注入的 MCP 客户端（浏览器预览里没有） */
interface McpBridge {
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
}

function getMcpBridge(): McpBridge | null {
  if (typeof window === 'undefined') return null
  const bridge = (window as unknown as { mcp?: McpBridge }).mcp
  return bridge && typeof bridge.callTool === 'function' ? bridge : null
}

export interface BuiltinTool {
  /** OpenAI function 名称 */
  name: string
  description: string
  /** JSON Schema 参数 */
  parameters: Record<string, unknown>
  /** 在门户侧执行；返回给模型的结果（纯文本） */
  execute: (args: Record<string, unknown>) => Promise<string>
}

async function getWeather(args: Record<string, unknown>): Promise<string> {
  const params: Record<string, unknown> = {}
  for (const key of ['province', 'city', 'area', 'startDate', 'endDate', 'type', 'startHour']) {
    if (args[key] !== undefined && args[key] !== null && args[key] !== '') params[key] = args[key]
  }
  const bridge = getMcpBridge()
  if (!bridge) {
    return '工具不可用：当前环境没有设备桥（浏览器预览），天气查询只在真机上可用。'
  }
  try {
    const result = await bridge.callTool('get_weather', params)
    return JSON.stringify(result).slice(0, 4000)
  } catch (error) {
    return `工具执行失败：${(error as Error).message ?? '未知错误'}`
  }
}

function getTime(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
    now.getHours(),
  )}:${pad(now.getMinutes())}（星期${'日一二三四五六'[now.getDay()]}，本地时间）`
}

export const BUILTIN_TOOLS: BuiltinTool[] = [
  {
    name: 'get_time',
    description: '获取用户手机的当前日期与时间。涉及"今天"、定时提醒、按日期展示等功能时先调用它，不要自己猜。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => getTime(),
  },
  {
    name: 'get_weather',
    description:
      '查询某城市的天气预报（今天与未来几天）。仅在用户的需求明确涉及天气时调用；需要 province 与 city（例如广东、深圳）。',
    parameters: {
      type: 'object',
      properties: {
        province: { type: 'string', description: '省份，如 广东' },
        city: { type: 'string', description: '城市，如 深圳' },
        area: { type: 'string', description: '区县，可选' },
      },
      required: ['province', 'city'],
      additionalProperties: false,
    },
    execute: getWeather,
  },
]

/** 用户停用的工具名（集中配置，见「设置 → MCP 工具」） */
export interface McpConfig {
  disabled: string[]
}

const CONFIG_KEY = 'mcp'

export const EMPTY_MCP_CONFIG: McpConfig = { disabled: [] }

export async function readMcpConfig(): Promise<McpConfig> {
  const stored = await settingGet<Partial<McpConfig>>(CONFIG_KEY)
  const disabled = Array.isArray(stored?.disabled) ? stored!.disabled!.map(String) : []
  return { disabled }
}

export async function writeMcpConfig(config: McpConfig): Promise<void> {
  await settingSet(CONFIG_KEY, config)
}

export function findTool(name: string): BuiltinTool | undefined {
  return BUILTIN_TOOLS.find((tool) => tool.name === name)
}

export function isToolEnabled(config: McpConfig, name: string): boolean {
  return !config.disabled.includes(name)
}

/** OpenAI Chat Completions 格式的 tools 参数（只带启用的工具） */
export function chatToolsParam(config: McpConfig = EMPTY_MCP_CONFIG) {
  return BUILTIN_TOOLS.filter((tool) => isToolEnabled(config, tool.name)).map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

/** OpenAI Responses API 格式的 tools 参数（只带启用的工具） */
export function responsesToolsParam(config: McpConfig = EMPTY_MCP_CONFIG) {
  return BUILTIN_TOOLS.filter((tool) => isToolEnabled(config, tool.name)).map((tool) => ({
    type: 'function' as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }))
}


/* ------------------------------------------------------------------ *
 * 外部 MCP 服务器（Streamable HTTP）
 *
 * 手动配置 URL（可带自定义请求头）。协议走 JSON-RPC：
 * initialize → notifications/initialized → tools/list / tools/call。
 * 真机走壳的 request（无跨域限制）；浏览器预览直接 fetch，受目标站 CORS 限制。
 * 工具名下发时加前缀 `${服务器名}__${工具名}`，避免与内置或其它服务器重名。
 * ------------------------------------------------------------------ */

export interface McpServerConfig {
  id: string
  name: string
  url: string
  /** 额外请求头（如鉴权 token） */
  headers: Array<{ key: string; value: string }>
  enabled: boolean
}

const SERVERS_KEY = 'mcpServers'

export async function readMcpServers(): Promise<McpServerConfig[]> {
  const stored = await settingGet<McpServerConfig[]>(SERVERS_KEY)
  return Array.isArray(stored) ? stored : []
}

export async function writeMcpServers(servers: McpServerConfig[]): Promise<void> {
  await settingSet(SERVERS_KEY, servers)
}

/** 服务器名转成工具名前缀（只留字母数字下划线连字符） */
export function serverSlug(name: string): string {
  return (name.trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'server').slice(0, 24)
}

/** JSON-RPC 一条响应：优先普通 JSON；SSE 文本则取第一条 data 行 */
function parseRpcResult(raw: unknown): { jsonrpc?: string; result?: unknown; error?: { message?: string } } {
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (text.startsWith('{')) {
      try {
        return JSON.parse(text)
      } catch {
        throw new Error('MCP 服务器返回了无法解析的内容')
      }
    }
    for (const line of text.split('\n')) {
      const item = line.trim()
      if (!item.startsWith('data:')) continue
      try {
        return JSON.parse(item.slice(5).trim())
      } catch {
        continue
      }
    }
    throw new Error('MCP 服务器返回了无法解析的内容')
  }
  return (raw ?? {}) as { jsonrpc?: string; result?: unknown; error?: { message?: string } }
}

async function rpcCall(
  server: McpServerConfig,
  body: Record<string, unknown>,
  timeoutMs = 12_000,
): Promise<{ result?: unknown; error?: { message?: string }; sessionId?: string }> {
  const url = server.url.trim()
  if (!/^https?:\/\//i.test(url)) throw new Error('地址必须是 http(s):// 开头')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...Object.fromEntries(server.headers.filter((item) => item.key.trim()).map((item) => [item.key.trim(), item.value])),
  }
  await initBridge()
  if (getBridgeMode() === 'native') {
    const response = await invokeNative('request', {
      url,
      method: 'POST',
      header: headers,
      data: body,
      timeout: timeoutMs,
      dataType: 'text',
      responseType: 'text',
    })
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`MCP 服务器返回 ${response.statusCode}`)
    }
    const sessionId = response.header?.['mcp-session-id'] ?? response.header?.['Mcp-Session-Id']
    const parsed = parseRpcResult(response.data)
    return { result: parsed.result, error: parsed.error, sessionId }
  }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`MCP 服务器返回 ${response.status}`)
    const text = await response.text()
    const sessionId = response.headers.get('mcp-session-id') ?? undefined
    const parsed = parseRpcResult(text)
    return { result: parsed.result, error: parsed.error, sessionId }
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw new Error(translate(resolveLocale(), 'mcp.timeout'))
    // 浏览器预览里 fetch 失败基本只有一种原因：目标服务器不允许跨域（CORS）。
    // 真机走壳的 request 通道，没有这个限制。
    if (getBridgeMode() !== 'native' && error instanceof TypeError) {
      throw new Error(translate(resolveLocale(), 'mcp.corsBlocked'))
    }
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

/** 每个服务器的会话与工具缓存（短 TTL，生成期间复用） */
interface ServerState {
  sessionId?: string
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>
  fetchedAt: number
}

const serverStates = new Map<string, ServerState>()
const STATE_TTL = 5 * 60 * 1000

/** 连接并握手 + 拉工具清单；出错时如实抛出（设置页用来显示原因） */
export async function connectServer(server: McpServerConfig): Promise<ServerState> {
  const init = await rpcCall(server, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'ai-app-portal', version: '1.1.1' },
    },
  })
  if (init.error) throw new Error(init.error.message ?? 'initialize 失败')
  const sessionId = init.sessionId
  const notify = rpcCall(server, { jsonrpc: '2.0', method: 'notifications/initialized' }, 8000).catch(
    () => undefined,
  )
  const list = await rpcCall(server, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    ...(sessionId ? {} : {}),
  })
  await notify
  if (list.error) throw new Error(list.error.message ?? 'tools/list 失败')
  const rawTools = (list.result as { tools?: Array<{ name?: string; description?: string; inputSchema?: Record<string, unknown> }> })
    ?.tools ?? []
  const state: ServerState = {
    sessionId,
    tools: rawTools
      .filter((tool) => tool.name)
      .map((tool) => ({
        name: String(tool.name),
        description: String(tool.description ?? ''),
        inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
      })),
    fetchedAt: now(),
  }
  serverStates.set(server.id, state)
  return state
}

async function ensureState(server: McpServerConfig): Promise<ServerState | null> {
  const cached = serverStates.get(server.id)
  if (cached && now() - cached.fetchedAt < STATE_TTL) return cached
  try {
    return await connectServer(server)
  } catch {
    // 生成期间连接失败：跳过该服务器，不让整个生成挂掉
    return null
  }
}

/** 调用外部服务器的某个工具，返回纯文本结果 */
export async function callServerTool(server: McpServerConfig, toolName: string, args: Record<string, unknown>): Promise<string> {
  const state = (await ensureState(server)) ?? (await connectServer(server))
  const call = await rpcCall(
    server,
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
      ...(state.sessionId ? {} : {}),
    },
    30_000,
  )
  if (call.error) return `工具执行失败：${call.error.message ?? '未知错误'}`
  const result = call.result as {
    content?: Array<{ type?: string; text?: string }>
    isError?: boolean
    structuredContent?: unknown
  }
  const text = (result.content ?? [])
    .filter((part) => part.type === 'text' && part.text)
    .map((part) => part.text)
    .join('\n')
  if (result.isError) return `工具执行失败：${text || '未知错误'}`
  if (text) return text
  if (result.structuredContent !== undefined) return JSON.stringify(result.structuredContent).slice(0, 4000)
  return JSON.stringify(result).slice(0, 4000)
}

export function forgetServerState(serverId: string): void {
  serverStates.delete(serverId)
}

export function cachedServerState(serverId: string): ServerState | null {
  return serverStates.get(serverId) ?? null
}


/* ------------------------------------------------------------------ *
 * 工具聚合：内置 + 外部服务器合并，供生成器一次性取用
 * ------------------------------------------------------------------ */

export interface ToolEntry {
  /** 下发给模型的工具名（外部工具带 `服务器__` 前缀） */
  key: string
  kind: 'builtin' | 'external'
  builtin?: BuiltinTool
  server?: McpServerConfig
  toolName?: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface AggregatedTools {
  /** OpenAI 格式的 tools 参数（按接口风格） */
  chatStyle: unknown[]
  responsesStyle: unknown[]
  entries: ToolEntry[]
  /** 连接失败被跳过的服务器名（设置页提示用） */
  unreachable: string[]
}

export async function aggregateTools(builtinConfig: McpConfig, servers: McpServerConfig[]): Promise<AggregatedTools> {
  const entries: ToolEntry[] = []
  const unreachable: string[] = []

  for (const tool of BUILTIN_TOOLS) {
    if (!isToolEnabled(builtinConfig, tool.name)) continue
    entries.push({
      key: tool.name,
      kind: 'builtin',
      builtin: tool,
      description: tool.description,
      inputSchema: tool.parameters,
    })
  }

  for (const server of servers) {
    if (!server.enabled) continue
    const state = await ensureState(server)
    if (!state) {
      unreachable.push(server.name)
      continue
    }
    for (const tool of state.tools) {
      entries.push({
        key: `${serverSlug(server.name)}__${tool.name}`,
        kind: 'external',
        server,
        toolName: tool.name,
        description: tool.description || `${server.name} 的 ${tool.name}`,
        inputSchema: tool.inputSchema,
      })
    }
  }

  return {
    chatStyle: entries.map((entry) => ({
      type: 'function',
      function: {
        name: entry.key,
        description: entry.description,
        parameters: entry.inputSchema,
      },
    })),
    responsesStyle: entries.map((entry) => ({
      type: 'function',
      name: entry.key,
      description: entry.description,
      parameters: entry.inputSchema,
    })),
    entries,
    unreachable,
  }
}

export function findEntry(aggregated: AggregatedTools, key: string): ToolEntry | undefined {
  return aggregated.entries.find((entry) => entry.key === key)
}

export async function executeEntry(entry: ToolEntry, args: Record<string, unknown>): Promise<string> {
  if (entry.kind === 'builtin' && entry.builtin) return entry.builtin.execute(args)
  if (entry.kind === 'external' && entry.server && entry.toolName) {
    return callServerTool(entry.server, entry.toolName, args)
  }
  return '工具不可用'
}
