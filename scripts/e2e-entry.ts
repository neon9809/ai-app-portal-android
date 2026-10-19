/**
 * 工程内 e2e 冒烟：在 Node 里跑通「需求推断 → 模型产物解析 → 静态检查 →
 * 沙箱能力调用 → 触发器 → 应用包往返」这条链路。
 *
 * 不依赖浏览器与真实模型：真实模型调用与 UI 点击需要在预览 / 真机上验证，
 * 这里覆盖的是决定行为正确性的纯逻辑与边界。
 *
 * 运行：npm run test:e2e
 */

import assert from 'node:assert/strict'

import {
  DEVICE_ABILITIES,
  DEVICE_GROUPS,
  DEVICE_GROUP_ORDER,
} from '@/shared/portal/device'
import { inferPlan, inspectHtml, parseGeneratedPayload } from '@/shared/portal/generator'
import { buildPackage, parsePackageBytes } from '@/shared/portal/package'
import {
  handleSandboxRequest,
  injectSandboxSdk,
  type SandboxContext,
} from '@/shared/portal/sandbox'
import { distanceMeters, isTimeDue, normalizeTrigger } from '@/shared/portal/triggers'
import type {
  AppCapabilities,
  AppRequirements,
  AppTrigger,
  PortalApp,
} from '@/shared/portal/types'

interface Outcome {
  name: string
  ok: boolean
  detail?: string
}

const outcomes: Outcome[] = []

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    outcomes.push({ name, ok: true })
  } catch (error) {
    outcomes.push({ name, ok: false, detail: (error as Error).message })
  }
}

function caps(patch: Partial<AppCapabilities> = {}): AppCapabilities {
  return { storage: false, llm: false, network: [], python: false, ...patch }
}

function requirements(brief: string): AppRequirements {
  return {
    brief,
    core: brief,
    lifetime: 'persistent',
    inputs: ['文字'],
    outputs: ['列表'],
    environment: 'offline',
    data_draft: '本机保存',
  }
}

function makeCtx(overrides: Partial<SandboxContext> = {}): SandboxContext {
  return {
    appId: 'a_e2e',
    appName: '端到端测试工具',
    capabilities: caps(),
    kv: {
      get: async (key: string) => (key === 'hello' ? 'world' : undefined),
      set: async () => undefined,
      remove: async () => undefined,
      keys: async () => ['hello'],
    },
    ensurePermission: async () => true,
    onLog: () => undefined,
    onNetworkBlocked: () => undefined,
    onLlmUsage: () => undefined,
    deviceAvailable: async () => true,
    callDevice: async () => ({ ok: true }),
    registerTrigger: async () => undefined,
    listAppTriggers: async () => [],
    removeTrigger: async () => undefined,
    setTriggerEnabled: async () => undefined,
    notify: async () => true,
    readAppSettings: async () => ({
      notifications: { enabled: true, banner: true, vibrate: false },
    }),
    ...overrides,
  }
}

function request(method: string, params: Record<string, unknown> = {}) {
  return { __aiPortal: 1 as const, id: 1, method, params }
}

const VALID_HTML = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><div id="app"></div><script>
window.portal.log('info', 'ready');
</script></body></html>`

function generatedJson(patch: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: '记账本',
    emoji: '📒',
    description: '记下每天的开销',
    permission_card: {
      can: ['记一笔开销', '按天汇总'],
      cannot: ['不联网', '不读取其它应用'],
      why: '数据只保存在本机。',
    },
    capabilities: {
      storage: true,
      llm: false,
      network: [],
      notifications: true,
      triggers: true,
      device: ['deviceApps', 'not-a-real-group'],
    },
    notes: ['本机保存'],
    html: VALID_HTML,
    ...patch,
  })
}

/* ------------------------------------------------------------------ *
 * 1. 需求推断
 * ------------------------------------------------------------------ */

await test('需求推断：提醒 + 语音播报会打开触发器 / 通知 / 语音能力', () => {
  const plan = inferPlan(requirements('每天 21 点提醒我记账，到点后语音播报'))
  assert.equal(plan.capabilities.triggers, true)
  assert.equal(plan.capabilities.notifications, true)
  assert.ok(plan.capabilities.device?.includes('deviceSpeech'))
})

await test('需求推断：普通换算工具不声明敏感能力', () => {
  const plan = inferPlan(requirements('把输入的金额换算成美元'))
  assert.equal(plan.capabilities.triggers, false)
  assert.equal(plan.capabilities.notifications, false)
  assert.equal(plan.capabilities.device, undefined)
  assert.equal(plan.capabilities.storage, true)
})

/* ------------------------------------------------------------------ *
 * 2. 模型产物解析与静态检查
 * ------------------------------------------------------------------ */

await test('模型产物解析：能力字段与非法设备组被规范化', () => {
  const parsed = parseGeneratedPayload(generatedJson())
  assert.equal(parsed.name, '记账本')
  assert.equal(parsed.capabilities.notifications, true)
  assert.equal(parsed.capabilities.triggers, true)
  assert.deepEqual(parsed.capabilities.device, ['deviceApps'])
  assert.ok(parsed.html.includes('window.portal.log'))
})

await test('模型产物解析：非 JSON 直接报可读错误', () => {
  assert.throws(() => parseGeneratedPayload('抱歉，我无法生成'), /JSON/)
})

await test('静态检查：合法应用没有 error', () => {
  const parsed = parseGeneratedPayload(generatedJson())
  const html = parsed.html.replace(
    "window.portal.log('info', 'ready')",
    "window.portal.triggers.register({ name: '每日提醒', schedule: { type: 'daily', hour: 21, minute: 0 }, action: { notify: { title: '该记账了' } } })",
  )
  const issues = inspectHtml(html, parsed.capabilities)
  const errors = issues.filter((item) => item.level === 'error')
  assert.deepEqual(errors, [])
})

await test('静态检查：外链 / localStorage / 网页通知 / 直连 mcp 都被拦截', () => {
  // 拼接出测试用的外链，避免被工程门禁当成真的外部资源引用
  const external = `${'https:'}//cdn.example.com/x.js`
  const cases = [
    `<script src="${external}"></script>`,
    'localStorage.setItem("a", "b")',
    "new Notification('提醒')",
    "window.mcp.callTool('open_app_by_name', {})",
  ]
  for (const snippet of cases) {
    const html = VALID_HTML.replace("<div id=\"app\"></div>", `<div id="app"></div>${snippet}`)
    const issues = inspectHtml(html, caps())
    assert.ok(
      issues.some((item) => item.level === 'error'),
      `没有拦截：${snippet}`,
    )
  }
  // MCP：调用 portal.mcp.call 却没声明 mcp 能力 → error；声明了但没调用 → warn
  const mcpCall = 'window.portal.mcp.call("get_time", {})'
  const undeclared = inspectHtml(
    VALID_HTML.replace('<div id="app"></div>', `<div id="app"></div>${mcpCall}`),
    caps(),
  )
  assert.ok(undeclared.some((item) => item.level === 'error' && item.message.includes('mcp')), '未声明的 portal.mcp.call 没有拦截')
  const declaredUnused = inspectHtml(VALID_HTML, caps({ mcp: ['get_time'] }))
  assert.ok(
    declaredUnused.some((item) => item.level === 'warn' && item.message.includes('mcp')),
    '声明了 mcp 但未调用应有 warn',
  )
})

await test('静态检查：编造的设备能力名被拦截', () => {
  const html = VALID_HTML.replace(
    "window.portal.log('info', 'ready')",
    "window.portal.device.call('make_me_a_sandwich', {})",
  )
  const issues = inspectHtml(html, caps({ device: ['deviceApps'] }))
  assert.ok(issues.some((item) => item.message.includes('不存在的设备能力')))
})

await test('静态检查：调用未声明的设备组被拦截', () => {
  const html = VALID_HTML.replace(
    "window.portal.log('info', 'ready')",
    "window.portal.device.call('open_app_by_name', { appName: '微信' })",
  )
  const issues = inspectHtml(html, caps())
  assert.ok(issues.some((item) => item.level === 'error' && item.message.includes('没有在 capabilities.device')))
})

/* ------------------------------------------------------------------ *
 * 3. 沙箱 SDK 与宿主能力分发
 * ------------------------------------------------------------------ */

await test('沙箱 SDK：注入设备、触发器、通知与设置入口，并且不允许直连网络', () => {
  const html = injectSandboxSdk(VALID_HTML, 'appassets.example.com')
  for (const marker of [
    'window.portal = portal',
    'device: {',
    'triggers: {',
    'notify: function',
    'settings: {',
  ]) {
    assert.ok(html.includes(marker), `SDK 缺少 ${marker}`)
  }
  assert.ok(html.includes("connect-src 'none'"))
})

await test('沙箱分发：storage.get 读取应用自己的键值', async () => {
  const ctx = makeCtx({ capabilities: caps({ storage: true }) })
  const value = await handleSandboxRequest(
    request('storage.get', { key: 'hello' }),
    ctx,
    async () => ({ content: '', inputTokens: 0, outputTokens: 0, model: 'test' }),
  )
  assert.equal(value, 'world')
})

await test('沙箱分发：用户拒绝授权时能力调用被拒绝', async () => {
  await assert.rejects(
    handleSandboxRequest(
      request('storage.get', { key: 'hello' }),
      makeCtx({ ensurePermission: async () => false }),
      async () => ({ content: '', inputTokens: 0, outputTokens: 0, model: 'test' }),
    ),
    /未授权/,
  )
})

await test('沙箱分发：浏览器没有设备桥时给出可读提示', async () => {
  const ctx = makeCtx({
    capabilities: caps({ device: ['deviceApps'] }),
    deviceAvailable: async () => false,
  })
  await assert.rejects(
    handleSandboxRequest(
      request('device.call', { name: 'open_app_by_name', args: { appName: '微信' } }),
      ctx,
      async () => ({ content: '', inputTokens: 0, outputTokens: 0, model: 'test' }),
    ),
    /浏览器预览/,
  )
})

await test('沙箱分发：编造的能力名与未声明的组都被拒绝', async () => {
  const llm = async () => ({ content: '', inputTokens: 0, outputTokens: 0, model: 'test' })
  await assert.rejects(
    handleSandboxRequest(
      request('device.call', { name: 'not_real', args: {} }),
      makeCtx({ capabilities: caps({ device: ['deviceApps'] }) }),
      llm,
    ),
    /不受支持/,
  )
  await assert.rejects(
    handleSandboxRequest(
      request('device.call', { name: 'open_app_by_name', args: {} }),
      makeCtx({ capabilities: caps() }),
      llm,
    ),
    /没有声明这项设备能力/,
  )
})

await test('沙箱分发：已授权设备能力会转发给设备桥', async () => {
  let called = ''
  const ctx = makeCtx({
    capabilities: caps({ device: ['deviceApps'] }),
    callDevice: async (name) => {
      called = name
      return { ok: true }
    },
  })
  const result = await handleSandboxRequest(
    request('device.call', { name: 'open_app_by_name', args: { appName: '微信' } }),
    ctx,
    async () => ({ content: '', inputTokens: 0, outputTokens: 0, model: 'test' }),
  )
  assert.equal(called, 'open_app_by_name')
  assert.deepEqual(result, { ok: true })
})

await test('沙箱分发：注册每日触发器并落库', async () => {
  let saved: AppTrigger | undefined
  const ctx = makeCtx({
    capabilities: caps({ triggers: true }),
    registerTrigger: async (trigger) => {
      saved = trigger
    },
  })
  const result = (await handleSandboxRequest(
    request('triggers.register', {
      trigger: {
        name: '每天记账',
        schedule: { type: 'daily', hour: 21, minute: 0 },
        action: { notify: { title: '该记账了' } },
      },
    }),
    ctx,
    async () => ({ content: '', inputTokens: 0, outputTokens: 0, model: 'test' }),
  )) as AppTrigger
  assert.equal(result.kind, 'time')
  assert.equal(result.schedule?.type, 'daily')
  assert.equal(saved?.id, result.id)
})

await test('沙箱分发：位置触发器缺少定位能力时拒绝', async () => {
  await assert.rejects(
    handleSandboxRequest(
      request('triggers.register', {
        trigger: {
          name: '到公司提醒',
          location: { latitude: 31.2, longitude: 121.4, radiusMeters: 300, mode: 'enter' },
          action: { notify: { title: '到公司了' } },
        },
      }),
      makeCtx({ capabilities: caps({ triggers: true }) }),
      async () => ({ content: '', inputTokens: 0, outputTokens: 0, model: 'test' }),
    ),
    /定位能力/,
  )
})

await test('沙箱分发：应用主动提醒走宿主，标题被规范化', async () => {
  let received: { title: string; body?: string } | undefined
  const ctx = makeCtx({
    capabilities: caps({ notifications: true }),
    notify: async (input) => {
      received = input
      return true
    },
  })
  const ok = await handleSandboxRequest(
    request('notify', { input: { title: '  今天  该记账了 ', body: '三笔支出' } }),
    ctx,
    async () => ({ content: '', inputTokens: 0, outputTokens: 0, model: 'test' }),
  )
  assert.equal(ok, true)
  assert.equal(received?.title, '今天 该记账了')
  assert.equal(received?.body, '三笔支出')
})

await test('沙箱分发：应用设置只读接口返回通知偏好', async () => {
  const value = (await handleSandboxRequest(
    request('settings.get'),
    makeCtx(),
    async () => ({ content: '', inputTokens: 0, outputTokens: 0, model: 'test' }),
  )) as { notifications: { enabled: boolean } }
  assert.equal(value.notifications.enabled, true)
})

/* ------------------------------------------------------------------ *
 * 4. 触发器纯逻辑
 * ------------------------------------------------------------------ */

await test('触发器：每日条件当天只触发一次，隔天恢复', () => {
  const trigger = normalizeTrigger(
    { id: 'a', name: 'A' },
    {
      name: '每日提醒',
      schedule: { type: 'daily', hour: 21, minute: 0 },
      action: { notify: { title: '到点了' } },
    },
  )
  const day1 = new Date(2026, 0, 1, 21, 0).getTime()
  assert.equal(isTimeDue(trigger, day1), true)
  assert.equal(isTimeDue({ ...trigger, state: { lastDay: '2026-1-1' } }, day1), false)
  const day2 = new Date(2026, 0, 2, 21, 0).getTime()
  assert.equal(isTimeDue({ ...trigger, state: { lastDay: '2026-1-1' } }, day2), true)
  const late = new Date(2026, 0, 2, 22, 0).getTime()
  assert.equal(isTimeDue(trigger, late), false, '超过 30 分钟不再补发')
})

await test('触发器：一次性与间隔条件', () => {
  const at = Date.now() + 60_000
  const once = normalizeTrigger(
    { id: 'a', name: 'A' },
    {
      name: '一次性',
      schedule: { type: 'once', at },
      action: { run: true },
    },
  )
  assert.equal(isTimeDue(once, at - 1), false)
  assert.equal(isTimeDue(once, at), true)

  const interval = normalizeTrigger(
    { id: 'a', name: 'A' },
    {
      name: '每 30 分钟',
      schedule: { type: 'interval', everyMinutes: 30 },
      action: { notify: { title: '喝水' } },
    },
  )
  assert.equal(isTimeDue(interval, interval.createdAt + 29 * 60_000), false)
  assert.equal(isTimeDue(interval, interval.createdAt + 30 * 60_000), true)
})

await test('触发器：非法参数被拒绝', () => {
  assert.throws(
    () =>
      normalizeTrigger(
        { id: 'a', name: 'A' },
        {
          name: '坏时间',
          schedule: { type: 'daily', hour: 24, minute: 0 },
          action: { notify: { title: 'x' } },
        },
      ),
    /0 到 23/,
  )
  assert.throws(
    () =>
      normalizeTrigger(
        { id: 'a', name: 'A' },
        {
          name: '坏范围',
          location: { latitude: 31, longitude: 121, radiusMeters: 10, mode: 'enter' },
          action: { notify: { title: 'x' } },
        },
      ),
    /50 到 50000/,
  )
})

await test('触发器：距离计算接近真实值', () => {
  const distance = distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })
  assert.ok(Math.abs(distance - 111_195) < 1_000, `实际 ${distance}`)
})

/* ------------------------------------------------------------------ *
 * 5. 应用包往返
 * ------------------------------------------------------------------ */

function makeApp(): PortalApp {
  const parsed = parseGeneratedPayload(generatedJson())
  const plan = inferPlan(requirements('每天提醒我记账'))
  return {
    id: 'a_e2e',
    name: parsed.name,
    emoji: parsed.emoji,
    description: parsed.description,
    html: parsed.html,
    manifest: {
      id: 'a_e2e',
      name: parsed.name,
      emoji: parsed.emoji,
      version: '1.0.0',
      entry: 'app/index.html',
      capabilities: parsed.capabilities,
      permission_card: parsed.permission_card,
      generated: { at: Date.now(), model: 'e2e', turns: 1 },
    },
    requirements: requirements('每天提醒我记账'),
    plan,
    status: 'installed',
    step: 'review',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastOpenedAt: 0,
    turns: 1,
    revisions: [],
  }
}

await test('应用包：导出再导入，源码与能力保持一致', () => {
  const app = makeApp()
  const { bytes, filename } = buildPackage(app)
  assert.ok(filename.endsWith('.neon-aap'))
  const pending = parsePackageBytes(bytes)
  assert.equal(pending.html, app.html)
  assert.equal(pending.manifest.name, app.name)
  assert.deepEqual(pending.manifest.capabilities.device, ['deviceApps'])
})

await test('应用包：损坏文件给出可读错误', () => {
  assert.throws(() => parsePackageBytes(new Uint8Array([1, 2, 3])), /无法解压/)
})

/* ------------------------------------------------------------------ *
 * 6. 能力清单完整性
 * ------------------------------------------------------------------ */

await test('能力清单：所有设备能力都指向已登记的 12 个连接器', () => {
  const connectors = new Set([
    'ic_atomic_473',
    'ic_atomic_468',
    'ic_atomic_495',
    'ic_atomic_472',
    'ic_atomic_990007',
    'ic_atomic_990002',
    'ic_atomic_990015',
    'ic_atomic_990012',
    'ic_atomic_990004',
    'ic_atomic_990003',
    'ic_atomic_503',
    'ic_atomic_491',
  ])
  for (const [name, meta] of Object.entries(DEVICE_ABILITIES)) {
    assert.ok(connectors.has(meta.connector), `${name} 指向未登记的连接器 ${meta.connector}`)
  }
})

await test('能力清单：每个权限组都有真实能力，顺序表与定义一致', () => {
  assert.equal(Object.keys(DEVICE_GROUPS).length, DEVICE_GROUP_ORDER.length)
  for (const group of DEVICE_GROUP_ORDER) {
    assert.ok(DEVICE_GROUPS[group], `缺少分组定义：${group}`)
    assert.ok(
      Object.values(DEVICE_ABILITIES).some((meta) => meta.capability === group),
      `分组没有能力：${group}`,
    )
  }
})

/* ------------------------------------------------------------------ *
 * 汇总
 * ------------------------------------------------------------------ */

export const results = outcomes
