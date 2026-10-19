import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, KeyRound, Menu, Plus } from 'lucide-react'

import { cn } from '@/shared/lib/cn'
import { useModelConfigured } from '@/shared/hooks/useModelConfigured'
import { useI18n } from '@/shared/i18n'
import { PageTitleProvider } from './PageTitle'
import { SideMenu } from './SideMenu'
import { TopBleedScrim } from './TopBleedScrim'

/**
 * App UI 外壳：可滚动内容区 + 顶栏。
 *
 * 一级页（首页「我的应用」）的顶栏固定为：左上菜单、标题、右上新建。
 * 二级页的顶栏是：返回、页面标题。页面用 usePageTitle() 声明标题；
 * 首页不声明标题，使用「我的应用」。
 *
 * 底部不再放导航——所有入口（新建、导入、设置）收进左上角抽屉菜单。
 */
export function AppShell() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const [pageTitle, setPageTitle] = useState<string>()
  const [topBleed, setTopBleed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const modelReady = useModelConfigured()

  const isHome = pathname === '/'
  const hasHeader = isHome || pageTitle !== undefined
  const { t } = useI18n()
  const title = isHome ? t('nav.myApps') : pageTitle

  // 换页时收起抽屉，避免菜单盖住新页面
  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  // 换页回到顶部：新页面不应该继承上一页的滚动位置
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [pathname])

  // 「顶部穿透」与顶栏二选一（首页始终有顶栏，不存在这个组合）
  useEffect(() => {
    if (import.meta.env.DEV && hasHeader && topBleed) {
      console.warn('[app-shell] 本页同时声明了顶栏标题与 useTopBleed()：要穿透就不要 usePageTitle()（顶栏会盖住穿透区）。')
    }
  }, [hasHeader, topBleed])

  return (
    <div className="flex h-screen-dvh flex-col bg-background text-foreground">
      <SideMenu open={menuOpen} onClose={() => setMenuOpen(false)} />

      {hasHeader && (
        <header className="z-20 shrink-0 border-b border-border bg-surface/95 backdrop-blur pt-safe-top">
          <div className="flex min-h-12 items-center gap-2 px-4">
            {isHome ? (
              <button
                type="button"
                onClick={() => setMenuOpen(true)}
                aria-label={t('nav.openMenu')}
                className="-ml-2 flex size-11 items-center justify-center rounded-md text-foreground active:bg-accent"
              >
                <Menu className="size-6" aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigate(-1)}
                aria-label={t('nav.back')}
                className="-ml-2 flex size-11 items-center justify-center rounded-md text-foreground active:bg-accent"
              >
                <ChevronLeft className="size-6" aria-hidden />
              </button>
            )}

            <h1 key={title} className="animate-fade-in flex-1 truncate text-title font-semibold">
              {title}
            </h1>

            {isHome && modelReady && (
              <button
                type="button"
                onClick={() => navigate('/studio')}
                aria-label={t('nav.newTool')}
                className="-mr-2 flex size-11 items-center justify-center rounded-md text-primary active:bg-accent"
              >
                <Plus className="size-6" aria-hidden />
              </button>
            )}

            {isHome && !modelReady && (
              <button
                type="button"
                onClick={() => navigate('/settings/model')}
                className="-mr-2 flex min-h-tap items-center gap-1 rounded-md px-2 text-caption font-medium text-primary active:bg-accent"
              >
                <KeyRound className="size-4" aria-hidden />
                {t('nav.addModelApi')}
              </button>
            )}
          </div>
        </header>
      )}

      <main
        ref={mainRef}
        className={cn('min-h-0 flex-1 scroll-y', !hasHeader && !topBleed && 'safe-top-backdrop')}
      >
        <PageTitleProvider onChange={setPageTitle} onTopBleedChange={setTopBleed}>
          <div key={pathname} className="page-enter">
            <Outlet />
          </div>
        </PageTitleProvider>
      </main>

      {topBleed && !hasHeader && <TopBleedScrim key={pathname} scroller={mainRef} />}
    </div>
  )
}
