/**
 * .neon-aap 包格式（v2，移动端扩展）的导入 / 导出。
 *
 * ZIP 结构：
 *   manifest.json   —— 应用元信息 + capabilities + permission_card
 *   app/index.html  —— 单文件应用
 *   README.txt      —— 给接收者看的说明
 *
 * 与参考项目保持结构兼容；本版本没有 python/ 与 icon.png。
 */

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

import { isDeviceGroup } from './device'
import type {
  AppCapabilities,
  AppManifest,
  AppPlan,
  AppRequirements,
  DeviceAbilityGroup,
  PortalApp,
} from './types'
import { now, uid } from './utils'

export interface PendingImport {
  manifest: AppManifest
  html: string
  /** 导入后建议的新 id（避免与本机已有应用冲突） */
  nextId: string
  bytes: number
}

function makeReadme(app: PortalApp): string {
  return [
    `# ${app.name}`,
    '',
    app.description,
    '',
    '## 这个应用能做什么',
    ...app.manifest.permission_card.can.map((item) => `- ${item}`),
    '',
    '## 它不能做什么',
    ...app.manifest.permission_card.cannot.map((item) => `- ${item}`),
    '',
    '## 说明',
    app.manifest.permission_card.why,
    '',
    `由「AI应用门户」生成，导出于 ${new Date().toLocaleString('zh-CN')}。`,
    '应用代码在 app/index.html，可直接用浏览器打开审计。',
  ].join('\n')
}

export function buildPackage(app: PortalApp): { bytes: Uint8Array; filename: string } {
  const manifest: AppManifest = {
    ...app.manifest,
    id: app.id,
    name: app.name,
    emoji: app.emoji,
  }
  const zipped = zipSync(
    {
      'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
      'app/index.html': strToU8(app.html),
      'README.txt': strToU8(makeReadme(app)),
    },
    { level: 6 },
  )
  const safeName = app.name.replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 30) || 'app'
  return { bytes: zipped, filename: `${safeName}-${manifest.version}.neon-aap` }
}

function isCapabilities(value: unknown): value is AppCapabilities {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.storage === 'boolean' &&
    typeof record.llm === 'boolean' &&
    Array.isArray(record.network)
  )
}

export function parsePackageBytes(bytes: Uint8Array): PendingImport {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    throw new Error('不是有效的 .neon-aap 文件（无法解压）')
  }

  const manifestFile = files['manifest.json']
  const htmlFile = files['app/index.html']
  if (!manifestFile) throw new Error('应用包缺少 manifest.json')
  if (!htmlFile) throw new Error('应用包缺少 app/index.html')

  let raw: unknown
  try {
    raw = JSON.parse(strFromU8(manifestFile))
  } catch {
    throw new Error('manifest.json 格式不正确')
  }
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const permission =
    record.permission_card && typeof record.permission_card === 'object'
      ? (record.permission_card as Record<string, unknown>)
      : {}

  const capabilities: AppCapabilities = isCapabilities(record.capabilities)
    ? {
        storage: record.capabilities.storage,
        llm: record.capabilities.llm,
        network: record.capabilities.network.map(String),
        clipboard: record.capabilities.clipboard === true,
        files: record.capabilities.files === true,
        bluetooth: record.capabilities.bluetooth === true,
        record: record.capabilities.record === true,
        camera: record.capabilities.camera === true,
        location: record.capabilities.location === true,
        notifications: record.capabilities.notifications === true,
        triggers: record.capabilities.triggers === true,
        device: Array.isArray(record.capabilities.device)
          ? Array.from(
              new Set(
                record.capabilities.device
                  .map(String)
                  .filter((item): item is DeviceAbilityGroup => isDeviceGroup(item)),
              ),
            )
          : undefined,
        python: false,
      }
    : { storage: true, llm: false, network: [], python: false }

  const manifest: AppManifest = {
    id: String(record.id ?? uid('a_')),
    name: String(record.name ?? '导入的应用').slice(0, 40),
    emoji: String(record.emoji ?? '📦').slice(0, 8) || '📦',
    version: String(record.version ?? '1.0.0'),
    entry: 'app/index.html',
    capabilities,
    permission_card: {
      can: Array.isArray(permission.can) ? permission.can.map(String).slice(0, 8) : ['运行这个网页工具'],
      cannot: Array.isArray(permission.cannot) ? permission.cannot.map(String).slice(0, 8) : ['不访问系统权限'],
      why: String(permission.why ?? '能力范围见上方说明。'),
    },
    generated: {
      at: Number((record.generated as Record<string, unknown> | undefined)?.at) || now(),
      model: String((record.generated as Record<string, unknown> | undefined)?.model ?? '未知'),
      turns: Number((record.generated as Record<string, unknown> | undefined)?.turns) || 1,
    },
  }

  const html = strFromU8(htmlFile)
  if (!/<html[\s>]/i.test(html) && !/<body[\s>]/i.test(html)) {
    throw new Error('应用入口不是完整的网页文件')
  }

  return {
    manifest,
    html,
    nextId: uid('a_'),
    bytes: bytes.byteLength,
  }
}

export function installImport(pending: PendingImport): PortalApp {
  const requirements: AppRequirements = {
    brief: '从 .neon-aap 包导入',
    core: pending.manifest.permission_card.can[0] ?? '导入的工具',
    lifetime: pending.manifest.capabilities.storage ? 'persistent' : 'once',
    inputs: ['应用自身输入'],
    outputs: ['在页面查看'],
    environment: pending.manifest.capabilities.network.length > 0 ? 'online' : 'offline',
    data_draft: '沿用应用原有数据安排。',
  }
  const plan: AppPlan = {
    form: 'html',
    data: pending.manifest.capabilities.storage ? 'kv' : 'none',
    capabilities: pending.manifest.capabilities,
    style: 'list',
    reasoning: '从 .neon-aap 包导入，方案随包一起带来。',
  }
  const timestamp = now()

  return {
    id: pending.nextId,
    name: pending.manifest.name,
    emoji: pending.manifest.emoji ?? '📦',
    description: pending.manifest.permission_card.can[0] ?? '导入的应用',
    html: pending.html,
    manifest: { ...pending.manifest, id: pending.nextId },
    requirements,
    plan,
    status: 'installed',
    step: 'review',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: timestamp,
    turns: pending.manifest.generated.turns,
    revisions: [],
  }
}
