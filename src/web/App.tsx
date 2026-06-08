import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Routes, Route, Navigate, useLocation, matchPath, useParams } from 'react-router-dom'

import { ActivityBar } from '@/components/ActivityBar'
import { Sidebar } from '@/components/Sidebar'
import { api, queryKeys } from '@/lib/api'
import { SelectionProvider } from '@/lib/selection'
import { ToastProvider } from '@/lib/toast'
import { applyDiffViewModeDefault } from '@/lib/use-diff-view-mode'

// Routes that expose the sessions sidebar. The sidebar is scoped to session
// surfaces only; /prompt and /settings render without it.
const SIDEBAR_ROUTES = ['/', '/session/:id', '/pr/:id'] as const

function useShowSidebar(): boolean {
  const { pathname } = useLocation()
  return SIDEBAR_ROUTES.some((p) => matchPath({ path: p, end: true }, pathname) !== null)
}

const Home = lazy(() => import('@/pages/Home').then((m) => ({ default: m.Home })))
const SessionDetail = lazy(() =>
  import('@/pages/SessionDetail').then((m) => ({ default: m.SessionDetail })),
)

// SPA-side alias from the legacy /pr/:id path to the canonical /session/:id.
// Real 301s aren't possible from a static SPA; this Navigate replaces the
// history entry so bookmarks land on the canonical URL.
function LegacyPrRedirect() {
  const { id = '' } = useParams()
  return <Navigate to={`/session/${id}`} replace />
}
const PromptEditor = lazy(() =>
  import('@/pages/PromptEditor').then((m) => ({ default: m.PromptEditor })),
)
const Settings = lazy(() => import('@/pages/Settings').then((m) => ({ default: m.Settings })))

function RouteFallback() {
  const { t } = useTranslation()
  return (
    <div className="px-8 py-10 max-w-3xl space-y-4" aria-label={t('app.loadingPage')}>
      <div className="text-caps tracking-caps text-ink-muted uppercase">{t('app.loading')}</div>
      <div className="h-8 w-2/3 bg-raised rounded" />
      <div className="h-px w-full bg-rule" />
      <div className="space-y-2">
        <div className="h-3 w-full bg-raised/70 rounded" />
        <div className="h-3 w-5/6 bg-raised/70 rounded" />
        <div className="h-3 w-4/6 bg-raised/70 rounded" />
      </div>
    </div>
  )
}

export function App() {
  const { i18n } = useTranslation()
  const { data: cfg } = useQuery({ queryKey: queryKeys.config, queryFn: api.getConfig })
  const showSidebar = useShowSidebar()

  useEffect(() => {
    const lang = cfg?.config.language
    if (!lang || i18n.language === lang) return
    void i18n.changeLanguage(lang)
    if (typeof document !== 'undefined') document.documentElement.lang = lang
  }, [cfg?.config.language, i18n])

  // Seed the diff layout from the configured default. The dep is the config
  // value, so this only re-fires on initial load and when the user saves a new
  // default in Settings — in-session unified/split toggles stay untouched.
  const diffViewMode = cfg?.config.diffViewMode
  useEffect(() => {
    if (diffViewMode) applyDiffViewModeDefault(diffViewMode)
  }, [diffViewMode])

  return (
    <SelectionProvider>
      <ToastProvider>
        <div className="h-screen flex bg-canvas text-ink-primary overflow-hidden">
          <ActivityBar />
          {showSidebar ? <Sidebar /> : null}
          <main className="flex-1 min-w-0 overflow-auto bg-main">
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/session/:id" element={<SessionDetail />} />
                <Route path="/pr/:id" element={<LegacyPrRedirect />} />
                <Route path="/prompt" element={<PromptEditor />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </Suspense>
          </main>
        </div>
      </ToastProvider>
    </SelectionProvider>
  )
}
