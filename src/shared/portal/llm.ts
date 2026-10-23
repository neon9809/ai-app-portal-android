/**
 * LLM 客户端：BYO key（OpenAI 兼容接口）。
 *
 * 真机走壳的 `request`（无 CORS、仅 https）；浏览器预览回落 fetch
 * （受目标站点的 CORS 限制，失败时如实提示去真机验证）。
 * 密钥只存本机 IndexedDB，不上传、不打进日志。
 */

import { invokeNative, getBridgeMode, initBridge } from '@/shared/bridge'
import { settingGet, settingSet } from './db'

export interface LlmSettings {
  baseUrl: string
  apiKey: string
  model: string
  /** 应用内 AI 调用使用的模型；留空则与生成模型一致 */
  appModel: string
  /** 生成温度；null = 不传，用服务端默认 */
  temperature: number | null
  /** 接口风格：chat = OpenAI Chat Completions；responses = OpenAI Responses API */
  apiStyle: 'chat' | 'responses'
  /** 模型是否有视觉能力：开启后创作对话才能附图片 */
  vision: boolean
  /** 模型最大输入 tokens；超出时从最早的修改记录开始省略；0 = 不限制 */
  contextTokens: number
}

export const EMPTY_LLM_SETTINGS: LlmSettings = {
  baseUrl: '',
  apiKey: '',
  model: '',
  appModel: '',
  temperature: null,
  apiStyle: 'chat',
  vision: false,
  contextTokens: 0,
}

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

/** 字符串或 OpenAI 兼容的多段内容（文本 + 图片） */
export type ChatContent = string | ChatContentPart[]

/** 模型发起的一次工具调用（OpenAI 两种协议归一后的形状） */
export interface ToolCall {
  id: string
  name: string
  /** JSON 字符串参数 */
  arguments: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: ChatContent
  /** assistant 消息附带的工具调用请求 */
  toolCalls?: ToolCall[]
  /** tool 角色消息对应的调用 id */
  toolCallId?: string
}

export interface ChatResult {
  content: string
  inputTokens: number
  outputTokens: number
  model: string
  /** 模型请求的工具调用（为空表示本次就是最终回答） */
  toolCalls?: ToolCall[]
}

const SETTINGS_KEY = 'llm'

export async function readLlmSettings(): Promise<LlmSettings> {
  const stored = await settingGet<Partial<LlmSettings>>(SETTINGS_KEY)
  // 旧配置没有新字段：与默认值合并，避免 undefined 破坏请求构造
  return { ...EMPTY_LLM_SETTINGS, ...(stored ?? {}) }
}

export async function writeLlmSettings(settings: LlmSettings): Promise<void> {
  await settingSet(SETTINGS_KEY, settings)
}

export function isLlmConfigured(settings: LlmSettings): boolean {
  return Boolean(settings.baseUrl.trim() && settings.apiKey.trim() && settings.model.trim())
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

/** 按接口风格拼端点：chat → /chat/completions；responses → /responses */
function apiEndpoint(baseUrl: string, style: LlmSettings['apiStyle']): string {
  let base = normalizeBaseUrl(baseUrl)
  if (base.endsWith('/chat/completions')) base = base.slice(0, -'/chat/completions'.length)
  if (base.endsWith('/responses')) base = base.slice(0, -'/responses'.length)
  return style === 'responses' ? `${base}/responses` : `${base}/chat/completions`
}

function buildResponsesPayload(
  messages: ChatMessage[],
  model: string,
  temperature: number | null,
  stream: boolean,
  tools?: unknown[],
): Record<string, unknown> {
  const instructions = messages
    .filter((message) => message.role === 'system')
    .map((message) => (typeof message.content === 'string' ? message.content : message.content.map((part) => part.type === 'text' ? part.text : '').join('\n')))
    .join('\n\n')
  const input: Array<Record<string, unknown>> = messages
    .filter((message) => message.role !== 'system')
    .flatMap((message) => {
      // assistant 的工具调用请求：function_call 输出项
      if (message.toolCalls && message.toolCalls.length > 0) {
        return message.toolCalls.map(
          (call) =>
            ({
              type: 'function_call',
              call_id: call.id,
              name: call.name,
              arguments: call.arguments,
            }) as Record<string, unknown>,
        )
      }
      // 工具执行结果：function_call_output 输入项
      if (message.role === 'tool') {
        return [
          {
            type: 'function_call_output',
            call_id: message.toolCallId ?? '',
            output: typeof message.content === 'string' ? message.content : '',
          },
        ]
      }
      return [
        {
          role: message.role,
          content:
            typeof message.content === 'string'
              ? [{ type: 'input_text' as const, text: message.content }]
              : message.content.map((part) =>
                  part.type === 'image_url'
                    ? { type: 'input_image' as const, image_url: part.image_url.url }
                    : { type: 'input_text' as const, text: part.text },
                ),
        },
      ]
    })
  const payload: Record<string, unknown> = { model, input }
  if (typeof temperature === 'number') payload.temperature = temperature
  if (instructions) payload.instructions = instructions
  if (stream) payload.stream = true
  if (tools && tools.length > 0) payload.tools = tools
  return payload
}

/** 粗略 token 估算（接口没返回 usage 时兜底）：中文约 1 字 1 token，英文约 4 字符 1 token */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[一-鿿]/g) ?? []).length
  return Math.ceil(cjk + (text.length - cjk) / 4)
}

/** 多段内容估算：文本按字数，图片按固定 1000 tokens */
export function estimateContentTokens(content: ChatContent): number {
  if (typeof content === 'string') return estimateTokens(content)
  return content.reduce((sum, part) => {
    if (part.type === 'image_url') return sum + 1000
    return sum + estimateTokens(part.text)
  }, 0)
}

export class LlmError extends Error {
  readonly kind: 'config' | 'auth' | 'network' | 'server' | 'timeout' | 'bad-response'

  constructor(kind: LlmError['kind'], message: string) {
    super(message)
    this.name = 'LlmError'
    this.kind = kind
  }
}

interface RawChatResponse {
  choices?: Array<{ message?: { content?: string }; text?: string }>
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  error?: { message?: string; type?: string }
}

async function postJson(
  url: string,
  apiKey: string,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ status: number; data: unknown }> {
  if (signal?.aborted) {
    throw Object.assign(new Error('已取消'), { name: 'AbortError' })
  }
  await initBridge()
  const mode = getBridgeMode()

  if (mode === 'native') {
    const result = await invokeNative('request', {
      url,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      data: body,
      timeout: timeoutMs,
      dataType: 'json',
    })
    return { status: result.statusCode, data: result.data }
  }

  // 浏览器预览：没有壳，直接 fetch。可能被目标站点 CORS 拦截。
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await response.text()
    let data: unknown = text
    try {
      data = JSON.parse(text)
    } catch {
      // 保留原文，交给上层判断
    }
    return { status: response.status, data }
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

function explainStatus(status: number, payload: unknown): LlmError {
  const raw = payload as RawChatResponse | string | undefined
  const detail =
    typeof raw === 'string'
      ? raw.slice(0, 200)
      : raw?.error?.message ?? JSON.stringify(raw).slice(0, 200)

  if (status === 401 || status === 403) {
    return new LlmError('auth', '密钥无效或没有权限，请到设置里检查 API Key')
  }
  if (status === 404) {
    return new LlmError('config', '接口地址或模型名不对，请检查设置里的服务地址与模型')
  }
  if (status === 429) {
    return new LlmError('server', '请求太频繁或额度用完了，稍后再试')
  }
  if (status >= 500) {
    return new LlmError('server', `模型服务暂时不可用（${status}），稍后再试`)
  }
  return new LlmError('server', `模型服务返回 ${status}：${detail || '未知错误'}`)
}

export async function chat(
  messages: ChatMessage[],
  options?: {
    settings?: LlmSettings
    model?: string
    timeoutMs?: number
    /** 用户取消生成时中断请求（真机壳请求无法中断，浏览器路径可中断） */
    signal?: AbortSignal
    /** 内置 MCP 工具定义（chatToolsParam()） */
    tools?: unknown[]
  },
): Promise<ChatResult> {
  const settings = options?.settings ?? (await readLlmSettings())
  if (!isLlmConfigured(settings)) {
    throw new LlmError('config', '还没有配置模型，请先到设置里填写服务地址、API Key 和模型名')
  }
  const model = options?.model ?? settings.model
  if (!model.trim()) throw new LlmError('config', '还没有填写模型名')

  const style = settings.apiStyle ?? 'chat'
  const url = apiEndpoint(settings.baseUrl, style)
  const timeoutMs = options?.timeoutMs ?? 240_000

  let response: { status: number; data: unknown }
  try {
    response = await postJson(
      url,
      settings.apiKey.trim(),
      style === 'responses'
        ? buildResponsesPayload(messages, model.trim(), settings.temperature, false, options?.tools)
        : {
            model: model.trim(),
            messages,
            ...(typeof settings.temperature === 'number'
              ? { temperature: settings.temperature }
              : {}),
            ...(options?.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
          },
      timeoutMs,
      options?.signal,
    )
  } catch (error) {
    if (error instanceof LlmError) throw error
    const name = (error as { name?: string })?.name
    if (name === 'AbortError') {
      if (options?.signal?.aborted) throw error
      throw new LlmError('timeout', '模型响应超时，请稍后重试或换一个更快的模型')
    }
    const mode = getBridgeMode()
    const extra =
      mode === 'mock'
        ? '（浏览器预览可能被跨域限制，可到真机上再试）'
        : ''
    throw new LlmError('network', `连不上模型服务${extra}：${(error as Error)?.message ?? '网络错误'}`)
  }

  if (response.status < 200 || response.status >= 300) {
    throw explainStatus(response.status, response.data)
  }

  const payload = response.data
  let parsed: RawChatResponse
  if (typeof payload === 'string') {
    try {
      parsed = JSON.parse(payload) as RawChatResponse
    } catch {
      throw new LlmError('bad-response', '模型返回了无法解析的内容，请检查接口地址是否兼容 OpenAI 格式')
    }
  } else {
    parsed = payload as RawChatResponse
  }

  const responsesPayload = parsed as unknown as {
    output_text?: string
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  const content =
    parsed?.choices?.[0]?.message?.content ??
    parsed?.choices?.[0]?.text ??
    (typeof responsesPayload.output_text === 'string' && responsesPayload.output_text
      ? responsesPayload.output_text
      : (responsesPayload.output ?? [])
          .flatMap((item) => item.content ?? [])
          .filter((part) => part.type === 'output_text' && part.text)
          .map((part) => part.text)
          .join(''))
  const toolCalls = extractToolCalls(parsed, style)
  if ((typeof content !== 'string' || !content.trim()) && toolCalls.length === 0) {
    throw new LlmError('bad-response', '模型没有返回内容，请检查模型是否支持对话接口')
  }

  const inputTokens =
    parsed.usage?.prompt_tokens ??
    responsesPayload.usage?.input_tokens ??
    messages.reduce((sum, message) => sum + estimateContentTokens(message.content), 0)
  const outputTokens =
    parsed.usage?.completion_tokens ??
    responsesPayload.usage?.output_tokens ??
    estimateTokens(content)

  return {
    content: typeof content === 'string' ? content : '',
    inputTokens,
    outputTokens,
    model: model.trim(),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  }
}

/** 从两种协议的响应里归一提取工具调用请求 */
function extractToolCalls(payload: unknown, style: 'chat' | 'responses'): ToolCall[] {
  const randomId = () => `call_${Math.random().toString(36).slice(2)}`
  if (style === 'chat') {
    type ChatToolCall = { id?: string; function?: { name?: string; arguments?: string } }
    type ChatPayload = { choices?: Array<{ message?: { tool_calls?: ChatToolCall[] } }> }
    const calls = (payload as ChatPayload)?.choices?.[0]?.message?.tool_calls
    return (calls ?? [])
      .filter((call) => call.function?.name)
      .map((call) => ({
        id: call.id ?? randomId(),
        name: String(call.function?.name),
        arguments: call.function?.arguments ?? '{}',
      }))
  }
  type ResponsesItem = { type?: string; call_id?: string; name?: string; arguments?: string }
  type ResponsesPayload = { output?: ResponsesItem[] }
  const output = (payload as ResponsesPayload)?.output ?? []
  return output
    .filter((item) => item.type === 'function_call' && item.name)
    .map((item) => ({
      id: item.call_id ?? randomId(),
      name: String(item.name),
      arguments: item.arguments ?? '{}',
    }))
}

/**
 * 流式对话：逐段把模型输出交给 onDelta，最后返回完整结果与用量。
 *
 * 走页面的 fetch（SSE）。浏览器预览与真机 WebView 都是这条路，
 * 目标服务必须允许跨域；不允许时抛出错误，调用方回退到非流式的壳请求。
 */
export async function chatStream(
  messages: ChatMessage[],
  onDelta: (delta: string) => void,
  options?: {
    settings?: LlmSettings
    model?: string
    timeoutMs?: number
    /** 推理模型返回的思考内容（reasoning_content / reasoning / thinking） */
    onReasoning?: (delta: string) => void
    /** 用户取消生成时中断流式读取 */
    signal?: AbortSignal
    /** 内置 MCP 工具定义（chatToolsParam() / responsesToolsParam()） */
    tools?: unknown[]
  },
): Promise<ChatResult> {
  const settings = options?.settings ?? (await readLlmSettings())
  if (!isLlmConfigured(settings)) {
    throw new LlmError('config', '还没有配置模型，请先到设置里填写服务地址、API Key 和模型名')
  }
  const model = options?.model ?? settings.model
  if (!model.trim()) throw new LlmError('config', '还没有填写模型名')

  const style = settings.apiStyle ?? 'chat'
  const url = apiEndpoint(settings.baseUrl, style)
  const timeoutMs = options?.timeoutMs ?? 240_000
  if (options?.signal?.aborted) {
    throw Object.assign(new Error('已取消'), { name: 'AbortError' })
  }
  const controller = new AbortController()
  // 空闲超时：不是「总时长 240s」，而是「连续 240s 没有任何输出」才判卡死。
  // 代码量大、模型持续输出几十 KB 时不会中途被掐断；每收到一段数据就续期。
  const idleTimer = { id: window.setTimeout(() => controller.abort(), timeoutMs) }
  const bumpIdle = () => {
    window.clearTimeout(idleTimer.id)
    idleTimer.id = window.setTimeout(() => controller.abort(), timeoutMs)
  }
  const onAbort = () => controller.abort()
  options?.signal?.addEventListener('abort', onAbort, { once: true })

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey.trim()}`,
      },
      body: JSON.stringify(
        style === 'responses'
          ? buildResponsesPayload(messages, model.trim(), settings.temperature, true, options?.tools)
          : {
              model: model.trim(),
              messages,
              ...(typeof settings.temperature === 'number'
                ? { temperature: settings.temperature }
                : {}),
              stream: true,
              ...(options?.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
            },
      ),
      signal: controller.signal,
    })
  } catch (error) {
    window.clearTimeout(idleTimer.id)
    options?.signal?.removeEventListener('abort', onAbort)
    if (options?.signal?.aborted) throw error
    throw new LlmError(
      'network',
      `流式连接失败：${(error as Error)?.message ?? '网络错误'}`,
    )
  }

  if (!response.ok) {
    window.clearTimeout(idleTimer.id)
    options?.signal?.removeEventListener('abort', onAbort)
    const text = await response.text().catch(() => '')
    let payload: unknown = text
    try {
      payload = JSON.parse(text)
    } catch {
      // 保留原文
    }
    throw explainStatus(response.status, payload)
  }
  if (!response.body) {
    window.clearTimeout(idleTimer.id)
    options?.signal?.removeEventListener('abort', onAbort)
    throw new LlmError('bad-response', '这个环境拿不到流式响应')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let usageIn = 0
  let usageOut = 0
  // chat 协议的 tool_calls 是按 index 分片下发的，先聚合再归一
  const toolCallAcc = new Map<number, { id: string; name: string; arguments: string }>()
  let responsesToolCalls: ToolCall[] = []

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line.startsWith('data:')) continue
        const chunk = line.slice(5).trim()
        if (!chunk || chunk === '[DONE]') continue
        let parsed: {
          choices?: Array<{
            delta?: {
              content?: string
              reasoning_content?: string
              reasoning?: string
              thinking?: string
            }
          }>
          usage?: { prompt_tokens?: number; completion_tokens?: number }
          // Responses API 的流事件
          type?: string
          delta?: string
          response?: { usage?: { input_tokens?: number; output_tokens?: number } }
        }
        try {
          parsed = JSON.parse(chunk)
        } catch {
          continue
        }
        bumpIdle()
        if (style === 'responses') {
          // Responses API：response.output_text.delta 出正文，
          // response.reasoning_summary_text.delta 出思考摘要，response.completed 带用量
          if (parsed.type === 'response.output_text.delta' && parsed.delta) {
            content += parsed.delta
            onDelta(parsed.delta)
          } else if (parsed.type === 'response.reasoning_summary_text.delta' && parsed.delta) {
            options?.onReasoning?.(parsed.delta)
          } else if (parsed.type === 'response.completed' && parsed.response?.usage) {
            usageIn = parsed.response.usage.input_tokens ?? usageIn
            usageOut = parsed.response.usage.output_tokens ?? usageOut
          }
          // 工具调用：output_item.done 里的 function_call 项是完整参数，直接收
          const item = (parsed as {
            item?: { type?: string; call_id?: string; name?: string; arguments?: string }
          }).item
          if (parsed.type === 'response.output_item.done' && item?.type === 'function_call' && item.name) {
            responsesToolCalls.push({
              id: item.call_id ?? `call_${Math.random().toString(36).slice(2)}`,
              name: String(item.name),
              arguments: item.arguments ?? '{}',
            })
          }
          continue
        }
        type StreamDelta = {
          content?: string
          reasoning_content?: string
          reasoning?: string
          thinking?: string
          tool_calls?: Array<{
            index?: number
            id?: string
            function?: { name?: string; arguments?: string }
          }>
        }
        const streamDelta = parsed.choices?.[0]?.delta as StreamDelta | undefined
        for (const call of streamDelta?.tool_calls ?? []) {
          const index = call.index ?? 0
          const current = toolCallAcc.get(index) ?? { id: '', name: '', arguments: '' }
          if (call.id) current.id = call.id
          if (call.function?.name) current.name += call.function.name
          if (call.function?.arguments) current.arguments += call.function.arguments
          toolCallAcc.set(index, current)
        }
        const delta = streamDelta
        if (typeof delta?.content === 'string' && delta.content) {
          content += delta.content
          onDelta(delta.content)
        }
        // 推理模型的思考内容：不同服务字段名不同，能识别多少显示多少
        const reasoning =
          delta?.reasoning_content ?? delta?.reasoning ?? delta?.thinking
        if (typeof reasoning === 'string' && reasoning) {
          options?.onReasoning?.(reasoning)
        }
        if (parsed.usage) {
          usageIn = parsed.usage.prompt_tokens ?? usageIn
          usageOut = parsed.usage.completion_tokens ?? usageOut
        }
      }
    }
  } catch (error) {
    const name = (error as { name?: string })?.name
    if (name === 'AbortError') {
      if (options?.signal?.aborted) throw error
      throw new LlmError('timeout', '模型响应超时，请稍后重试或换一个更快的模型')
    }
    throw new LlmError('network', `流式读取中断：${(error as Error)?.message ?? '网络错误'}`)
  } finally {
    window.clearTimeout(idleTimer.id)
    options?.signal?.removeEventListener('abort', onAbort)
  }

  const toolCalls = [...toolCallAcc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, call]) => ({
      id: call.id || `call_${Math.random().toString(36).slice(2)}`,
      name: call.name,
      arguments: call.arguments || '{}',
    }))
    .concat(responsesToolCalls)

  if (!content.trim() && toolCalls.length === 0) {
    throw new LlmError('bad-response', '模型没有返回内容，请检查模型是否支持对话接口')
  }

  return {
    content,
    inputTokens:
      usageIn ||
      messages.reduce((sum, message) => sum + estimateContentTokens(message.content), 0),
    outputTokens: usageOut || estimateTokens(content),
    model: model.trim(),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  }
}

/** 连通性测试：发一条极短的请求 */
export async function testConnection(settings: LlmSettings): Promise<{ ok: true; model: string } | { ok: false; message: string }> {
  try {
    await chat([{ role: 'user', content: '回复两个字：可用' }], {
      settings,
      model: settings.model,
      timeoutMs: 30_000,
    })
    return { ok: true, model: settings.model }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
}
