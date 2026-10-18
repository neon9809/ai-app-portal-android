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
  temperature: number
}

export const EMPTY_LLM_SETTINGS: LlmSettings = {
  baseUrl: '',
  apiKey: '',
  model: '',
  appModel: '',
  temperature: 0.7,
}

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

/** 字符串或 OpenAI 兼容的多段内容（文本 + 图片） */
export type ChatContent = string | ChatContentPart[]

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: ChatContent
}

export interface ChatResult {
  content: string
  inputTokens: number
  outputTokens: number
  model: string
}

const SETTINGS_KEY = 'llm'

export async function readLlmSettings(): Promise<LlmSettings> {
  return (await settingGet<LlmSettings>(SETTINGS_KEY)) ?? { ...EMPTY_LLM_SETTINGS }
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

function chatEndpoint(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl)
  if (base.endsWith('/chat/completions')) return base
  return `${base}/chat/completions`
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
  },
): Promise<ChatResult> {
  const settings = options?.settings ?? (await readLlmSettings())
  if (!isLlmConfigured(settings)) {
    throw new LlmError('config', '还没有配置模型，请先到设置里填写服务地址、API Key 和模型名')
  }
  const model = options?.model ?? settings.model
  if (!model.trim()) throw new LlmError('config', '还没有填写模型名')

  const url = chatEndpoint(settings.baseUrl)
  const timeoutMs = options?.timeoutMs ?? 240_000

  let response: { status: number; data: unknown }
  try {
    response = await postJson(
      url,
      settings.apiKey.trim(),
      {
        model: model.trim(),
        messages,
        temperature: settings.temperature,
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

  const content = parsed?.choices?.[0]?.message?.content ?? parsed?.choices?.[0]?.text
  if (typeof content !== 'string' || !content.trim()) {
    throw new LlmError('bad-response', '模型没有返回内容，请检查模型是否支持对话接口')
  }

  const inputTokens =
    parsed.usage?.prompt_tokens ??
    messages.reduce((sum, message) => sum + estimateContentTokens(message.content), 0)
  const outputTokens = parsed.usage?.completion_tokens ?? estimateTokens(content)

  return { content, inputTokens, outputTokens, model: model.trim() }
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
  },
): Promise<ChatResult> {
  const settings = options?.settings ?? (await readLlmSettings())
  if (!isLlmConfigured(settings)) {
    throw new LlmError('config', '还没有配置模型，请先到设置里填写服务地址、API Key 和模型名')
  }
  const model = options?.model ?? settings.model
  if (!model.trim()) throw new LlmError('config', '还没有填写模型名')

  const url = chatEndpoint(settings.baseUrl)
  const timeoutMs = options?.timeoutMs ?? 240_000
  if (options?.signal?.aborted) {
    throw Object.assign(new Error('已取消'), { name: 'AbortError' })
  }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
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
      body: JSON.stringify({
        model: model.trim(),
        messages,
        temperature: settings.temperature,
        stream: true,
      }),
      signal: controller.signal,
    })
  } catch (error) {
    window.clearTimeout(timer)
    options?.signal?.removeEventListener('abort', onAbort)
    if (options?.signal?.aborted) throw error
    throw new LlmError(
      'network',
      `流式连接失败：${(error as Error)?.message ?? '网络错误'}`,
    )
  }

  if (!response.ok) {
    window.clearTimeout(timer)
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
    window.clearTimeout(timer)
    options?.signal?.removeEventListener('abort', onAbort)
    throw new LlmError('bad-response', '这个环境拿不到流式响应')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let usageIn = 0
  let usageOut = 0

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
        }
        try {
          parsed = JSON.parse(chunk)
        } catch {
          continue
        }
        const delta = parsed.choices?.[0]?.delta
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
    window.clearTimeout(timer)
    options?.signal?.removeEventListener('abort', onAbort)
  }

  if (!content.trim()) {
    throw new LlmError('bad-response', '模型没有返回内容，请检查模型是否支持对话接口')
  }

  return {
    content,
    inputTokens:
      usageIn ||
      messages.reduce((sum, message) => sum + estimateContentTokens(message.content), 0),
    outputTokens: usageOut || estimateTokens(content),
    model: model.trim(),
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
