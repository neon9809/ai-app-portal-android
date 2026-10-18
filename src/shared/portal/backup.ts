/**
 * 加密备份与本地快照。
 *
 * 备份容器：MAGIC(5) + salt(16) + iv(12) + AES-GCM 密文。
 * 口令经 PBKDF2-SHA256（310000 轮）派生 256 位密钥。
 * 说明：浏览器 / WebView 没有 Argon2id 原生实现，这里用 PBKDF2 替代，
 * 界面上会如实写明。忘记口令 = 备份作废。
 */

import type { AppTrigger, CapabilityGrant, PortalApp, Snapshot } from './types'

import {
  addAudit,
  addSnapshot,
  idbGetAll,
  kvKeys,
  replaceAllData,
  listApps,
  listGrants,
  listSnapshots,
  listTriggers,
  settingSet,
  STORE,
  kvGet,
} from './db'
import { uid, now } from './utils'

// 新备份使用产品标识；旧内部代号的备份仍可解密与导入（见 decryptBackup）。
const MAGIC = new Uint8Array([0x41, 0x49, 0x50, 0x42, 0x31]) // AIPB1
const LEGACY_MAGIC = new Uint8Array([0x5a, 0x57, 0x42, 0x4b, 0x31]) // ZWBK1
const PBKDF2_ITERATIONS = 310_000

export interface BackupPayload {
  /** 新备份写 ai-app-portal-backup；旧的 zaowu-backup 仍可解密与恢复 */
  format: 'ai-app-portal-backup' | 'zaowu-backup'
  version: 1
  exportedAt: number
  apps: PortalApp[]
  kv: Array<{ appId: string; key: string; value: unknown }>
  grants: CapabilityGrant[]
  settings: Array<{ key: string; value: unknown }>
  usage: unknown[]
  /** 应用注册的触发器（旧备份没有这个字段） */
  triggers?: AppTrigger[]
}

async function collectPayload(): Promise<BackupPayload> {
  const apps = await listApps()
  const kv: BackupPayload['kv'] = []
  const grants: CapabilityGrant[] = []
  for (const app of apps) {
    const keys = await kvKeys(app.id)
    for (const key of keys) {
      kv.push({ appId: app.id, key, value: await kvGet(app.id, key) })
    }
    grants.push(...(await listGrants(app.id)))
  }
  const usage = await idbGetAll<unknown>(STORE.usage)
  const triggers = await listTriggers()
  // 全量保存 settings：预算、应用通知偏好、引导状态与模型配置都在这一个 store 里，
  // 只备份 llm 会让恢复后的预算与应用设置凭空消失。
  const settings = await idbGetAll<{ key: string; value: unknown }>(STORE.settings)

  return {
    format: 'ai-app-portal-backup',
    version: 1,
    exportedAt: now(),
    apps,
    kv,
    grants,
    triggers,
    settings,
    usage,
  }
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function exportBackup(passphrase: string): Promise<{ blob: Blob; filename: string }> {
  if (passphrase.trim().length < 6) {
    throw new Error('口令至少 6 个字符')
  }
  const payload = await collectPayload()
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase.trim(), salt)
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      plaintext as unknown as BufferSource,
    ),
  )

  const output = new Uint8Array(MAGIC.length + salt.length + iv.length + cipher.length)
  output.set(MAGIC, 0)
  output.set(salt, MAGIC.length)
  output.set(iv, MAGIC.length + salt.length)
  output.set(cipher, MAGIC.length + salt.length + iv.length)

  await settingSet('lastBackupAt', now())
  await addAudit({
    id: uid('au_'),
    appId: '',
    appName: '备份',
    kind: 'backup.export',
    detail: `导出加密备份（${payload.apps.length} 个工具，${payload.kv.length} 条数据）`,
    at: now(),
  })
  const date = new Date()
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(
    date.getDate(),
  ).padStart(2, '0')}`
  return {
    blob: new Blob([output as unknown as BlobPart], { type: 'application/octet-stream' }),
    filename: `ai-app-portal-backup-${stamp}.aapbackup`,
  }
}

export async function decryptBackup(bytes: Uint8Array, passphrase: string): Promise<BackupPayload> {
  if (bytes.length < MAGIC.length + 16 + 12 + 16) {
    throw new Error('这个文件不是有效的AI应用门户备份')
  }
  const matches = (magic: Uint8Array) =>
    magic.every((byte, index) => bytes[index] === byte)
  if (!matches(MAGIC) && !matches(LEGACY_MAGIC)) {
    throw new Error('这个文件不是有效的AI应用门户备份')
  }
  const salt = bytes.slice(MAGIC.length, MAGIC.length + 16)
  const iv = bytes.slice(MAGIC.length + 16, MAGIC.length + 28)
  const cipher = bytes.slice(MAGIC.length + 28)

  const key = await deriveKey(passphrase.trim(), salt)
  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      cipher as unknown as BufferSource,
    )
  } catch {
    throw new Error('口令不对，或备份文件已损坏')
  }

  let payload: BackupPayload
  try {
    payload = JSON.parse(new TextDecoder().decode(plaintext)) as BackupPayload
  } catch {
    throw new Error('备份内容无法解析')
  }
  const formatOk =
    payload.format === 'ai-app-portal-backup' || payload.format === 'zaowu-backup'
  if (!formatOk || !Array.isArray(payload.apps)) {
    throw new Error('备份内容格式不正确')
  }
  return payload
}

/** 全量恢复：所有 store 在同一个事务里替换，避免中途失败留下半恢复状态 */
export async function restoreBackup(payload: BackupPayload): Promise<void> {
  await replaceAllData({
    apps: payload.apps,
    kv: payload.kv ?? [],
    grants: payload.grants ?? [],
    settings: payload.settings ?? [],
    usage: payload.usage ?? [],
    triggers: payload.triggers ?? [],
  })
  await addAudit({
    id: uid('au_'),
    appId: '',
    appName: '备份',
    kind: 'backup.restore',
    detail: `从备份恢复（${payload.apps.length} 个工具）`,
    at: now(),
  })
}

/* ------------------------------------------------------------------ *
 * 本地快照（未加密，只在本机）
 * ------------------------------------------------------------------ */

export async function takeSnapshot(reason: string): Promise<void> {
  const apps = await listApps()
  if (apps.length === 0) return
  const payload = await collectPayload()
  const data = JSON.stringify(payload)
  await addSnapshot({
    id: uid('s_'),
    at: now(),
    reason,
    apps: apps.length,
    bytes: new TextEncoder().encode(data).length,
    data,
  })
}

export async function restoreSnapshot(snapshot: Snapshot): Promise<void> {
  const payload = JSON.parse(snapshot.data) as BackupPayload
  await restoreBackup(payload)
}

export async function snapshotList(): Promise<Snapshot[]> {
  return listSnapshots()
}
