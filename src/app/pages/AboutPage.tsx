import { Code2, Info, ShieldCheck } from 'lucide-react'

import { usePageTitle } from '@/app/layout/PageTitle'
import { APP_NAME, APP_VERSION } from '@/shared/config/app'

/**
 * 关于：版本、代码来源与许可、能力说明。
 * 从设置页的「关于」进入；能力限制放在这里，不占用设置首页。
 */
export function AboutPage() {
  usePageTitle('关于')

  return (
    <div className="page space-y-3">
      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-start gap-3">
          <span
            className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary"
            aria-hidden
          >
            <Info className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-title font-semibold">{APP_NAME}</h2>
            <p className="mt-0.5 text-caption text-muted-foreground">
              本地单用户版本 {APP_VERSION}
            </p>
            <p className="mt-1 text-body text-muted-foreground">
              用一句话描述需求，在手机上生成一个打开就能用的小工具。
            </p>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center gap-2 px-4 pt-3">
          <Code2 className="size-4 text-muted-foreground" aria-hidden />
          <p className="text-body font-medium">代码来源与许可</p>
        </div>
        <div className="px-4 pb-4 pt-2">
          <p className="text-caption text-muted-foreground">
            本项目基于「AI App Portal」重写与移植：
            <br />
            <span className="break-all text-foreground">github.com/neon9809/ai-app-portal</span>
          </p>
          <p className="mt-2 text-caption text-muted-foreground">
            原项目版权归其作者所有，依据 GNU General Public License v3.0（GPL-3.0）发布。
            本应用同样按 GPL-3.0 分发，保留原项目的版权与许可声明；源码随应用提供，
            修改与再分发请遵循同一许可证。
          </p>
          <p className="mt-1 break-all text-caption text-muted-foreground">
            许可证全文：gnu.org/licenses/gpl-3.0.html
          </p>
          <p className="mt-2 text-caption text-muted-foreground">
            使用的开源组件：React、React Router、Vite、Tailwind CSS（MIT）、
            lucide-react（ISC）、fflate、clsx、tailwind-merge（MIT）；
            视口单位兜底衍生自 joppuyo/large-small-dynamic-viewport-units-polyfill（MIT）。
            版权归各项目作者所有。
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
          <p className="text-body font-medium">能做什么、不能做什么</p>
        </div>
        <p className="mt-0.5 text-caption text-muted-foreground">
          这些限制来自手机网页的运行环境，不是临时开关；写清楚方便你判断哪些需求能做、哪些做不了。
        </p>
        <ul className="mt-2 space-y-1.5 text-caption text-muted-foreground">
          <li>· 生成的应用运行在网页沙箱里，支持单文件 HTML / JS；不支持 Python 与 pip 安装。</li>
          <li>· 应用只能通过沙箱提供的能力访问本机存储、AI、白名单网络、剪贴板、文件、蓝牙、麦克风、相机和定位；每项都在首次使用时单独向你申请，可随时撤回。</li>
          <li>· 端侧能力还包括：打开其它应用、管理本机文件、上传文件、震动、语音播报、修改系统设置、用快记录音、相机模式和天气；同样逐项授权。上传会把文件发到服务端，快记录音的音频保存在快记里、不进入工具。</li>
          <li>· 浏览器预览没有设备桥，只有装到手机上才能在真机使用这些能力。</li>
          <li>· 应用可以注册时间 / 位置触发器，门户打开时检查并在顶部弹提醒；没有系统级后台唤醒，关闭门户后不会执行。</li>
          <li>· H5 无法创建桌面快捷方式，工具都从「我的应用」打开。</li>
          <li>· 生成过程在页面内运行：切到后台可能被系统暂停，完全退出应用后会停住；中断的任务会以未完成草稿留在货架，可重新生成。</li>
          <li>· 数据只在本机；卸载应用或清除应用数据会一起消失，请定期导出备份。</li>
        </ul>
      </section>
    </div>
  )
}
