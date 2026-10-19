import { useEffect, useState } from 'react'
import { Eye, EyeOff, Plug } from 'lucide-react'

import { usePageTitle } from '@/app/layout/PageTitle'
import {
  EMPTY_LLM_SETTINGS,
  isLlmConfigured,
  readLlmSettings,
  testConnection,
  writeLlmSettings,
  type LlmSettings,
} from '@/shared/portal/llm'
import { Button } from '@/shared/ui/Button'
import { useToast } from '@/shared/ui/Toast'

export function ModelSettingsPage() {
  usePageTitle('AI 模型')
  const { toast } = useToast()
  const [settings, setSettings] = useState<LlmSettings>(EMPTY_LLM_SETTINGS)
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    void (async () => {
      setSettings(await readLlmSettings())
    })()
  }, [])

  const update = <K extends keyof LlmSettings>(key: K, value: LlmSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }))
    setTestResult(null)
  }

  const save = async () => {
    setSaving(true)
    try {
      await writeLlmSettings({
        ...settings,
        baseUrl: settings.baseUrl.trim(),
        apiKey: settings.apiKey.trim(),
        model: settings.model.trim(),
        appModel: settings.appModel.trim(),
      })
      toast({ title: '已保存', tone: 'success' })
    } catch (error) {
      toast({ title: '保存失败', description: (error as Error).message, tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    if (!isLlmConfigured(settings)) {
      toast({ title: '三项都要填', description: '服务地址、API Key、模型名', tone: 'warning' })
      return
    }
    setTesting(true)
    setTestResult(null)
    const result = await testConnection(settings)
    setTesting(false)
    setTestResult(
      result.ok
        ? { ok: true, text: `连通了，模型「${result.model}」可用` }
        : { ok: false, text: result.message },
    )
  }

  return (
    <div className="page space-y-3">
      <section className="rounded-lg border border-border bg-surface p-3">
        <p className="text-body font-medium">连接一个兼容 OpenAI 的模型服务</p>
        <p className="mt-0.5 text-caption text-muted-foreground">
          生成器与应用内的 AI 功能都用它。密钥只保存在这台设备上。
        </p>

        <label htmlFor="base-url" className="mt-3 block text-caption font-medium">
          服务地址
        </label>
        <input
          id="base-url"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          value={settings.baseUrl}
          onChange={(event) => update('baseUrl', event.target.value)}
          placeholder="https://api.example.com/v1"
          className="mt-1 w-full rounded-md border border-input bg-surface px-3 py-2.5 text-body outline-none focus:border-primary"
        />

        <label htmlFor="api-key" className="mt-3 block text-caption font-medium">
          API Key
        </label>
        <div className="mt-1 flex items-center gap-1">
          <input
            id="api-key"
            type={showKey ? 'text' : 'password'}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={settings.apiKey}
            onChange={(event) => update('apiKey', event.target.value)}
            placeholder="sk-..."
            className="min-w-0 flex-1 rounded-md border border-input bg-surface px-3 py-2.5 font-mono text-body outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={() => setShowKey((value) => !value)}
            aria-label={showKey ? '隐藏密钥' : '显示密钥'}
            className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground active:bg-accent"
          >
            {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>

        <label htmlFor="model" className="mt-3 block text-caption font-medium">
          模型名
        </label>
        <input
          id="model"
          autoCapitalize="off"
          autoCorrect="off"
          value={settings.model}
          onChange={(event) => update('model', event.target.value)}
          placeholder="例如 gpt-4o-mini / deepseek-chat"
          className="mt-1 w-full rounded-md border border-input bg-surface px-3 py-2.5 text-body outline-none focus:border-primary"
        />

        <label htmlFor="app-model" className="mt-3 block text-caption font-medium">
          应用内 AI 使用的模型（可选）
        </label>
        <input
          id="app-model"
          autoCapitalize="off"
          autoCorrect="off"
          value={settings.appModel}
          onChange={(event) => update('appModel', event.target.value)}
          placeholder="留空则与上面一致"
          className="mt-1 w-full rounded-md border border-input bg-surface px-3 py-2.5 text-body outline-none focus:border-primary"
        />

        <p className="mt-3 text-caption font-medium">生成温度</p>
        <div className="mt-1 flex gap-2">
          {[0.3, 0.7, 1].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => update('temperature', value)}
              className={
                settings.temperature === value
                  ? 'min-h-tap flex-1 rounded-md border border-primary bg-primary-soft text-body font-medium text-primary'
                  : 'min-h-tap flex-1 rounded-md border border-border bg-surface text-body text-muted-foreground'
              }
            >
              {value === 0.3 ? '稳一点' : value === 0.7 ? '均衡' : '活一点'}
            </button>
          ))}
        </div>
      </section>

      {testResult && (
        <p className={testResult.ok ? 'text-caption text-success' : 'text-caption text-danger'}>
          {testResult.ok ? '✓ ' : '✕ '}
          {testResult.text}
        </p>
      )}

      <div className="flex gap-2">
        <Button variant="outline" block loading={testing} onClick={() => void test()}>
          <Plug className="size-4" aria-hidden />
          测试连接
        </Button>
        <Button block loading={saving} onClick={() => void save()}>
          保存
        </Button>
      </div>

      <section className="rounded-lg border border-border bg-surface p-3">
        <p className="text-body font-medium">填写说明</p>
        <ul className="mt-2 space-y-1.5 text-caption text-muted-foreground">
          <li>· 地址填到版本号即可，系统会自动拼接 /chat/completions。</li>
          <li>· 常见写法：https://api.openai.com/v1、https://api.deepseek.com/v1。</li>
          <li>· 密钥保存在本机数据库，不会出现在审计日志与导出给 AI 的内容里。</li>
          <li>· 测试连接用的是当前输入值。</li>
        </ul>
      </section>
    </div>
  )
}
