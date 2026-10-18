/**
 * 选择本地文件并读出字节。
 *
 * 真机优先用壳的 chooseMessageFile（系统文件选择器），它返回的是与页面同主机的虚拟 URL，
 * 再 fetch 这个 URL 拿字节；浏览器预览没有壳，退回到一个临时创建的文件输入框。
 * 动态创建而不是写死文件输入标签：App UI 的端能力优先，浏览器只是预览兜底。
 */

import { getBridgeMode, initBridge, invokeNative } from '@/shared/bridge'

export interface PickedFile {
  name: string
  bytes: Uint8Array
}

function pickInBrowser(accept: string): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    document.body.appendChild(input)
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      input.remove()
      if (!file) {
        resolve(null)
        return
      }
      const reader = new FileReader()
      reader.onload = () =>
        resolve({ name: file.name, bytes: new Uint8Array(reader.result as ArrayBuffer) })
      reader.onerror = () => resolve(null)
      reader.readAsArrayBuffer(file)
    })
    input.click()
  })
}

/** 选择文件；用户取消返回 null */
export async function pickFile(accept: string): Promise<PickedFile | null> {
  await initBridge()
  if (getBridgeMode() === 'native') {
    try {
      const result = await invokeNative('chooseMessageFile', { count: 1, type: 'file' })
      const file = result.tempFiles?.[0]
      if (!file) return null
      const response = await fetch(file.path)
      if (!response.ok) throw new Error('读取文件失败')
      const buffer = await response.arrayBuffer()
      return { name: file.name, bytes: new Uint8Array(buffer) }
    } catch {
      // 旧壳不支持或读取失败时，用系统 WebView 的文件选择兜底
      return pickInBrowser(accept)
    }
  }
  return pickInBrowser(accept)
}
