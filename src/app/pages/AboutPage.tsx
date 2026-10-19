import { Code2, ShieldCheck } from 'lucide-react'

import { usePageTitle } from '@/app/layout/PageTitle'
import { useI18n } from '@/shared/i18n'
import { APP_NAME, APP_VERSION } from '@/shared/config/app'
import { DotField, DotTile } from '@/shared/ui/Dot'

/**
 * 关于：版本、代码来源与许可、能力说明。
 * 从设置页的「关于」进入；能力限制放在这里，不占用设置首页。
 */
export function AboutPage() {
  const { t } = useI18n()
  usePageTitle(t('about.title'))

  return (
    <div className="page space-y-3">
      <section className="relative overflow-hidden rounded-xl border border-border bg-surface p-4">
        <DotField className="absolute -right-2 -top-2 text-primary" rows={4} cols={5} />
        <div className="relative flex items-start gap-3">
          <DotTile size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="text-title font-semibold">{APP_NAME}</h2>
            <p className="mt-0.5 text-caption text-muted-foreground">
              {t('about.versionLocal', { version: APP_VERSION })}
            </p>
            <p className="mt-1 text-body text-muted-foreground">
              {t('about.intro')}
            </p>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center gap-2 px-4 pt-3">
          <Code2 className="size-4 text-muted-foreground" aria-hidden />
          <p className="text-body font-medium">{t('about.licenseTitle')}</p>
        </div>
        <div className="px-4 pb-4 pt-2">
          <p className="text-caption text-muted-foreground">
            {t('about.basedOn')}
            <br />
            <span className="break-all text-foreground">github.com/neon9809/ai-app-portal</span>
          </p>
          <p className="mt-2 text-caption text-muted-foreground">
            {t('about.licenseBody')}
          </p>
          <p className="mt-1 break-all text-caption text-muted-foreground">
            {t('about.licenseFull')}
          </p>
          <p className="mt-2 text-caption text-muted-foreground">
            {t('about.components')}
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
          <p className="text-body font-medium">{t('about.limitsTitle')}</p>
        </div>
        <ul className="mt-2 space-y-1.5 text-caption text-muted-foreground">
          <li>{t('about.limit1')}</li>
          <li>{t('about.limit2')}</li>
          <li>{t('about.limit3')}</li>
          <li>{t('about.limit4')}</li>
          <li>{t('about.limit5')}</li>
          <li>{t('about.limit6')}</li>
          <li>{t('about.limit7')}</li>
          <li>{t('about.limit8')}</li>
        </ul>
      </section>
    </div>
  )
}
