/**
 * 生成器：四段流程里第 3 段的执行引擎。
 *
 * 一次生成 = 组装提示词 → 调用模型 → 解析结构化产物 → 静态检查 →
 * 离屏沙箱自检 → 最多 3 轮修复 → 落盘。
 * 任务状态放在模块级 Map 里，所以切到别的 Tab 再回来仍能看到进度
 * （H5 无法在完全离开 App 后继续，这点会如实写在界面上）。
 */

import { addAudit, addUsage, getApp, saveApp } from './db'
import {
  chat,
  chatStream,
  LlmError,
  readLlmSettings,
  type ChatContentPart,
  type ChatMessage,
  type LlmSettings,
} from './llm'
import { runSandboxProbe, type RuntimeIssue } from './sandbox'
import { DEVICE_ABILITIES, DEVICE_GROUP_ORDER, DEVICE_GROUPS, isDeviceGroup } from './device'
import type {
  AppCapabilities,
  AppPlan,
  AppRequirements,
  AppStyle,
  DeviceAbilityGroup,
  GenerationJob,
  JobStep,
  JobTrace,
  PermissionCard,
  PortalApp,
  RequirementAttachment,
} from './types'
import { normalizeHosts, now, uid } from './utils'

/* ------------------------------------------------------------------ *
 * 需求与方案的自动判断
 *
 * 用户只写一句需求、可以带附件。这里只做保守推断：
 * 拿不准时选择更少权限、更少联网、更简单的做法，再把判断结果交给模型，
 * 不在界面上一项项追问用户。
 * ------------------------------------------------------------------ */

export function inferRequirements(
  brief: string,
  attachments: RequirementAttachment[] = [],
): AppRequirements {
  const text = brief.trim()

  const once = /(一次性|临时的|用完就扔|用完就丢|不需要保存|不用保存|转换一次|算一次|只看一次)/.test(text)
  const lifetime = once ? 'once' : 'persistent'

  const inputs: string[] = []
  if (/(文件|excel|csv|表格|导入|上传|图片|截图|照片|pdf)/i.test(text)) inputs.push('文件导入')
  if (/(粘贴|复制|文本|输入一段)/.test(text)) inputs.push('粘贴文字')
  if (inputs.length === 0) inputs.push('手动输入')

  const outputs = ['在页面查看']
  if (/(导出|下载|保存成|生成文件|存成)/.test(text)) outputs.push('导出文件')
  if (/(复制|分享|发给|发出去)/.test(text)) outputs.push('复制结果')

  const online = /(联网|在线|天气|汇率|股票|新闻|搜索|网页|接口|api|实时|地图|翻译|查询)/i.test(text)

  const dataDraft =
    lifetime === 'persistent'
      ? '把每次录入的内容保存在本机，下次打开还能看到；按时间倒序展示，可删除单条。'
      : '不保存历史记录，每次打开都是新的；结果只在当前页展示。'

  return {
    brief: text,
    core: text,
    lifetime,
    inputs,
    outputs,
    environment: online ? 'online' : 'offline',
    data_draft: dataDraft,
    attachments: attachments.length > 0 ? attachments : undefined,
  }
}

const AI_HINTS = /(AI|人工智能|帮我写|帮我总结|翻译|润色|识别|分析一下|聊天|问答|出个主意)/i
const STYLE_HINTS: Array<{ style: AppStyle; pattern: RegExp }> = [
  { style: 'form', pattern: /(计算|换算|转换|表单|填写|登记|评分|评估|生成报告)/ },
  { style: 'board', pattern: /(看板|分类|概览|卡片|画廊|仪表|总览)/ },
  { style: 'list', pattern: /(清单|列表|记录|账本|日志|收藏|待办|打卡|记账)/ },
]

const DEVICE_HINTS: Array<{ group: DeviceAbilityGroup; pattern: RegExp }> = [
  {
    group: 'deviceApps',
    pattern:
      /(打开.{0,4}(微信|支付宝|淘宝|抖音|高德|地图|浏览器|设置|应用)|启动.{0,4}应用|应用列表|装了哪些|安装了哪些|包名|用浏览器打开|打开网页)/,
  },
  {
    group: 'deviceFiles',
    pattern:
      /(文件管理|搜索文件|查找文件|新建文件夹|回收站|重命名文件|移动文件|截屏文件|录屏文件|下载的文件|文档列表)/,
  },
  { group: 'deviceUpload', pattern: /(上传到|上传至|传到服务端|上传文件到|批量上传)/ },
  { group: 'deviceHaptics', pattern: /(震动|触感|振动|马达)/ },
  { group: 'deviceSpeech', pattern: /(语音播报|播报|朗读|念一下|读出来|念出)/ },
  {
    group: 'deviceSystem',
    pattern:
      /(WiFi|wifi|无线网络|蓝牙开关|打开蓝牙|关闭蓝牙|个人热点|VPN|vpn|投屏|移动网络|双卡|锁屏提示音|媒体音量|音量调到|翻转静音)/,
  },
  { group: 'deviceRecorder', pattern: /(快记)/ },
  { group: 'deviceCameraModes', pattern: /(美颜|自拍)/ },
  { group: 'deviceWeather', pattern: /(天气|气温|下雨|降水|空气质量|紫外线)/ },
]

/** 从用户原话保守推断端侧能力组；拿不准就不声明 */
function inferDeviceGroups(text: string): DeviceAbilityGroup[] | undefined {
  const groups = DEVICE_HINTS.filter((item) => item.pattern.test(text)).map((item) => item.group)
  return groups.length > 0 ? groups : undefined
}

export function inferPlan(requirements: AppRequirements): AppPlan {
  const text = requirements.brief
  const hosts = Array.from(text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)).map((match) =>
    match[1].toLowerCase(),
  )
  const style = STYLE_HINTS.find((item) => item.pattern.test(text))?.style ?? 'list'
  const needsLlm = AI_HINTS.test(text)
  const needsNetwork = requirements.environment === 'online' || hosts.length > 0

  const capabilities: AppCapabilities = {
    storage: requirements.lifetime === 'persistent',
    llm: needsLlm,
    network: needsNetwork ? Array.from(new Set(hosts)) : [],
    clipboard: /(剪贴板|粘贴板|复制到剪贴板)/.test(text),
    files: /(上传|下载|导入文件|导出文件|附件|excel|csv|pdf)/i.test(text),
    bluetooth: /(蓝牙|BLE|手环|穿戴设备)/i.test(text),
    record: /(录音|麦克风|语音输入|录音笔)/.test(text),
    camera: /(拍照|相机|摄像头|录像|拍视频|扫码)/.test(text),
    location: /(定位|位置|附近|距离|导航|经纬度|在哪儿)/.test(text),
    notifications: /(提醒|通知|闹钟|定时|到点|打卡|日程|备忘|该做)/.test(text),
    triggers: /(提醒|闹钟|定时|到点|每天|每周|每隔|打卡|日程|进入|离开|围栏)/.test(text),
    device: inferDeviceGroups(text),
    python: false,
  }

  const reasons = [
    '应用运行在网页沙箱里，用单文件网页实现，打开即用。',
    capabilities.storage ? '需要留存数据，使用应用自己的本地存储，数据只在这台设备上。' : '一次性使用，不保存历史。',
  ]
  if (needsLlm) reasons.push('需求里包含 AI 生成 / 分析类功能，打开 AI 能力。')
  if (capabilities.clipboard) reasons.push('需要读写剪贴板。')
  if (capabilities.files) reasons.push('需要选择或下载文件。')
  if (capabilities.bluetooth) reasons.push('需要连接蓝牙设备。')
  if (capabilities.record) reasons.push('需要录音。')
  if (capabilities.camera) reasons.push('需要相机拍照或录像。')
  if (capabilities.location) reasons.push('需要读取当前位置。')
  if (capabilities.notifications) reasons.push('通过门户内的横幅提醒你，不推送系统通知。')
  if (capabilities.triggers) {
    reasons.push('需要按时间或位置触发；只在门户打开时检查，错过的时间提醒会在下次打开时补发。')
  }
  if (capabilities.device?.length) {
    reasons.push(
      `需要手机能力：${capabilities.device
        .map((group) => DEVICE_GROUPS[group].title)
        .join('、')}；第一次用到时会逐项问你。`,
    )
  }
  if (needsNetwork) {
    if (capabilities.device?.includes('deviceWeather')) {
      reasons.push('天气数据通过系统的天气能力获取，不额外开通联网白名单。')
    } else {
      reasons.push(
        hosts.length > 0
          ? `会访问：${hosts.join('、')}，只放行这些地址。`
          : '需求提到联网，但没有给出具体网站；默认按不联网实现，需要时再补。',
      )
    }
  }

  return {
    form: 'html',
    data: capabilities.storage ? 'kv' : 'none',
    capabilities,
    style,
    reasoning: reasons.join(''),
  }
}

/* ------------------------------------------------------------------ *
 * 提示词
 * ------------------------------------------------------------------ */

const STYLE_GUIDE: Record<AppStyle, string> = {
  list: '清单型：顶部一个简洁标题区，主体是纵向分组列表，每行左侧主文案、右侧状态或操作；分隔线用 1px 细线；主操作放底部固定条。',
  form: '表单型：顶部简短说明，主体按「区块 + 字段」组织，输入框高度不低于 44px，主按钮常驻在内容流末尾，提交后给出明确结果区。',
  board: '卡片板：两列或单列卡片，每张卡片承载一条记录，卡片之间留 12px 间距；用柔和的底色区分状态，不做阴影堆叠。',
}

/** 端侧能力组说明：直接来自连接器的真实能力，不在这里另编名字 */
function deviceGroupPrompt(): string {
  return DEVICE_GROUP_ORDER.map(
    (group) => `- ${group}（${DEVICE_GROUPS[group].title}）：${DEVICE_GROUPS[group].prompt}`,
  ).join('\n')
}

function buildSystemPrompt(): string {
  return `你是「AI应用门户」的应用生成器，为一个完全没有编程经验的用户生成一个可直接运行的单文件网页工具。
你只输出一个 JSON 对象，不要输出 Markdown 代码围栏、不要解释、不要输出 JSON 以外的任何文字。

JSON 结构（字段必须齐全）：
{
  "name": "4 到 10 个汉字的工具名",
  "emoji": "一个最贴切的 emoji",
  "description": "一句话说明，20 字以内",
  "permission_card": {
    "can": ["这个工具能做什么，白话，2 到 4 条"],
    "cannot": ["它不能做什么，白话，2 到 3 条"],
    "why": "为什么需要声明的能力，白话，一到两句"
  },
  "capabilities": {
    "storage": true 或 false,
    "llm": true 或 false,
    "network": ["需要访问的主机名，不含协议，如 api.example.com；不联网就是空数组"],
    "clipboard": true 或 false,
    "files": true 或 false,
    "bluetooth": true 或 false,
    "record": true 或 false,
    "camera": true 或 false,
    "location": true 或 false,
    "notifications": true 或 false,
    "triggers": true 或 false,
    "device": []
  },
  "notes": ["你实现时做的 3 到 5 个关键决定，白话，每条 20 字以内"],
  "html": "完整 HTML 文档字符串"
}

界面的硬性要求：
1. 移动端优先，适配 360 到 430px 宽；正文 16px，按钮至少 44px 高，页面左右留白 16px。
2. 简体中文界面。所有状态齐全：加载中、空数据、出错都有明确提示。
3. 视觉干净克制：一层卡片或分组列表即可，不要卡片套卡片、不要重阴影、不要渐变堆叠。颜色用一个主色 + 中性灰，主色不要用默认蓝紫。
4. 图标用 emoji 或内联 SVG，不使用外部图片。

代码的硬性要求：
1. html 必须是完整文档：以 <!doctype html> 开头，包含 html / head / body；所有 CSS 与 JS 内联。
2. 禁止任何外部资源：不得出现外部 CDN、字体、图片、脚本链接。需要库时用原生 JS 实现。
3. 持久化只能使用 window.portal.storage 的 get / set / remove / keys（都返回 Promise）。禁止 localStorage / sessionStorage / indexedDB。启动时先读取再渲染；数据变化后延时 300ms 保存。
4. 需要 AI 时调用 window.portal.llm.chat(messages)，返回 { content }；messages 形如 [{ role: 'user', content: '...' }]。必须在 capabilities.llm 填 true。没有配置模型时要给用户可读的提示，不要静默失败。
5. 需要联网时只能调用 window.portal.network.fetch(url, init)，返回 { ok, status, headers, body }；禁止直接使用 fetch / XMLHttpRequest。所有会访问的主机名必须写进 capabilities.network。
5.1 剪贴板：window.portal.clipboard.read() / write(text)，需 capabilities.clipboard。
5.2 文件：window.portal.files.pick({ count }) 返回 { files: [{ name, path, size, type }] }；window.portal.files.download(url, { header }) 下载 https 文件，需 capabilities.files。下载地址的主机也必须写进 capabilities.network。
5.3 蓝牙：window.portal.bluetooth.call(method, params)，method 用小程序的 BLE 接口名（openBluetoothAdapter / startBluetoothDevicesDiscovery / getBluetoothDevices / createBLEConnection / getBLEDeviceServices / getBLEDeviceCharacteristics / readBLECharacteristicValue / writeBLECharacteristicValue / notifyBLECharacteristicValueChange 等）；设备发现等事件用 window.portal.on('bluetoothDeviceFound', fn)，需 capabilities.bluetooth。
5.4 录音：window.portal.record.start({ duration }) 开始，window.portal.record.stop() 返回 { tempFilePath, duration, size }，也可用 window.portal.on('recordAudioStop', fn)，需 capabilities.record。
5.5 相机：window.portal.camera.capture() 返回 { tempFilePaths, tempFiles }；window.portal.camera.recordVideo({ maxDuration }) 返回视频信息。返回的是可直接放进 img / video 的 https 虚拟地址，需 capabilities.camera。
5.6 定位：window.portal.location.get({ isHighAccuracy }) 返回 { latitude, longitude, accuracy, ... }，需 capabilities.location。
5.7 端侧设备能力：window.portal.device.call(能力名, 参数对象) 返回设备结果（对象或字符串）。调用前可用 await window.portal.device.available() 判断当前环境是否有设备桥；不可用时给出「浏览器预览不能使用设备能力，请在手机上打开」的提示，并提供重新加载或重试入口。只能调用下面列出的能力名，不得编造；用到的能力组必须写进 capabilities.device。调用可能失败（用户拒绝、设备服务不可用），必须 catch 并用白话提示 + 重试按钮，不要静默失败。
【端侧能力组清单】
${deviceGroupPrompt()}
5.8 提醒与触发器：
- 提醒：window.portal.notify({ title, body }) 在门户顶部弹横幅，需 capabilities.notifications。它不是系统通知栏推送，门户关闭时无法送达，界面上要如实说明。
- 触发器注册：window.portal.triggers.register({ name, schedule, location, action })，需 capabilities.triggers。
  · 时间条件 schedule 三选一：{ type: 'once', at: 时间戳 } / { type: 'daily', hour: 0-23, minute: 0-59 } / { type: 'interval', everyMinutes: 1-1440 }。
  · 位置条件 location: { latitude, longitude, radiusMeters: 50-50000, mode: 'enter' | 'leave' }，还需 capabilities.location。
  · action: { notify: { title, body }, vibrate: true, run: true }，至少要有 notify 或 run。
  · 注册后可用 window.portal.triggers.list() / window.portal.triggers.remove(id) / window.portal.triggers.setEnabled(id, enabled) 管理。
- 触发时应用会收到事件：window.portal.on('trigger', function (event) { ... })，event 含 triggerId / name / at / action；在这里更新应用自己的数据或界面，也可以调用应用已声明的其它能力（天气、语音播报、震动等）。应用没运行时，事件会在下次打开后补发。
- 触发器只在门户打开时检查，关闭门户后不会在后台执行；不要在界面上承诺系统级定时或系统通知。
- 通知偏好与触发器开关由门户的「应用设置」页统一管理，应用不需要自己再做一套通知设置；应用自己的其它配置用 portal.storage 保存。
6. 用 window.portal.log('info' | 'warn' | 'error', message, data) 记录关键行为与错误。
7. 不要写死演示数据、不要 TODO、不要占位符。第一次打开就是可用空态，用户能立刻开始输入。
8. 不要打开新窗口、不要用 iframe、不要申请系统权限。
9. 代码里写少量中文注释，帮助用户日后看懂。
10. 用户通常只写一句需求。没提到的细节由你自己做合理判断：默认选择更少权限、更少联网、更简单的实现；不要反问用户，也不要输出需求确认问题。
11. 剪贴板、文件、蓝牙、录音、相机、定位、通知、触发器以及 capabilities.device 里的端侧能力组都是敏感能力，只有需求里确实要用到时才声明，否则一律不要出现。
12. 打开其它应用、修改系统设置、上传文件、打开快记录音这些操作会影响手机本身；只能在用户明确要求时调用，不要自作主张。

当前技术形态：${STYLE_GUIDE.list}
${STYLE_GUIDE.form}
${STYLE_GUIDE.board}
按用户消息里「界面风格」指定的那一种生成，不要混用三种。`
}

function styleLine(style: AppStyle): string {
  return STYLE_GUIDE[style]
}

function buildGenerateMessages(app: PortalApp): ChatMessage[] {
  const requirements = app.requirements
  const plan = app.plan
  const capabilities = plan.capabilities

  const text = `请为下面这个需求生成应用。

【用户原话】
${requirements.brief}

【生成器自己做的判断（按此实现）】
- 核心功能：${requirements.core}
- 数据生命周期：${requirements.lifetime === 'persistent' ? '长期保存，下次打开继续用' : '一次性，用完即弃'}
- 数据安排：${requirements.data_draft}
- 输入方式：${requirements.inputs.join('、')}
- 结果用途：${requirements.outputs.join('、')}
- 使用环境：${requirements.environment === 'online' ? '需要联网' : '可离线使用'}
- 形态：单文件网页应用
- 数据方案：${plan.data === 'kv' ? '使用 portal.storage 本地键值保存' : '不持久化'}
- 界面风格：${styleLine(plan.style)}
- 能力开关：storage=${capabilities.storage}，llm=${capabilities.llm}，notifications=${capabilities.notifications === true}，triggers=${capabilities.triggers === true}，network=${JSON.stringify(capabilities.network)}，device=${JSON.stringify(capabilities.device ?? [])}
${capabilities.network.length === 0 ? '- 不要发起任何网络请求。' : `- 只能访问这些主机：${capabilities.network.join('、')}。`}
${capabilities.llm ? '- 需要 AI 时调用 window.portal.llm.chat。' : '- 不要调用 AI。'}

如果需求里有没写清楚的地方，按上面的判断补全，不要反问。
请直接输出 JSON。`

  const parts: ChatContentPart[] = [{ type: 'text', text }]
  for (const attachment of requirements.attachments ?? []) {
    if (attachment.kind === 'image') {
      parts.push({ type: 'image_url', image_url: { url: attachment.content } })
    } else {
      parts.push({
        type: 'text',
        text: `【用户附件：${attachment.name}】\n${attachment.content}`,
      })
    }
  }

  return [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: parts.length === 1 ? text : parts },
  ]
}

function buildRepairMessages(
  html: string,
  issues: string[],
): ChatMessage[] {
  return [
    { role: 'system', content: buildSystemPrompt() },
    {
      role: 'user',
      content: `下面这个应用在自检时发现问题，请修复后重新输出完整 JSON（保持 name / emoji / description / permission_card / capabilities 基本不变）。

【自检发现的问题】
${issues.map((issue, index) => `${index + 1}. ${issue}`).join('\n')}

【当前完整 HTML】
${html}

只输出 JSON。`,
    },
  ]
}

function buildReviseMessages(
  app: PortalApp,
  request: string,
  attachments: RequirementAttachment[] = [],
): ChatMessage[] {
  const text = `这是用户已经验收中的工具，现在要按反馈修改。请输出修改后的完整 JSON（html 必须是完整文档，其余字段可随改动更新）。

【工具名】${app.name}
【原始需求】${app.requirements.brief}
【当前方案】${app.plan.reasoning}
【用户的修改意见】${request}

【当前完整 HTML】
${app.html}

只输出 JSON。`

  const parts: ChatContentPart[] = [{ type: 'text', text }]
  for (const attachment of attachments) {
    if (attachment.kind === 'image') {
      parts.push({ type: 'image_url', image_url: { url: attachment.content } })
    } else {
      parts.push({
        type: 'text',
        text: `【用户附件：${attachment.name}】\n${attachment.content}`,
      })
    }
  }

  return [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: parts.length === 1 ? text : parts },
  ]
}

/* ------------------------------------------------------------------ *
 * 解析与检查
 * ------------------------------------------------------------------ */

interface GeneratedPayload {
  name: string
  emoji: string
  description: string
  permission_card: PermissionCard
  capabilities: AppCapabilities
  notes: string[]
  html: string
}

function stripFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return fenced ? fenced[1].trim() : trimmed
}

function tryParseJson(text: string): unknown {
  const cleaned = stripFence(text)
  try {
    return JSON.parse(cleaned)
  } catch {
    // 常见修复：尾逗号、中文引号
    const repaired = cleaned
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/[“”]/g, '"')
    return JSON.parse(repaired)
  }
}

function parseList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  const items = value.map((item) => String(item).trim()).filter(Boolean)
  return items.length > 0 ? items.slice(0, 8) : fallback
}

export function parseGeneratedPayload(text: string): GeneratedPayload {
  let raw: unknown
  try {
    raw = tryParseJson(text)
  } catch {
    // 模型有时在 JSON 前后夹带解释：从第一个 { 截到最后一个 }
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        raw = JSON.parse(text.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1'))
      } catch {
        throw new Error('模型输出的格式无法解析，请重试')
      }
    } else {
      throw new Error('模型没有按要求返回 JSON，请重试')
    }
  }

  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const html = String(record.html ?? '').trim()
  if (!html || html.length < 40) throw new Error('模型没有返回完整的应用代码，请重试')

  const permissionRaw =
    record.permission_card && typeof record.permission_card === 'object'
      ? (record.permission_card as Record<string, unknown>)
      : {}
  const capabilitiesRaw =
    record.capabilities && typeof record.capabilities === 'object'
      ? (record.capabilities as Record<string, unknown>)
      : {}
  const networkRaw = capabilitiesRaw.network

  const deviceRaw = capabilitiesRaw.device

  const capabilities: AppCapabilities = {
    storage: capabilitiesRaw.storage === true,
    llm: capabilitiesRaw.llm === true,
    network: Array.isArray(networkRaw) ? normalizeHosts(networkRaw.map(String)) : [],
    clipboard: capabilitiesRaw.clipboard === true,
    files: capabilitiesRaw.files === true,
    bluetooth: capabilitiesRaw.bluetooth === true,
    record: capabilitiesRaw.record === true,
    camera: capabilitiesRaw.camera === true,
    location: capabilitiesRaw.location === true,
    notifications: capabilitiesRaw.notifications === true,
    triggers: capabilitiesRaw.triggers === true,
    device: Array.isArray(deviceRaw)
      ? Array.from(
          new Set(
            deviceRaw
              .map(String)
              .filter((item): item is DeviceAbilityGroup => isDeviceGroup(item)),
          ),
        )
      : undefined,
    python: false,
  }

  const permission_card: PermissionCard = {
    can: parseList(permissionRaw.can, ['按你的需求处理内容']),
    cannot: parseList(permissionRaw.cannot, ['不访问你的其它应用与系统权限']),
    why: String(permissionRaw.why ?? '所有数据只保存在本机。').slice(0, 300),
  }

  return {
    name: String(record.name ?? '未命名工具').trim().slice(0, 20) || '未命名工具',
    emoji: String(record.emoji ?? '🧩').trim().slice(0, 8) || '🧩',
    description: String(record.description ?? '').trim().slice(0, 80) || '按你的需求生成的小工具',
    permission_card,
    capabilities,
    notes: Array.isArray(record.notes)
      ? record.notes.map((item) => String(item).trim()).filter(Boolean).slice(0, 6)
      : [],
    html,
  }
}

export interface StaticIssue {
  level: 'error' | 'warn'
  message: string
}

/** 静态检查：外链、禁用 API、白名单一致性 */
export function inspectHtml(html: string, capabilities: AppCapabilities): StaticIssue[] {
  const issues: StaticIssue[] = []

  if (!/<html[\s>]/i.test(html)) {
    issues.push({ level: 'error', message: '缺少完整的 <html> 文档结构' })
  }
  if (!/<body[\s>]/i.test(html)) {
    issues.push({ level: 'error', message: '缺少 <body> 内容区' })
  }
  if (/<script[^>]+src\s*=\s*["']https?:/i.test(html)) {
    issues.push({ level: 'error', message: '引用了外部脚本，必须改为内联' })
  }
  if (/<(link|img|iframe)[^>]+(href|src)\s*=\s*["']https?:/i.test(html)) {
    issues.push({ level: 'error', message: '引用了外部图片 / 样式 / 页面，必须全部本地化或内联' })
  }
  if (/<a[^>]+href\s*=\s*["']https?:/i.test(html)) {
    issues.push({ level: 'error', message: '应用里包含外部链接，点了会把页面带走；请改成文字或去掉链接' })
  }
  if (/@import\s+url\(\s*["']?https?:/i.test(html)) {
    issues.push({ level: 'error', message: '样式里引用了外部字体或资源' })
  }
  if (/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/i.test(html)) {
    issues.push({ level: 'error', message: '使用了 localStorage / sessionStorage / indexedDB，必须改用 window.portal.storage' })
  }
  if (/(^|[^.\w])fetch\s*\(/.test(html.replace(/portal\.network\.fetch\s*\(/g, ''))) {
    issues.push({ level: 'error', message: '直接使用了 fetch，必须改为 window.portal.network.fetch' })
  }
  if (/\bXMLHttpRequest\b/.test(html)) {
    issues.push({ level: 'error', message: '使用了 XMLHttpRequest，必须改为 window.portal.network.fetch' })
  }
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) {
    issues.push({ level: 'warn', message: '缺少 viewport 声明，移动端会显示异常' })
  }
  if (capabilities.storage && !/portal\.storage/.test(html)) {
    issues.push({ level: 'warn', message: '声明了存储能力，但代码里没有使用 portal.storage' })
  }
  if (capabilities.llm && !/portal\.llm/.test(html)) {
    issues.push({ level: 'warn', message: '声明了 AI 能力，但代码里没有调用 portal.llm' })
  }
  if (/\bnew\s+Notification\b|\bNotification\s*\.\s*requestPermission\b/.test(html)) {
    issues.push({
      level: 'error',
      message: '沙箱里不能使用网页通知，请改用 window.portal.notify',
    })
  }
  if (capabilities.notifications && !/portal\.notify/.test(html)) {
    issues.push({ level: 'warn', message: '声明了通知能力，但代码里没有调用 portal.notify' })
  }
  if (capabilities.triggers && !/portal\.triggers/.test(html)) {
    issues.push({ level: 'warn', message: '声明了触发器能力，但代码里没有调用 portal.triggers' })
  }

  // 端侧能力：只能走 portal.device.call，且能力名必须在连接器清单里
  if (/\bwindow\s*\.\s*mcp\b|\bmcp\s*\.\s*callTool\b/.test(html)) {
    issues.push({
      level: 'error',
      message: '不能直接调用 window.mcp，必须使用 window.portal.device.call',
    })
  }

  const usedDeviceGroups = new Set<DeviceAbilityGroup>()
  const devicePattern = /portal\.device\.call\s*\(\s*['"`]([A-Za-z0-9_]+)['"`]/g
  let deviceMatch: RegExpExecArray | null
  while ((deviceMatch = devicePattern.exec(html)) !== null) {
    const name = deviceMatch[1]
    const meta = DEVICE_ABILITIES[name]
    if (!meta) {
      issues.push({ level: 'error', message: `调用了不存在的设备能力 ${name}，请改用清单里的能力名` })
      continue
    }
    if (isDeviceGroup(meta.capability)) {
      usedDeviceGroups.add(meta.capability)
      if (!capabilities.device?.includes(meta.capability)) {
        issues.push({
          level: 'error',
          message: `调用了 ${name}，但没有在 capabilities.device 里声明 ${meta.capability}`,
        })
      }
    } else if (meta.capability === 'clipboard' && !capabilities.clipboard) {
      issues.push({ level: 'error', message: `调用了 ${name}，但没有声明剪贴板能力` })
    } else if (meta.capability === 'location' && !capabilities.location) {
      issues.push({ level: 'error', message: `调用了 ${name}，但没有声明定位能力` })
    }
  }

  for (const group of capabilities.device ?? []) {
    const meta = DEVICE_GROUPS[group]
    if (!meta) continue
    if (!usedDeviceGroups.has(group)) {
      issues.push({
        level: 'warn',
        message: `声明了「${meta.title}」，但代码里没有调用对应的设备能力`,
      })
    }
  }

  // 只检查真正发起网络请求的调用（正文里提到网址不算），
  // 运行时白名单代理会兜住变量拼接等静态检查看不到的情况。
  const hosts = new Set<string>()
  const callPattern = /portal\.network\.fetch\s*\(\s*['"`](https?:\/\/([^/'"`\s:]+))/gi
  let match: RegExpExecArray | null
  while ((match = callPattern.exec(html)) !== null) {
    hosts.add(match[2].toLowerCase())
  }
  for (const host of hosts) {
    if (host === 'www.w3.org') continue
    if (!capabilities.network.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
      issues.push({ level: 'error', message: `代码里访问了未声明的域名 ${host}，需要加入联网白名单或删除` })
    }
  }

  if (html.length > 400_000) {
    issues.push({ level: 'warn', message: '应用体积偏大，可能影响加载速度' })
  }

  return issues
}

function mergeIssues(staticIssues: StaticIssue[], runtime: RuntimeIssue[]): StaticIssue[] {
  return [
    ...staticIssues,
    ...runtime.map((issue) => ({ level: issue.level, message: `运行时：${issue.message}` })),
  ]
}

/* ------------------------------------------------------------------ *
 * 任务状态（模块级，切换 Tab 后仍继续）
 * ------------------------------------------------------------------ */

const jobs = new Map<string, GenerationJob>()
/** 正在进行的模型请求：取消时真正中断，而不是只打一个「已取消」标记 */
const abortControllers = new Map<string, AbortController>()
const listeners = new Map<string, Set<(job: GenerationJob) => void>>()

function emit(appId: string): void {
  const job = jobs.get(appId)
  if (!job) return
  for (const listener of listeners.get(appId) ?? []) listener({ ...job })
}

function patchJob(appId: string, patch: Partial<GenerationJob>): void {
  const current = jobs.get(appId)
  if (!current) return
  jobs.set(appId, { ...current, ...patch })
  emit(appId)
}

/**
 * 生成期间的「活体信号」：模型长时间没有输出时，标题也会随状态变化，
 * 让用户知道应用还在工作，而不是看起来卡死。
 */
function startHeartbeat(appId: string): () => void {
  const timer = setInterval(() => {
    const job = jobs.get(appId)
    if (!job) return
    if (!['preparing', 'generating', 'checking', 'repairing'].includes(job.phase)) return
    const message =
      job.phase === 'checking' || job.phase === 'repairing'
        ? job.message
        : job.thinking
          ? '模型正在思考'
          : job.live
            ? '模型正在写代码'
            : job.message
    if (message !== job.message) patchJob(appId, { message })
  }, 4000)
  return () => clearInterval(timer)
}

function pushTrace(appId: string, kind: JobTrace['kind'], text: string): void {
  const current = jobs.get(appId)
  if (!current) return
  const trace: JobTrace = { id: uid('tr_'), at: now(), kind, text }
  const traces = [...(current.traces ?? []), trace].slice(-80)
  // 同时记到当前步骤的细节里：用户点开某一步就能看到那一步发生了什么
  const hasActive = current.steps.some((step) => step.status === 'active')
  const steps = current.steps.map((step, index) => {
    const target = step.status === 'active' || (!hasActive && index === current.steps.length - 1)
    if (!target) return step
    return { ...step, logs: [...step.logs, trace].slice(-60) }
  })
  jobs.set(appId, { ...current, traces, steps })
  emit(appId)
}

/** 初始化任务规划：第一步自动激活，其余等待 */
function setSteps(
  appId: string,
  defs: Array<{ id: string; title: string; detail?: string }>,
): void {
  const current = jobs.get(appId)
  if (!current) return
  const steps: JobStep[] = defs.map((def, index) => ({
    ...def,
    status: index === 0 ? 'active' : 'pending',
    startedAt: index === 0 ? now() : undefined,
    logs: [],
  }))
  jobs.set(appId, { ...current, steps })
  emit(appId)
}

/** 进入下一步：之前的 active 步骤自动标记完成 */
function activateStep(appId: string, stepId: string): void {
  const current = jobs.get(appId)
  if (!current) return
  const steps = current.steps.map((step) => {
    if (step.id === stepId) {
      return step.status === 'active'
        ? step
        : { ...step, status: 'active' as const, startedAt: step.startedAt ?? now() }
    }
    if (step.status === 'active') {
      return { ...step, status: 'done' as const, finishedAt: now() }
    }
    return step
  })
  jobs.set(appId, { ...current, steps })
  emit(appId)
}

function completeStep(
  appId: string,
  stepId: string,
  status: 'done' | 'warn' | 'error' = 'done',
): void {
  const current = jobs.get(appId)
  if (!current) return
  const steps = current.steps.map((step) =>
    step.id === stepId ? { ...step, status, finishedAt: now() } : step,
  )
  jobs.set(appId, { ...current, steps })
  emit(appId)
}

export function getJob(appId: string): GenerationJob | undefined {
  const job = jobs.get(appId)
  return job ? { ...job } : undefined
}

export function subscribeJob(appId: string, listener: (job: GenerationJob) => void): () => void {
  if (!listeners.has(appId)) listeners.set(appId, new Set())
  listeners.get(appId)?.add(listener)
  return () => {
    listeners.get(appId)?.delete(listener)
  }
}

export function cancelJob(appId: string): void {
  const job = jobs.get(appId)
  if (!job) return
  // 先中断在途请求，再改状态：避免用户取消后请求跑完、继续计费
  abortControllers.get(appId)?.abort()
  patchJob(appId, { cancelled: true, phase: 'cancelled', message: '已取消' })
}

class CancelledError extends Error {
  constructor() {
    super('已取消')
  }
}

function ensureNotCancelled(appId: string): void {
  if (jobs.get(appId)?.cancelled) throw new CancelledError()
}

async function recordUsage(
  app: PortalApp,
  kind: 'generate' | 'repair' | 'summarize' | 'app-call',
  model: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  await addUsage({
    id: uid('u_'),
    appId: app.id,
    appName: app.name,
    kind,
    model,
    inputTokens,
    outputTokens,
    at: now(),
  })
}

function buildManifest(
  app: PortalApp,
  payload: GeneratedPayload,
  model: string,
  turns: number,
): PortalApp['manifest'] {
  return {
    id: app.id,
    name: payload.name,
    emoji: payload.emoji,
    version: incrementVersion(app.manifest?.version ?? '1.0.0'),
    entry: 'app/index.html',
    capabilities: payload.capabilities,
    permission_card: payload.permission_card,
    generated: {
      at: now(),
      model,
      turns,
    },
  }
}

function incrementVersion(version: string): string {
  const parts = version.split('.').map((item) => Number.parseInt(item, 10) || 0)
  while (parts.length < 3) parts.push(0)
  parts[2] += 1
  return parts.join('.')
}

/**
 * 优先流式调用：逐字把模型输出推给界面；环境不支持流式（跨域 / 壳限制）时
 * 回退到非流式请求，并在时间线里说明。
 */
async function runStreamingChat(
  appId: string,
  messages: ChatMessage[],
  settings: LlmSettings,
): Promise<Awaited<ReturnType<typeof chat>>> {
  let live = ''
  let thinking = ''
  let lastPush = 0
  let lastThinkPush = 0
  let received = false
  const controller = new AbortController()
  abortControllers.set(appId, controller)
  try {
    const result = await chatStream(
      messages,
      (delta) => {
        received = true
        live += delta
        const stamp = Date.now()
        if (stamp - lastPush >= 80) {
          lastPush = stamp
          patchJob(appId, { live: live.slice(-6000), streaming: true })
        }
      },
      {
        settings,
        model: settings.model,
        signal: controller.signal,
        // 推理模型的思考过程：让用户看到模型在做什么，而不是干等
        onReasoning: (delta) => {
          received = true
          thinking += delta
          const stamp = Date.now()
          if (stamp - lastThinkPush >= 120) {
            lastThinkPush = stamp
            patchJob(appId, { thinking: thinking.slice(-5000), streaming: true })
          }
        },
      },
    )
    patchJob(appId, { live: '', thinking: undefined, streaming: false })
    return result
  } catch (error) {
    patchJob(appId, { live: '', streaming: false })
    // 用户主动取消：不重试、不回退
    if (controller.signal.aborted) throw new CancelledError()
    // 已经收到部分内容时不再回退重发，避免同一个请求计费两次
    if (received) throw error
    if (error instanceof LlmError && error.kind !== 'network' && error.kind !== 'bad-response') {
      throw error
    }
    patchJob(appId, {
      phase: 'generating',
      message: '模型服务不支持逐字显示，正在等完整结果（通常 1–2 分钟）',
      thinking: undefined,
    })
    pushTrace(
      appId,
      'warn',
      '这个环境不能逐字显示（模型服务没有开放跨域流式），正在等待完整结果，可能要几十秒到两分钟',
    )
    return chat(messages, { settings, model: settings.model, signal: controller.signal })
  } finally {
    if (abortControllers.get(appId) === controller) abortControllers.delete(appId)
  }
}

/* ------------------------------------------------------------------ *
 * 生成 / 修复主流程
 * ------------------------------------------------------------------ */

const MAX_REPAIR_ROUNDS = 3

async function checkAndRepair(
  app: PortalApp,
  payload: GeneratedPayload,
  settings: LlmSettings,
): Promise<{ payload: GeneratedPayload; warnings: string[]; turns: number }> {
  let current = payload
  let turns = 1
  let warnings: string[] = []

  for (let round = 0; round <= MAX_REPAIR_ROUNDS; round += 1) {
    ensureNotCancelled(app.id)
    patchJob(app.id, {
      phase: round === 0 ? 'checking' : 'repairing',
      progress: round === 0 ? 58 : 66 + round * 8,
      message: round === 0 ? '正在检查应用' : `第 ${round} 轮修复`,
      repairRound: round,
    })

    activateStep(app.id, 'check')
    pushTrace(
      app.id,
      'act',
      round === 0
        ? '开始检查：外部依赖、存储方式、能力声明、移动端适配'
        : `第 ${round} 轮检查，看刚才的修复有没有生效`,
    )
    const staticIssues = inspectHtml(current.html, current.capabilities)
    const runtimeIssues = await runSandboxProbe(current.html)
    const all = mergeIssues(staticIssues, runtimeIssues)
    const blocking = all.filter((issue) => issue.level === 'error')
    warnings = all.filter((issue) => issue.level === 'warn').map((issue) => issue.message)

    if (blocking.length === 0) {
      for (const warning of warnings.slice(0, 3)) {
        pushTrace(app.id, 'warn', `提醒：${warning}`)
      }
      pushTrace(app.id, 'ok', '检查通过：代码里没有外部依赖，能力声明和实际调用一致')
      pushTrace(app.id, 'ok', '离屏跑了一遍：没有脚本报错')
      return { payload: current, warnings, turns }
    }

    for (const issue of blocking.slice(0, 3)) {
      pushTrace(app.id, 'error', `发现问题：${issue.message}`)
    }
    if (round === MAX_REPAIR_ROUNDS) {
      throw new Error(`自检未通过：${blocking.map((issue) => issue.message).join('；')}`)
    }

    ensureNotCancelled(app.id)
    patchJob(app.id, {
      phase: 'repairing',
      progress: 66 + round * 8,
      message: `正在修复：${blocking[0].message}`,
      repairRound: round + 1,
    })

    pushTrace(app.id, 'act', '把问题反馈给模型，让它修')
    const result = await runStreamingChat(
      app.id,
      buildRepairMessages(current.html, blocking.map((issue) => issue.message)),
      settings,
    )
    await recordUsage(app, 'repair', result.model, result.inputTokens, result.outputTokens)
    ensureNotCancelled(app.id)

    current = parseGeneratedPayload(result.content)
    pushTrace(app.id, 'ok', `第 ${round + 1} 轮修复完成，重新检查`)
    turns += 1
  }

  return { payload: current, warnings, turns }
}

/** 开始生成。返回时应用已写入数据库（status 仍是 draft，等待验收）。 */
export async function startGeneration(appId: string): Promise<void> {
  const existing = jobs.get(appId)
  if (existing && ['preparing', 'generating', 'checking', 'repairing', 'saving'].includes(existing.phase)) {
    return
  }

  const app = await getApp(appId)
  if (!app) throw new Error('找不到这个应用')

  jobs.set(appId, {
    appId,
    phase: 'preparing',
    progress: 4,
    message: '正在整理需求',
    repairRound: 0,
    startedAt: now(),
    cancelled: false,
    traces: [],
    steps: [],
  })
  emit(appId)

  const stopHeartbeat = startHeartbeat(appId)
  try {
    const settings = await readLlmSettings()
    const messages = buildGenerateMessages(app)

    setSteps(appId, [
      { id: 'understand', title: '理解需求' },
      { id: 'plan', title: '确定方案', detail: '数据怎么存、要不要联网、界面结构' },
      { id: 'write', title: '写代码', detail: '模型输出完整的单文件应用' },
      { id: 'check', title: '检查与修复', detail: '静态检查 + 离屏运行' },
      { id: 'save', title: '保存应用' },
    ])
    pushTrace(appId, 'think', `先理解一下：${app.requirements.brief}`)
    activateStep(appId, 'plan')
    pushTrace(
      appId,
      'think',
      app.plan.data === 'kv'
        ? '判断：内容要留下来，用应用自己的本地存储，数据只在这台设备上'
        : '判断：一次性使用，不保存历史',
    )
    pushTrace(
      appId,
      'think',
      `能力：${app.plan.capabilities.llm ? '需要 AI' : '不用 AI'} · ${
        app.plan.capabilities.network.length > 0
          ? `联网访问 ${app.plan.capabilities.network.join('、')}`
          : '不联网'
      }`,
    )
    pushTrace(
      appId,
      'think',
      `界面结构：${app.plan.style === 'form' ? '表单型' : app.plan.style === 'board' ? '卡片板' : '清单型'}`,
    )
    pushTrace(appId, 'act', '把需求整理成生成指令，交给模型')
    activateStep(appId, 'write')

    patchJob(appId, { phase: 'generating', progress: 24, message: '正在写出应用' })
    ensureNotCancelled(appId)

    pushTrace(appId, 'act', '模型正在写代码')
    const result = await runStreamingChat(appId, messages, settings)
    await recordUsage(app, 'generate', result.model, result.inputTokens, result.outputTokens)
    ensureNotCancelled(appId)

    const parsed = parseGeneratedPayload(result.content)
    pushTrace(
      appId,
      'ok',
      `写完了：约 ${Math.round(parsed.html.length / 1024)} KB、${parsed.html.split('\n').length} 行`,
    )
    for (const note of parsed.notes) pushTrace(appId, 'think', note)

    patchJob(appId, { phase: 'checking', progress: 52, message: '正在检查应用' })
    const checked = await checkAndRepair(app, parsed, settings)
    ensureNotCancelled(appId)

    activateStep(appId, 'save')
    pushTrace(appId, 'act', '保存应用与权限卡')
    patchJob(appId, { phase: 'saving', progress: 94, message: '正在保存' })
    completeStep(appId, 'save')
    const latest = (await getApp(appId)) ?? app
    const manifest = buildManifest(latest, checked.payload, settings.model, checked.turns)
    const saved: PortalApp = {
      ...latest,
      name: checked.payload.name,
      emoji: checked.payload.emoji,
      description: checked.payload.description,
      html: checked.payload.html,
      manifest,
      // 附件里的图片是 base64，生成完就没用了，清掉避免长期占空间
      requirements: { ...latest.requirements, attachments: undefined },
      generationSteps: jobs.get(appId)?.steps,
      // 生成完成即视为正式应用：没有单独的「定稿」步骤，随时可以继续开发
      plan: latest.plan,
      status: 'installed',
      step: 'review',
      turns: latest.turns + checked.turns,
      updatedAt: now(),
    }
    await saveApp(saved)
    pushTrace(appId, 'ok', '做好了，可以试用')
    patchJob(appId, {
      phase: 'done',
      progress: 100,
      message: checked.warnings.length > 0 ? '已生成，有少量提醒' : '已生成',
      finishedAt: now(),
    })
  } catch (error) {
    const cancelled = error instanceof CancelledError || jobs.get(appId)?.cancelled
    pushTrace(appId, 'error', cancelled ? '已取消这次生成' : `没做成：${(error as Error).message}`)
    const activeStep = jobs.get(appId)?.steps.find((step) => step.status === 'active')
    if (activeStep) completeStep(appId, activeStep.id, cancelled ? 'warn' : 'error')
    patchJob(appId, {
      phase: cancelled ? 'cancelled' : 'failed',
      progress: 100,
      message: cancelled ? '已取消' : '生成失败',
      error: cancelled ? undefined : (error as Error).message,
      finishedAt: now(),
    })
    if (!cancelled) throw error
  } finally {
    stopHeartbeat()
  }
}

/** 验收阶段的自然语言修改 */
export async function reviseApp(
  appId: string,
  request: string,
  attachments: RequirementAttachment[] = [],
): Promise<void> {
  const app = await getApp(appId)
  if (!app) throw new Error('找不到这个应用')
  if (!request.trim()) throw new Error('请先写下修改意见')

  jobs.set(appId, {
    appId,
    phase: 'generating',
    progress: 20,
    message: '正在修改',
    repairRound: 0,
    startedAt: now(),
    cancelled: false,
    traces: [],
    steps: [],
  })
  emit(appId)

  const stopHeartbeat = startHeartbeat(appId)
  try {
    setSteps(appId, [
      { id: 'read', title: '理解修改意见' },
      { id: 'write', title: '改代码', detail: '模型按意见更新应用' },
      { id: 'check', title: '检查与修复', detail: '静态检查 + 离屏运行' },
      { id: 'save', title: '保存修改' },
    ])
    pushTrace(appId, 'think', `收到修改意见：${request.trim()}`)
    const settings = await readLlmSettings()
    activateStep(appId, 'write')
    pushTrace(appId, 'act', '模型正在按意见改代码')
    const result = await runStreamingChat(
      appId,
      buildReviseMessages(app, request.trim(), attachments),
      settings,
    )
    await recordUsage(app, 'generate', result.model, result.inputTokens, result.outputTokens)
    ensureNotCancelled(appId)

    let parsed = parseGeneratedPayload(result.content)
    const summary = parsed.description
    pushTrace(appId, 'ok', `改完了：约 ${Math.round(parsed.html.length / 1024)} KB`)
    activateStep(appId, 'check')
    patchJob(appId, { phase: 'checking', progress: 55, message: '正在检查修改结果' })
    const checked = await checkAndRepair(app, parsed, settings)
    parsed = checked.payload
    ensureNotCancelled(appId)

    activateStep(appId, 'save')
    completeStep(appId, 'save')
    const latest = (await getApp(appId)) ?? app
    const manifest = buildManifest(latest, parsed, settings.model, latest.turns + checked.turns)
    const saved: PortalApp = {
      ...latest,
      name: parsed.name,
      emoji: parsed.emoji,
      description: parsed.description,
      html: parsed.html,
      manifest,
      requirements: { ...latest.requirements, attachments: undefined },
      plan: latest.plan,
      turns: latest.turns + checked.turns,
      updatedAt: now(),
      revisions: [
        ...latest.revisions,
        {
          at: now(),
          request: request.trim(),
          summary,
          steps: jobs.get(appId)?.steps,
          before_html: latest.html,
        },
      ].slice(-20),
    }
    await saveApp(saved)
    await addAudit({
      id: uid('au_'),
      appId: saved.id,
      appName: saved.name,
      kind: 'app.update',
      detail: `按反馈修改：${request.trim().slice(0, 80)}`,
      at: now(),
    })
    pushTrace(appId, 'ok', '修改完成，请再看一眼')
    patchJob(appId, {
      phase: 'done',
      progress: 100,
      message: '已更新，请再看一眼',
      finishedAt: now(),
    })
  } catch (error) {
    const cancelled = error instanceof CancelledError || jobs.get(appId)?.cancelled
    pushTrace(appId, 'error', cancelled ? '已取消这次修改' : `没改成：${(error as Error).message}`)
    const activeStep = jobs.get(appId)?.steps.find((step) => step.status === 'active')
    if (activeStep) completeStep(appId, activeStep.id, cancelled ? 'warn' : 'error')
    patchJob(appId, {
      phase: cancelled ? 'cancelled' : 'failed',
      progress: 100,
      message: cancelled ? '已取消' : '修改失败',
      error: cancelled ? undefined : (error as Error).message,
      finishedAt: now(),
    })
    if (!cancelled) throw error
  } finally {
    stopHeartbeat()
  }
}

/** 回滚到某一版修改之前 */
export async function rollbackRevision(appId: string, revisionIndex: number): Promise<void> {
  const app = await getApp(appId)
  if (!app) throw new Error('找不到这个应用')
  const revision = app.revisions[revisionIndex]
  if (!revision) throw new Error('找不到这一版记录')
  await saveApp({
    ...app,
    html: revision.before_html,
    updatedAt: now(),
    step: 'review',
  })
}
