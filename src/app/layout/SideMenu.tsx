import { useLocation, useNavigate } from 'react-router-dom'
import { CircleHelp, FileUp, Plus, Settings, Sparkles, X } from 'lucide-react'

import logo from '@/assets/app-mark.svg'
import { useImport } from '@/app/components/ImportProvider'
import { useOnboarding } from '@/app/components/Onboarding'
import { cn } from '@/shared/lib/cn'
import { APP_NAME, APP_VERSION } from '@/shared/config/app'

interface SideMenuProps {
  open: boolean
  onClose: () => void
}

/** 左侧抽屉菜单：应用、新建、导入与设置都在这里，主界面不再放底部导航 */
export function SideMenu({ open, onClose }: SideMenuProps) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { openImport } = useImport()
  const { open: openOnboarding } = useOnboarding()

  const go = (to: string) => {
    onClose()
    navigate(to)
  }

  return (
    <div
      className={cn('fixed inset-0 z-50', open ? 'pointer-events-auto' : 'pointer-events-none')}
      aria-hidden={!open}
    >
      <div
        className={cn(
          'absolute inset-0 bg-overlay/45 transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
      />
      <aside
        className={cn(
          'absolute inset-y-0 left-0 flex w-72 flex-col bg-surface shadow-lg transition-transform duration-200 ease-standard',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        role="dialog"
        aria-modal="true"
        aria-label="菜单"
      >
        <div className="flex items-center gap-2.5 px-4 pb-3 pt-safe-top">
          <div className="mt-3 flex min-w-0 flex-1 items-center gap-2.5">
            <img src={logo} alt="" className="size-9 rounded-md" />
            <div className="min-w-0">
              <p className="truncate text-body font-medium">{APP_NAME}</p>
              <p className="text-caption text-muted-foreground">本地应用工厂</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭菜单"
            className="mt-3 flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground active:bg-accent"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-3">
          <div className="space-y-1 pb-3">
            <button
              type="button"
              onClick={() => go('/')}
              className={cn(
                'flex min-h-tap w-full items-center gap-3 rounded-md px-3 text-body active:bg-accent',
                pathname === '/' ? 'bg-primary-soft font-medium text-primary' : 'text-foreground',
              )}
            >
              <Sparkles className="size-5 shrink-0" aria-hidden />
              我的应用
            </button>
            <button
              type="button"
              onClick={() => go('/studio')}
              className="flex min-h-tap w-full items-center gap-3 rounded-md px-3 text-body active:bg-accent"
            >
              <Plus className="size-5 shrink-0" aria-hidden />
              造一个新工具
            </button>
            <button
              type="button"
              onClick={() => {
                onClose()
                void openImport()
              }}
              className="flex min-h-tap w-full items-center gap-3 rounded-md px-3 text-body active:bg-accent"
            >
              <FileUp className="size-5 shrink-0" aria-hidden />
              导入应用文件
            </button>
            <button
              type="button"
              onClick={() => {
                onClose()
                openOnboarding()
              }}
              className="flex min-h-tap w-full items-center gap-3 rounded-md px-3 text-body active:bg-accent"
            >
              <CircleHelp className="size-5 shrink-0" aria-hidden />
              使用说明
            </button>
          </div>

          <div className="space-y-1 pb-4">
            <button
              type="button"
              onClick={() => go('/settings')}
              className={cn(
                'flex min-h-tap w-full items-center gap-3 rounded-md px-3 text-body active:bg-accent',
                pathname.startsWith('/settings')
                  ? 'bg-primary-soft font-medium text-primary'
                  : 'text-foreground',
              )}
            >
              <Settings className="size-5 shrink-0" aria-hidden />
              设置
            </button>
          </div>
        </nav>

        <p className="px-4 pb-3 pt-2 text-caption text-muted-foreground">
          版本 {APP_VERSION} · 数据只保存在本机
        </p>
        <div className="pb-safe-bottom" />
      </aside>
    </div>
  )
}
