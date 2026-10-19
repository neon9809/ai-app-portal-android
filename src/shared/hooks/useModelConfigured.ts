import { useEffect, useState } from 'react'

import { isLlmConfigured, readLlmSettings } from '@/shared/portal/llm'

/**
 * 本机是否已经配置好模型服务。
 *
 * 页面重新可见或窗口获得焦点时重新读取：用户去「设置 → AI 模型」填完 Key
 * 返回后，创建入口会立刻从「添加大模型API」变回「新建工具」。
 */
export function useModelConfigured(): boolean {
  const [configured, setConfigured] = useState(true)

  useEffect(() => {
    let alive = true
    const check = () => {
      void readLlmSettings()
        .then((settings) => {
          if (alive) setConfigured(isLlmConfigured(settings))
        })
        .catch(() => undefined)
    }
    check()
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', check)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', check)
    }
  }, [])

  return configured
}
