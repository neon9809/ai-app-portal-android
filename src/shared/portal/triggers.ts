/**
 * 触发器：时间 / 位置条件，到点或进出范围时提醒用户，并把事件投递给应用。
 *
 * 能力边界（如实写在界面上）：
 *  - 门户是 H5 应用，没有系统级后台唤醒。时间触发器只在门户打开时检查；
 *    错过的一次性 / 每日触发会在下次打开时补发。
 *  - 位置触发器只在应用运行、且用户已授权定位时检查。
 *  - 提醒是门户内的横幅（可选震动），不是系统通知栏推送。
 */

import {
  addLog,
  getAppSettings,
  listTriggers,
  pushTriggerEvent,
  saveTrigger,
} from './db'
import type { AppTrigger, TriggerAction, TriggerEvent } from './types'
import { resolveLocale, translate, type Locale } from '@/shared/i18n'
import { now, uid } from './utils'

export const MAX_TRIGGER_NAME = 40
export const MAX_NOTIFY_TITLE = 60
export const MAX_NOTIFY_BODY = 200

/** 每日触发允许补发的窗口（分钟）：超过就不再补，避免下午打开时补发早上的提醒 */
const DAILY_GRACE_MINUTES = 30

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function clampText(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export interface TriggerInput {
  name?: unknown
  kind?: unknown
  schedule?: unknown
  location?: unknown
  action?: unknown
}

/** 把应用传来的触发器定义规范化；参数不合法时抛出可读错误 */
export function normalizeTrigger(
  app: { id: string; name: string },
  input: TriggerInput,
): AppTrigger {
  const name = clampText(input.name, MAX_TRIGGER_NAME)
  if (!name) throw new Error('触发器需要一个名字')

  const scheduleRaw = asRecord(input.schedule)
  const locationRaw = asRecord(input.location)
  const hasSchedule = Object.keys(scheduleRaw).length > 0
  const hasLocation = Object.keys(locationRaw).length > 0
  const kind = input.kind === 'location' || input.kind === 'time'
    ? input.kind
    : hasLocation
      ? 'location'
      : hasSchedule
        ? 'time'
        : null
  if (!kind) throw new Error('触发器需要时间或位置条件')

  const actionRaw = asRecord(input.action)
  const notifyRaw = asRecord(actionRaw.notify)
  const notifyTitle = clampText(notifyRaw.title, MAX_NOTIFY_TITLE)
  const action: TriggerAction = {
    notify: notifyTitle
      ? { title: notifyTitle, body: clampText(notifyRaw.body, MAX_NOTIFY_BODY) || undefined }
      : undefined,
    vibrate: actionRaw.vibrate === true,
    run: actionRaw.run === true,
  }
  if (!action.notify && !action.run) {
    throw new Error('触发器至少要有提醒文案或交给应用处理')
  }

  const trigger: AppTrigger = {
    id: uid('tr_'),
    appId: app.id,
    appName: app.name,
    name,
    kind,
    enabled: true,
    action,
    createdAt: now(),
    firedCount: 0,
  }

  if (kind === 'time') {
    const type = scheduleRaw.type
    if (type === 'once') {
      if (!isFiniteNumber(scheduleRaw.at)) throw new Error('一次性触发器需要时间点')
      if (scheduleRaw.at < now() - 60_000) throw new Error('一次性触发器的时间已经过去了')
      trigger.schedule = { type: 'once', at: scheduleRaw.at }
    } else if (type === 'daily') {
      const hour = Number(scheduleRaw.hour)
      const minute = Number(scheduleRaw.minute)
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('小时需要是 0 到 23')
      if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
        throw new Error('分钟需要是 0 到 59')
      }
      trigger.schedule = { type: 'daily', hour, minute }
    } else if (type === 'interval') {
      const everyMinutes = Number(scheduleRaw.everyMinutes)
      if (!Number.isInteger(everyMinutes) || everyMinutes < 1 || everyMinutes > 1440) {
        throw new Error('间隔需要是 1 到 1440 分钟')
      }
      trigger.schedule = { type: 'interval', everyMinutes }
    } else {
      throw new Error('不支持的时间条件')
    }
  } else {
    const latitude = Number(locationRaw.latitude)
    const longitude = Number(locationRaw.longitude)
    const radiusMeters = Number(locationRaw.radiusMeters)
    const mode = locationRaw.mode === 'leave' ? 'leave' : 'enter'
    if (!isFiniteNumber(latitude) || latitude < -90 || latitude > 90) {
      throw new Error('纬度不合法')
    }
    if (!isFiniteNumber(longitude) || longitude < -180 || longitude > 180) {
      throw new Error('经度不合法')
    }
    if (!isFiniteNumber(radiusMeters) || radiusMeters < 50 || radiusMeters > 50_000) {
      throw new Error('范围需要是 50 到 50000 米')
    }
    trigger.location = { latitude, longitude, radiusMeters, mode }
  }

  return trigger
}

/** 给设置页看的中文条件描述 */
export function describeTrigger(trigger: AppTrigger, locale: Locale = resolveLocale()): string {
  const tr = (key: string, params?: Record<string, string | number>) =>
    translate(locale, key, params)
  if (trigger.kind === 'location' && trigger.location) {
    const { radiusMeters, mode, latitude, longitude } = trigger.location
    const params = { lat: latitude.toFixed(4), lng: longitude.toFixed(4), radius: radiusMeters }
    return mode === 'leave' ? tr('trigger.leave', params) : tr('trigger.enter', params)
  }
  const schedule = trigger.schedule
  if (!schedule) return tr('trigger.unset')
  if (schedule.type === 'once') return tr('trigger.once', { time: formatDateTime(schedule.at) })
  if (schedule.type === 'daily') {
    const time = `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`
    return tr('trigger.daily', { time })
  }
  return tr('trigger.interval', { minutes: schedule.everyMinutes })
}

export function formatDateTime(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

function dayKey(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

/** 时间条件是否到点（一次性 / 每日 / 间隔） */
export function isTimeDue(trigger: AppTrigger, at: number): boolean {
  const schedule = trigger.schedule
  if (!trigger.enabled || trigger.kind !== 'time' || !schedule) return false

  if (schedule.type === 'once') {
    return at >= schedule.at
  }
  if (schedule.type === 'daily') {
    const date = new Date(at)
    const current = date.getHours() * 60 + date.getMinutes()
    const target = schedule.hour * 60 + schedule.minute
    const diff = current - target
    if (diff < 0 || diff > DAILY_GRACE_MINUTES) return false
    return trigger.state?.lastDay !== dayKey(at)
  }
  const base = trigger.lastFiredAt ?? trigger.createdAt
  return at - base >= schedule.everyMinutes * 60_000
}

/** 两点之间的距离（米），Haversine 公式 */
export function distanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const radius = 6_371_000
  const toRad = (value: number) => (value * Math.PI) / 180
  const dLat = toRad(to.latitude - from.latitude)
  const dLon = toRad(to.longitude - from.longitude)
  const lat1 = toRad(from.latitude)
  const lat2 = toRad(to.latitude)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)))
}

async function fire(trigger: AppTrigger, at: number): Promise<TriggerEvent> {
  const event: TriggerEvent = {
    triggerId: trigger.id,
    appId: trigger.appId,
    appName: trigger.appName,
    name: trigger.name,
    at,
    action: trigger.action,
  }
  const once = trigger.schedule?.type === 'once'
  await saveTrigger({
    ...trigger,
    enabled: once ? false : trigger.enabled,
    lastFiredAt: at,
    firedCount: trigger.firedCount + 1,
    state: { ...trigger.state, lastDay: dayKey(at) },
  })
  await pushTriggerEvent(event)
  await addLog({
    id: uid('l_'),
    appId: trigger.appId,
    traceId: uid('t_'),
    level: 'info',
    message: `触发器「${trigger.name}」已触发`,
    at,
  })
  return event
}

/** 检查所有到期的时间触发器；返回本次触发的事件 */
export async function runDueTimeTriggers(at = now()): Promise<TriggerEvent[]> {
  const all = await listTriggers()
  const events: TriggerEvent[] = []
  for (const trigger of all) {
    if (!isTimeDue(trigger, at)) continue
    try {
      events.push(await fire(trigger, at))
    } catch {
      // 单个触发器失败不影响其它触发器
    }
  }
  return events
}

/**
 * 用当前位置检查某个应用的位置触发器。
 * 只更新状态并触发事件；调用方负责先拿到定位授权。
 */
export async function checkLocationTriggers(
  appId: string,
  position: { latitude: number; longitude: number },
  at = now(),
): Promise<TriggerEvent[]> {
  const all = await listTriggers(appId)
  const events: TriggerEvent[] = []
  for (const trigger of all) {
    if (!trigger.enabled || trigger.kind !== 'location' || !trigger.location) continue
    const distance = distanceMeters(position, trigger.location)
    const inside = distance <= trigger.location.radiusMeters
    const wasInside = trigger.state?.inside
    const matched =
      trigger.location.mode === 'leave'
        ? wasInside === true && !inside
        : inside && wasInside !== true

    if (matched) {
      events.push(await fire(trigger, at))
      continue
    }
    if (wasInside !== inside) {
      await saveTrigger({ ...trigger, state: { ...trigger.state, inside } })
    }
  }
  return events
}

/** 通知是否被用户在应用设置里关掉 */
export async function notificationsEnabled(appId: string): Promise<boolean> {
  const settings = await getAppSettings(appId)
  return settings.notifications.enabled
}
