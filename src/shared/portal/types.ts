/**
 * AI应用门户的核心数据模型。
 *
 * 本应用是「手机上的应用工厂」：用户用自然语言描述需求，经过
 * 需求确认 → 方案确认 → 生成与自检 → 验收安装 四段流程，产出一个
 * 可在本地沙箱里运行的网页小工具。
 *
 * 所有数据只存在本机 IndexedDB（见 db.ts），不接云端。
 */

/** 一次应用生成所处的阶段 */
export type StudioStep = 'requirements' | 'plan' | 'generate' | 'review'

/** 应用在货架里的状态：草稿（验收中）/ 已安装 */
export type AppStatus = 'draft' | 'installed'

/**
 * 端侧原子能力分组（平台连接器提供）。
 * 每组对应一类真实设备能力，应用按需申请，用户第一次调用时逐组授权。
 */
export type DeviceAbilityGroup =
  /** 打开 / 查询其它应用、打开网页、发通知、读屏幕尺寸 */
  | 'deviceApps'
  /** 文件管理的搜索、列表、创建、移动、重命名、回收站 */
  | 'deviceFiles'
  /** 把本机文件批量上传到服务端 */
  | 'deviceUpload'
  /** 震动反馈 */
  | 'deviceHaptics'
  /** 语音播报（TTS） */
  | 'deviceSpeech'
  /** 系统设置：WiFi / 蓝牙 / 热点 / VPN / 流量 / 投屏 / 音量 / 锁屏音 */
  | 'deviceSystem'
  /** 打开「快记」应用录音（录音文件保存在快记里） */
  | 'deviceRecorder'
  /** 系统相机的美颜 / 自拍模式 */
  | 'deviceCameraModes'
  /** 天气查询（按城市，或按当前位置） */
  | 'deviceWeather'

/** 应用可用的沙箱能力。python 固定为 false（本版本运行环境不支持） */
export interface AppCapabilities {
  /** 每个应用独立的本地键值存储 */
  storage: boolean
  /** 经宿主转发的 AI 对话（需要 App 内配置模型） */
  llm: boolean
  /** 出站白名单（主机名，不含协议）；空数组 = 禁止联网 */
  network: string[]
  /** 读写系统剪贴板（可选，旧应用没有这个字段） */
  clipboard?: boolean
  /** 选择本机文件 / 下载 https 文件（可选） */
  files?: boolean
  /** BLE 扫描、连接与特征值读写（可选） */
  bluetooth?: boolean
  /** 麦克风录音（可选） */
  record?: boolean
  /** 相机拍照 / 录像（可选） */
  camera?: boolean
  /** 获取当前位置（可选） */
  location?: boolean
  /**
   * 端侧原子能力（可选）。只写应用真正会用到的组；
   * 运行时经 window.portal.device.call 走宿主转发的设备桥。
   */
  device?: DeviceAbilityGroup[]
  /** 在门户里给用户发提醒（可选） */
  notifications?: boolean
  /** 注册定时 / 位置触发器（可选） */
  triggers?: boolean
  /**
   * MCP 工具（可选）：列出应用要调用的工具 key（与生成器同名的键，如 get_time、
   * 外部服务器工具 mock__echo）。运行时经 window.portal.mcp.call 走宿主执行。
   */
  mcp?: string[]
  python: false
}

/**
 * 权限卡：给用户看的大白话能力声明。
 * 用户确认的是这张卡，而不是代码。
 */
export interface PermissionCard {
  /** 能干什么 */
  can: string[]
  /** 不能干什么 */
  cannot: string[]
  /** 为什么需要这些能力 */
  why: string
}

/** .neon-aap 包内的 manifest（移动端扩展版） */
export interface AppManifest {
  id: string
  name: string
  /** 应用图标（emoji）；导入导出时随包保留 */
  emoji?: string
  version: string
  entry: 'app/index.html'
  capabilities: AppCapabilities
  permission_card: PermissionCard
  generated: {
    at: number
    model: string
    turns: number
  }
}

/** 用户随需求一起给的材料：图片存 data URL，文本存正文 */
export interface RequirementAttachment {
  name: string
  kind: 'image' | 'text'
  content: string
}

/** 需求摘要（由生成器从用户原话里自行判断，不再逐项追问） */
/** 计划阶段向用户提出的关键疑问 */
export interface ClarifyQuestion {
  id: string
  question: string
  /** 建议选项（点选即可，也可自填） */
  options: string[]
}

export interface AppRequirements {
  /** 用户原话 */
  brief: string
  /** 核心功能（复述） */
  core: string
  /** 一次性 or 持久 */
  lifetime: 'once' | 'persistent'
  /** 输入方式 */
  inputs: string[]
  /** 结果怎么用 */
  outputs: string[]
  /** 使用环境 */
  environment: 'offline' | 'online'
  /** 数据结构草案（白话） */
  data_draft: string
  /** 生成前用户对关键疑问的确认（问题 → 答案），后续修改也会带上 */
  clarifications?: Array<{ question: string; answer: string }>
  /** 用户附带的图片 / 文本材料 */
  attachments?: RequirementAttachment[]
}

/** 界面风格模板 */
export type AppStyle = 'list' | 'form' | 'board'

/** 第 2 段：技术方案确认卡 */
export interface AppPlan {
  /** 形态：本版本只有网页应用 */
  form: 'html'
  /** 数据方案 */
  data: 'none' | 'kv'
  /** 需要的能力 */
  capabilities: AppCapabilities
  /** 界面风格 */
  style: AppStyle
  /** 为什么这样建议（给用户看） */
  reasoning: string
}

/** 一次验收修改记录 */
export interface Revision {
  at: number
  request: string
  summary: string
  /** 这一轮修改的过程（步骤清单），用于在对话流里回看 */
  steps?: JobStep[]
  /** 修改前源码（用于回滚与审计） */
  before_html: string
}

/** 一个已生成 / 已安装的应用 */
export interface PortalApp {
  id: string
  name: string
  emoji: string
  description: string
  /** 单文件网页应用源码 */
  html: string
  manifest: AppManifest
  requirements: AppRequirements
  plan: AppPlan
  status: AppStatus
  step: StudioStep
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
  /** 已经走过的生成轮次（含修复） */
  turns: number
  revisions: Revision[]
  /** 首次生成时的过程（步骤清单），用于在对话流里回看 */
  generationSteps?: JobStep[]
}

/** 单次模型调用记录（逐应用计量） */
export interface UsageRecord {
  id: string
  appId: string
  appName: string
  kind: 'generate' | 'repair' | 'summarize' | 'app-call'
  model: string
  inputTokens: number
  outputTokens: number
  at: number
}

/** 调试 / 审计日志 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogRecord {
  id: string
  appId: string
  traceId: string
  level: LogLevel
  message: string
  data?: string
  at: number
}

export type AuditKind =
  | 'app.install'
  | 'app.update'
  | 'app.delete'
  | 'app.export'
  | 'app.import'
  | 'capability.grant'
  | 'capability.revoke'
  | 'network.block'
  | 'storage.clear'
  | 'backup.export'
  | 'backup.restore'

/** 审计日志（能力调用与关键操作） */
export interface AuditRecord {
  id: string
  appId: string
  appName: string
  kind: AuditKind
  detail: string
  at: number
}

/** 应用可申请的能力（运行时逐应用授权） */
export type AppCapabilityKey =
  | 'storage'
  | 'llm'
  | 'network'
  | 'clipboard'
  | 'files'
  | 'bluetooth'
  | 'record'
  | 'camera'
  | 'location'
  | 'notifications'
  | 'triggers'
  | 'mcp'
  | DeviceAbilityGroup

/** 某应用某能力的运行时授权状态 */
export interface CapabilityGrant {
  appId: string
  capability: AppCapabilityKey
  granted: boolean
  grantedAt: number
}

/** 自动快照 */
export interface Snapshot {
  id: string
  at: number
  reason: string
  apps: number
  bytes: number
  data: string
}

/** 生成任务状态 */
export type JobPhase =
  | 'preparing'
  | 'planning'
  | 'asking'
  | 'generating'
  | 'checking'
  | 'repairing'
  | 'saving'
  | 'done'
  | 'failed'
  | 'cancelled'

/** 生成过程的一条可见记录（思考 / 动作 / 检查结果） */
export interface JobTrace {
  id: string
  at: number
  kind: 'think' | 'act' | 'ok' | 'warn' | 'error'
  text: string
}

/** 一个规划步骤：标题 + 状态 + 该步骤下的过程记录 */
export interface JobStep {
  id: string
  title: string
  /** 一句话补充说明，可选 */
  detail?: string
  status: 'pending' | 'active' | 'done' | 'warn' | 'error'
  startedAt?: number
  finishedAt?: number
  /** 这一步里发生的具体操作与结果 */
  logs: JobTrace[]
}

export interface GenerationJob {
  appId: string
  phase: JobPhase
  /** 0-100 */
  progress: number
  message: string
  error?: string
  /** 本次修复轮次 */
  repairRound: number
  startedAt: number
  finishedAt?: number
  cancelled: boolean
  /** 生成过程时间线，最新的在末尾 */
  traces: JobTrace[]
  /** 任务规划：步骤清单，当前步骤为 active */
  steps: JobStep[]
  /** 模型正在输出的内容（流式，只保留尾部片段用于显示） */
  live?: string
  /** 模型的思考过程（reasoning 模型会返回；只保留尾部片段） */
  thinking?: string
  /** 当前是否在流式输出 */
  streaming?: boolean
  /** 计划阶段产生的关键疑问；phase 为 asking 时等待用户回答 */
  questions?: ClarifyQuestion[]
}

/* ------------------------------------------------------------------ *
 * 触发器与提醒
 *
 * 如实说明：门户是 H5 应用，没有系统级后台唤醒能力。
 * 时间触发器只在门户打开（前台）时检查，错过的一次性 / 每日触发会在下次打开时补发；
 * 位置触发器需要应用声明定位能力，并且只在应用运行时检查。
 * ------------------------------------------------------------------ */

export type TriggerKind = 'time' | 'location'

export type TriggerSchedule =
  /** 某个时间点触发一次 */
  | { type: 'once'; at: number }
  /** 每天固定时刻 */
  | { type: 'daily'; hour: number; minute: number }
  /** 每隔多少分钟 */
  | { type: 'interval'; everyMinutes: number }

export interface TriggerLocation {
  latitude: number
  longitude: number
  radiusMeters: number
  /** 进入范围 / 离开范围时触发 */
  mode: 'enter' | 'leave'
}

export interface TriggerAction {
  notify?: { title: string; body?: string }
  vibrate?: boolean
  /** 把事件投递给应用自己的 portal.on('trigger') 回调 */
  run?: boolean
}

export interface AppTrigger {
  id: string
  appId: string
  appName: string
  name: string
  kind: TriggerKind
  enabled: boolean
  schedule?: TriggerSchedule
  location?: TriggerLocation
  action: TriggerAction
  createdAt: number
  lastFiredAt?: number
  firedCount: number
  /** 位置触发的上次状态 / 每日触发的去重日期 */
  state?: { inside?: boolean; lastDay?: string }
}

/** 一次触发事件（投递给应用与提醒横幅） */
export interface TriggerEvent {
  triggerId: string
  appId: string
  appName: string
  name: string
  at: number
  action: TriggerAction
}

export interface AppNotificationSettings {
  /** 允许这个工具提醒我 */
  enabled: boolean
  /** 在门户里显示横幅 */
  banner: boolean
  /** 提醒时震动 */
  vibrate: boolean
}

/** 应用在门户里的用户设置（由「应用设置」页维护） */
export interface AppUserSettings {
  notifications: AppNotificationSettings
}
