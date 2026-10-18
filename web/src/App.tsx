import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import type { TodaySummary } from '@shared/types'
import { AppProvider } from '@/lib/store'
import { AppShell } from '@/components/AppShell'
import { Toasts } from '@/components/Toasts'
import { PageSkeleton } from '@/components/PageSkeleton'
import TodayPage from '@/pages/Today'

const MomentPage = lazy(() => import('@/pages/Moment'))
const VisitsPage = lazy(() => import('@/pages/Visits'))
const RulesPage = lazy(() => import('@/pages/Rules'))
const ReportPage = lazy(() => import('@/pages/Report'))
const LivePage = lazy(() => import('@/pages/Live'))
const SettingsPage = lazy(() => import('@/pages/Settings'))
const HowPage = lazy(() => import('@/pages/How'))
const WelcomePage = lazy(() => import('@/pages/Welcome'))
const CheckinPage = lazy(() => import('@/pages/Checkin'))
const NotFoundPage = lazy(() => import('@/pages/NotFound'))

export function App({ initial }: { initial: TodaySummary | null }) {
  if (!initial) {
    return (
      <BrowserRouter>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/c/:code" element={<CheckinPage />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    )
  }
  return (
    <BrowserRouter>
      <AppProvider initial={initial}>
        <Toasts />
        <Suspense fallback={<PageSkeleton />}>
          <Routes>
            <Route path="/c/:code" element={<CheckinPage />} />
            <Route path="/welcome" element={<WelcomePage />} />
            <Route element={<AppShell />}>
              <Route index element={<TodayPage />} />
              <Route path="moment/:id" element={<MomentPage />} />
              <Route path="visits" element={<VisitsPage />} />
              <Route path="rules" element={<RulesPage />} />
              <Route path="report" element={<ReportPage />} />
              <Route path="live" element={<LivePage />} />
              <Route path="live/:deviceId" element={<LivePage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="how" element={<HowPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </Suspense>
      </AppProvider>
    </BrowserRouter>
  )
}
