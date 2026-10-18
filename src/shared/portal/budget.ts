/**
 * 单应用的月度 AI 预算。
 *
 * 默认不限；用户在应用详情里设置一个 token 上限后，本月该应用的
 * `app-call` 用量达到上限时，沙箱会拒绝继续调用模型。
 * 生成器自身的用量不占应用预算。
 */

import { listUsage, settingGet, settingSet } from './db'

const KEY_PREFIX = 'budget:'

export async function getBudget(appId: string): Promise<number | null> {
  const value = await settingGet<number>(`${KEY_PREFIX}${appId}`)
  return typeof value === 'number' && value > 0 ? value : null
}

export async function setBudget(appId: string, limit: number | null): Promise<void> {
  if (limit === null || !Number.isFinite(limit) || limit <= 0) {
    await settingSet(`${KEY_PREFIX}${appId}`, null)
    return
  }
  await settingSet(`${KEY_PREFIX}${appId}`, Math.round(limit))
}

function monthStart(): number {
  const date = new Date()
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime()
}

export async function monthAppTokens(appId: string): Promise<number> {
  const start = monthStart()
  const usage = await listUsage()
  return usage
    .filter((item) => item.appId === appId && item.kind === 'app-call' && item.at >= start)
    .reduce((sum, item) => sum + item.inputTokens + item.outputTokens, 0)
}

/** 超限时抛错；错误信息会原样返回给应用与用户 */
export async function assertBudget(appId: string): Promise<void> {
  const limit = await getBudget(appId)
  if (limit === null) return
  const used = await monthAppTokens(appId)
  if (used >= limit) {
    throw new Error(`本月 AI 用量已达到上限（${used}/${limit} tokens），可在应用详情里调整`)
  }
}
