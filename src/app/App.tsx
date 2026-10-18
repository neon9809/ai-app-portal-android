import { Navigate, Route, Routes } from 'react-router-dom'

import { ImportProvider } from './components/ImportProvider'
import { OnboardingProvider } from './components/Onboarding'
import { TriggerEngineProvider } from './components/TriggerEngine'
import { AppShell } from './layout/AppShell'
import { AppDetailPage } from './pages/AppDetailPage'
import { AppSettingsPage } from './pages/AppSettingsPage'
import { AboutPage } from './pages/AboutPage'
import { AuditPage } from './pages/AuditPage'
import { BackupPage } from './pages/BackupPage'
import { ModelSettingsPage } from './pages/ModelSettingsPage'
import { RunnerPage } from './pages/RunnerPage'
import { SettingsPage } from './pages/SettingsPage'
import { ShelfPage } from './pages/ShelfPage'
import { StudioPage } from './pages/StudioPage'
import { UsagePage } from './pages/UsagePage'

/**
 * App UI 路由表。
 * 首页 / 是「我的应用」；新建、导入与设置从左上角抽屉进入。
 * 应用运行页挂在 AppShell 之外，自己吃安全区、全屏铺满。
 */
export function App() {
  return (
    <OnboardingProvider>
      <TriggerEngineProvider>
        <ImportProvider>
          <Routes>
            <Route path="app/:id" element={<RunnerPage />} />

            <Route element={<AppShell />}>
              <Route index element={<ShelfPage />} />
              <Route path="studio" element={<StudioPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="settings/model" element={<ModelSettingsPage />} />
              <Route path="settings/usage" element={<UsagePage />} />
              <Route path="settings/backup" element={<BackupPage />} />
              <Route path="settings/audit" element={<AuditPage />} />
              <Route path="settings/about" element={<AboutPage />} />
              <Route path="app/:id/detail" element={<AppDetailPage />} />
              <Route path="app/:id/settings" element={<AppSettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </ImportProvider>
      </TriggerEngineProvider>
    </OnboardingProvider>
  )
}
