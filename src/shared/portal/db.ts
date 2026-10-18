/**
 * 本机存储层：IndexedDB。
 *
 * 为什么不用 localStorage：壳的 WebView 清理策略可能把它当缓存清掉；
 * 应用包、应用数据、用量与日志都是用户资产，必须落在更可靠的 IndexedDB 里。
 * 日志与数据都只在本机，不上传。
 */

import type {
  AppTrigger,
  AppUserSettings,
  AuditRecord,
  CapabilityGrant,
  LogRecord,
  PortalApp,
  Snapshot,
  TriggerEvent,
  UsageRecord,
} from './types'

// 数据库名沿用早期内部代号：改名会让已安装用户的数据变成一座空库。
// 开源版本继续读取同名库，保证升级不丢数据。
const DB_NAME = 'zaowu-portal'
const DB_VERSION = 2

export const STORE = {
  apps: 'apps',
  kv: 'kv',
  usage: 'usage',
  logs: 'logs',
  audit: 'audit',
  settings: 'settings',
  grants: 'grants',
  snapshots: 'snapshots',
  triggers: 'triggers',
} as const

let dbPromise: Promise<IDBDatabase> | null = null

/** 单个应用的本地存储上限（KV 总量） */
export const APP_KV_LIMIT_BYTES = 20 * 1024 * 1024
/** 每个应用每分钟最多写入的日志条数 */
const LOG_RATE_PER_MINUTE = 120
/** 审计日志保留条数 */
const AUDIT_KEEP = 1000

/** 每个应用每个 key 的字节数缓存，用来做配额判断，避免每次全量扫描 */
const kvSizes = new Map<string, Map<string, number>>()
const logBuckets = new Map<string, { start: number; count: number }>()

function measure(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length
  } catch {
    return 0
  }
}

async function loadKvSizes(appId: string): Promise<Map<string, number>> {
  const cached = kvSizes.get(appId)
  if (cached) return cached
  const rows = await idbGetAllByIndex<{ key: string; value: unknown }>(STORE.kv, 'appId', appId)
  const sizes = new Map<string, number>()
  for (const row of rows) sizes.set(row.key, measure(row.value))
  kvSizes.set(appId, sizes)
  return sizes
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持本地数据库，无法保存应用'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE.apps)) {
        db.createObjectStore(STORE.apps, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE.kv)) {
        const store = db.createObjectStore(STORE.kv, { keyPath: ['appId', 'key'] })
        store.createIndex('appId', 'appId', { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE.usage)) {
        const store = db.createObjectStore(STORE.usage, { keyPath: 'id' })
        store.createIndex('appId', 'appId', { unique: false })
        store.createIndex('at', 'at', { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE.logs)) {
        const store = db.createObjectStore(STORE.logs, { keyPath: 'id' })
        store.createIndex('appId', 'appId', { unique: false })
        store.createIndex('at', 'at', { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE.audit)) {
        const store = db.createObjectStore(STORE.audit, { keyPath: 'id' })
        store.createIndex('at', 'at', { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE.settings)) {
        db.createObjectStore(STORE.settings, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(STORE.grants)) {
        const store = db.createObjectStore(STORE.grants, { keyPath: ['appId', 'capability'] })
        store.createIndex('appId', 'appId', { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE.snapshots)) {
        const store = db.createObjectStore(STORE.snapshots, { keyPath: 'id' })
        store.createIndex('at', 'at', { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE.triggers)) {
        const store = db.createObjectStore(STORE.triggers, { keyPath: 'id' })
        store.createIndex('appId', 'appId', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('本地数据库打开失败'))
  })
  return dbPromise
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('本地数据库操作失败'))
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('本地数据库事务失败'))
    tx.onabort = () => reject(tx.error ?? new Error('本地数据库事务被中止'))
  })
}

export async function idbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb()
  const tx = db.transaction(store, 'readonly')
  return (await promisify(tx.objectStore(store).get(key))) as T | undefined
}

export async function idbGetAll<T>(store: string): Promise<T[]> {
  const db = await openDb()
  const tx = db.transaction(store, 'readonly')
  return (await promisify(tx.objectStore(store).getAll())) as T[]
}

export async function idbPut<T>(store: string, value: T): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(store, 'readwrite')
  tx.objectStore(store).put(value as unknown as Record<string, unknown>)
  await txDone(tx)
}

export async function idbDelete(store: string, key: IDBValidKey): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(store, 'readwrite')
  tx.objectStore(store).delete(key)
  await txDone(tx)
}

export async function idbCountByIndex(store: string, index: string, value: IDBValidKey): Promise<number> {
  const db = await openDb()
  const tx = db.transaction(store, 'readonly')
  return promisify(tx.objectStore(store).index(index).count(value))
}

export async function idbGetAllByIndex<T>(
  store: string,
  index: string,
  value: IDBValidKey,
): Promise<T[]> {
  const db = await openDb()
  const tx = db.transaction(store, 'readonly')
  return (await promisify(tx.objectStore(store).index(index).getAll(value))) as T[]
}

/* ------------------------------------------------------------------ *
 * 应用
 * ------------------------------------------------------------------ */

export async function listApps(): Promise<PortalApp[]> {
  const apps = await idbGetAll<PortalApp>(STORE.apps)
  return apps.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
}

export async function getApp(id: string): Promise<PortalApp | undefined> {
  return idbGet<PortalApp>(STORE.apps, id)
}

export async function saveApp(app: PortalApp): Promise<void> {
  await idbPut(STORE.apps, app)
}

export async function deleteApp(id: string): Promise<void> {
  kvSizes.delete(id)
  logBuckets.delete(id)
  const db = await openDb()
  const tx = db.transaction(
    [STORE.apps, STORE.kv, STORE.logs, STORE.grants, STORE.triggers, STORE.settings],
    'readwrite',
  )
  tx.objectStore(STORE.apps).delete(id)
  tx.objectStore(STORE.kv).index('appId').openKeyCursor(IDBKeyRange.only(id)).onsuccess = (event) => {
    const cursor = (event.target as IDBRequest<IDBCursor | null>).result
    if (!cursor) return
    tx.objectStore(STORE.kv).delete(cursor.primaryKey)
    cursor.continue()
  }
  tx.objectStore(STORE.logs).index('appId').openKeyCursor(IDBKeyRange.only(id)).onsuccess = (event) => {
    const cursor = (event.target as IDBRequest<IDBCursor | null>).result
    if (!cursor) return
    tx.objectStore(STORE.logs).delete(cursor.primaryKey)
    cursor.continue()
  }
  tx.objectStore(STORE.grants).index('appId').openKeyCursor(IDBKeyRange.only(id)).onsuccess = (event) => {
    const cursor = (event.target as IDBRequest<IDBCursor | null>).result
    if (!cursor) return
    tx.objectStore(STORE.grants).delete(cursor.primaryKey)
    cursor.continue()
  }
  tx.objectStore(STORE.triggers).index('appId').openKeyCursor(IDBKeyRange.only(id)).onsuccess = (event) => {
    const cursor = (event.target as IDBRequest<IDBCursor | null>).result
    if (!cursor) return
    tx.objectStore(STORE.triggers).delete(cursor.primaryKey)
    cursor.continue()
  }
  tx.objectStore(STORE.settings).delete(`app-settings:${id}`)
  tx.objectStore(STORE.settings).delete(`trigger-inbox:${id}`)
  await txDone(tx)
}

/* ------------------------------------------------------------------ *
 * 应用数据（per-app KV）
 * ------------------------------------------------------------------ */

export async function kvGet(appId: string, key: string): Promise<unknown> {
  const row = await idbGet<{ appId: string; key: string; value: unknown }>(STORE.kv, [appId, key])
  return row?.value
}

/**
 * 写入应用数据。传 limit 时按应用总量限流（沙箱调用走这个分支）；
 * 备份恢复不传 limit，避免自己的数据被自己的配额挡住。
 */
export async function kvSet(
  appId: string,
  key: string,
  value: unknown,
  limit?: number,
): Promise<void> {
  const size = measure(value)
  if (limit && limit > 0) {
    const sizes = await loadKvSizes(appId)
    let total = 0
    for (const [itemKey, itemSize] of sizes) {
      total += itemKey === key ? 0 : itemSize
    }
    if (total + size > limit) {
      throw new Error(`应用存储已满（上限 ${Math.round(limit / 1024 / 1024)} MB）`)
    }
    sizes.set(key, size)
  } else {
    kvSizes.get(appId)?.set(key, size)
  }
  await idbPut(STORE.kv, { appId, key, value })
}

export async function kvDelete(appId: string, key: string): Promise<void> {
  kvSizes.get(appId)?.delete(key)
  await idbDelete(STORE.kv, [appId, key])
}

export async function kvKeys(appId: string): Promise<string[]> {
  const rows = await idbGetAllByIndex<{ key: string }>(STORE.kv, 'appId', appId)
  return rows.map((row) => row.key)
}

export async function kvClear(appId: string): Promise<void> {
  kvSizes.delete(appId)
  const rows = await idbGetAllByIndex<{ appId: string; key: string }>(STORE.kv, 'appId', appId)
  const db = await openDb()
  const tx = db.transaction(STORE.kv, 'readwrite')
  for (const row of rows) tx.objectStore(STORE.kv).delete([row.appId, row.key])
  await txDone(tx)
}

export async function kvBytes(appId: string): Promise<number> {
  const sizes = await loadKvSizes(appId)
  let total = 0
  for (const size of sizes.values()) total += size
  return total
}

/* ------------------------------------------------------------------ *
 * 设置
 * ------------------------------------------------------------------ */

export async function settingGet<T>(key: string): Promise<T | undefined> {
  const row = await idbGet<{ key: string; value: T }>(STORE.settings, key)
  return row?.value
}

export async function settingSet<T>(key: string, value: T): Promise<void> {
  await idbPut(STORE.settings, { key, value })
}

/* ------------------------------------------------------------------ *
 * 用量 / 日志 / 审计
 * ------------------------------------------------------------------ */

export async function addUsage(record: UsageRecord): Promise<void> {
  await idbPut(STORE.usage, record)
}

export async function listUsage(): Promise<UsageRecord[]> {
  const rows = await idbGetAll<UsageRecord>(STORE.usage)
  return rows.sort((a, b) => b.at - a.at)
}

/**
 * 写日志，并把每个应用控制在最近 500 条（环形缓冲）。
 * 每应用每分钟最多 120 条，防止应用用循环 log 拖垮存储。
 */
export async function addLog(record: LogRecord): Promise<void> {
  const bucket = logBuckets.get(record.appId) ?? { start: Date.now(), count: 0 }
  if (Date.now() - bucket.start >= 60_000) {
    bucket.start = Date.now()
    bucket.count = 0
  }
  if (bucket.count >= LOG_RATE_PER_MINUTE) {
    logBuckets.set(record.appId, bucket)
    return
  }
  bucket.count += 1
  logBuckets.set(record.appId, bucket)
  await idbPut(STORE.logs, record)
  if (Math.random() < 0.1) await trimLogs(record.appId)
}

export async function trimLogs(appId: string): Promise<void> {
  const rows = await idbGetAllByIndex<LogRecord>(STORE.logs, 'appId', appId)
  if (rows.length <= 500) return
  rows.sort((a, b) => a.at - b.at)
  const excess = rows.slice(0, rows.length - 500)
  const db = await openDb()
  const tx = db.transaction(STORE.logs, 'readwrite')
  for (const row of excess) tx.objectStore(STORE.logs).delete(row.id)
  await txDone(tx)
}

export async function listLogs(appId?: string): Promise<LogRecord[]> {
  const rows = appId
    ? await idbGetAllByIndex<LogRecord>(STORE.logs, 'appId', appId)
    : await idbGetAll<LogRecord>(STORE.logs)
  return rows.sort((a, b) => b.at - a.at).slice(0, 500)
}

export async function clearLogs(appId?: string): Promise<void> {
  if (!appId) {
    const db = await openDb()
    const tx = db.transaction(STORE.logs, 'readwrite')
    tx.objectStore(STORE.logs).clear()
    await txDone(tx)
    return
  }
  const rows = await idbGetAllByIndex<LogRecord>(STORE.logs, 'appId', appId)
  const db = await openDb()
  const tx = db.transaction(STORE.logs, 'readwrite')
  for (const row of rows) tx.objectStore(STORE.logs).delete(row.id)
  await txDone(tx)
}

export async function addAudit(record: AuditRecord): Promise<void> {
  await idbPut(STORE.audit, record)
  if (Math.random() < 0.05) {
    const rows = await idbGetAll<AuditRecord>(STORE.audit)
    if (rows.length > AUDIT_KEEP) {
      rows.sort((a, b) => a.at - b.at)
      const excess = rows.slice(0, rows.length - AUDIT_KEEP)
      const db = await openDb()
      const tx = db.transaction(STORE.audit, 'readwrite')
      for (const row of excess) tx.objectStore(STORE.audit).delete(row.id)
      await txDone(tx)
    }
  }
}

export async function listAudit(): Promise<AuditRecord[]> {
  const rows = await idbGetAll<AuditRecord>(STORE.audit)
  return rows.sort((a, b) => b.at - a.at).slice(0, 500)
}

/* ------------------------------------------------------------------ *
 * 运行时权限
 * ------------------------------------------------------------------ */

export async function listGrants(appId: string): Promise<CapabilityGrant[]> {
  return idbGetAllByIndex<CapabilityGrant>(STORE.grants, 'appId', appId)
}

export async function setGrant(grant: CapabilityGrant): Promise<void> {
  await idbPut(STORE.grants, grant)
}

export async function deleteGrant(appId: string, capability: CapabilityGrant['capability']): Promise<void> {
  await idbDelete(STORE.grants, [appId, capability])
}

/* ------------------------------------------------------------------ *
 * 快照
 * ------------------------------------------------------------------ */

export async function addSnapshot(snapshot: Snapshot): Promise<void> {
  await idbPut(STORE.snapshots, snapshot)
  const all = (await idbGetAll<Snapshot>(STORE.snapshots)).sort((a, b) => b.at - a.at)
  const excess = all.slice(3)
  if (excess.length === 0) return
  const db = await openDb()
  const tx = db.transaction(STORE.snapshots, 'readwrite')
  for (const item of excess) tx.objectStore(STORE.snapshots).delete(item.id)
  await txDone(tx)
}

/**
 * 用备份内容一次性替换本机数据。
 * 所有 store 在同一个事务里清空并写入，避免中途失败留下半恢复状态。
 */
export async function replaceAllData(payload: {
  apps: PortalApp[]
  kv: Array<{ appId: string; key: string; value: unknown }>
  grants: CapabilityGrant[]
  settings: Array<{ key: string; value: unknown }>
  usage: unknown[]
  triggers?: AppTrigger[]
}): Promise<void> {
  const db = await openDb()
  const stores = [
    STORE.apps,
    STORE.kv,
    STORE.logs,
    STORE.grants,
    STORE.settings,
    STORE.usage,
    STORE.triggers,
  ]
  const tx = db.transaction(stores, 'readwrite')
  tx.objectStore(STORE.apps).clear()
  tx.objectStore(STORE.kv).clear()
  tx.objectStore(STORE.logs).clear()
  tx.objectStore(STORE.grants).clear()
  tx.objectStore(STORE.triggers).clear()
  // settings / usage 也要清空：否则旧预算、应用设置与历史用量会在恢复后残留，
  // 用量还会被重复计入预算。
  tx.objectStore(STORE.settings).clear()
  tx.objectStore(STORE.usage).clear()
  for (const app of payload.apps) tx.objectStore(STORE.apps).put(app)
  for (const item of payload.kv) tx.objectStore(STORE.kv).put(item)
  for (const grant of payload.grants) tx.objectStore(STORE.grants).put(grant)
  for (const trigger of payload.triggers ?? []) tx.objectStore(STORE.triggers).put(trigger)
  for (const item of payload.settings) {
    if (item.value !== null && item.value !== undefined) {
      tx.objectStore(STORE.settings).put(item)
    }
  }
  for (const usage of payload.usage) tx.objectStore(STORE.usage).put(usage as never)
  await txDone(tx)
  kvSizes.clear()
  logBuckets.clear()
}

export async function listSnapshots(): Promise<Snapshot[]> {
  const rows = await idbGetAll<Snapshot>(STORE.snapshots)
  return rows.sort((a, b) => b.at - a.at)
}

export async function latestSnapshot(): Promise<Snapshot | undefined> {
  return (await listSnapshots())[0]
}

/* ------------------------------------------------------------------ *
 * 触发器与应用设置
 * ------------------------------------------------------------------ */

/** 每个应用最多注册的触发器数量，避免应用无节制地占用本机 */
export const MAX_TRIGGERS_PER_APP = 20

export async function listTriggers(appId?: string): Promise<AppTrigger[]> {
  const rows = appId
    ? await idbGetAllByIndex<AppTrigger>(STORE.triggers, 'appId', appId)
    : await idbGetAll<AppTrigger>(STORE.triggers)
  return rows.sort((a, b) => a.createdAt - b.createdAt)
}

export async function saveTrigger(trigger: AppTrigger): Promise<void> {
  const existing = await listTriggers(trigger.appId)
  const isUpdate = existing.some((item) => item.id === trigger.id)
  if (!isUpdate && existing.length >= MAX_TRIGGERS_PER_APP) {
    throw new Error(`每个工具最多 ${MAX_TRIGGERS_PER_APP} 个触发器`)
  }
  await idbPut(STORE.triggers, trigger)
}

export async function deleteTrigger(id: string): Promise<void> {
  await idbDelete(STORE.triggers, id)
}

export async function deleteAppTriggers(appId: string): Promise<void> {
  const rows = await listTriggers(appId)
  for (const row of rows) await deleteTrigger(row.id)
}

/** 应用在门户里的设置；没存过时给出默认值（通知默认开、横幅开、震动关） */
export async function getAppSettings(appId: string): Promise<AppUserSettings> {
  const stored = await settingGet<Partial<AppUserSettings>>(`app-settings:${appId}`)
  return {
    notifications: {
      enabled: stored?.notifications?.enabled ?? true,
      banner: stored?.notifications?.banner ?? true,
      vibrate: stored?.notifications?.vibrate ?? false,
    },
  }
}

export async function saveAppSettings(
  appId: string,
  settings: AppUserSettings,
): Promise<void> {
  await settingSet(`app-settings:${appId}`, settings)
}

/**
 * 触发器事件收件箱：应用没在运行时先把事件存着，下次打开时补发。
 * 只保留最近 20 条，避免长期堆积。
 */
export async function pushTriggerEvent(event: TriggerEvent): Promise<void> {
  const key = `trigger-inbox:${event.appId}`
  const current = (await settingGet<TriggerEvent[]>(key)) ?? []
  await settingSet(key, [...current, event].slice(-20))
}

export async function takeTriggerEvents(appId: string): Promise<TriggerEvent[]> {
  const key = `trigger-inbox:${appId}`
  const events = (await settingGet<TriggerEvent[]>(key)) ?? []
  if (events.length > 0) await settingSet(key, [])
  return events
}
