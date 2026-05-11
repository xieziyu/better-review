import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, Routes, Route } from 'react-router-dom'

import { DaemonStatus } from '@/components/DaemonStatus'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { Sidebar } from '@/components/Sidebar'
import { api, queryKeys } from '@/lib/api'
import { cn } from '@/lib/utils'

const Home = lazy(() => import('@/pages/Home').then((m) => ({ default: m.Home })))
const PRDetail = lazy(() => import('@/pages/PRDetail').then((m) => ({ default: m.PRDetail })))
const PromptEditor = lazy(() =>
  import('@/pages/PromptEditor').then((m) => ({ default: m.PromptEditor })),
)
const Settings = lazy(() => import('@/pages/Settings').then((m) => ({ default: m.Settings })))

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        cn(
          'relative inline-flex items-center px-1 h-14 text-caps tracking-caps uppercase transition-colors duration-180 ease-out-quart',
          isActive ? 'text-ink-primary' : 'text-ink-secondary hover:text-ink-primary',
        )
      }
    >
      {({ isActive }) => (
        <>
          {children}
          <span
            aria-hidden="true"
            className={cn(
              'absolute left-0 right-0 -bottom-px h-[2px]',
              isActive ? 'bg-brand' : 'bg-transparent',
            )}
          />
        </>
      )}
    </NavLink>
  )
}

function TopBar() {
  const { t } = useTranslation()
  return (
    <header className="h-14 flex items-center px-5 gap-6 border-b border-rule bg-canvas">
      <Link
        to="/"
        className="inline-flex items-center gap-2 text-display text-ink-primary tracking-tight"
      >
        <img src="/logo.svg" alt="" className="size-6" aria-hidden="true" />
        <span className="text-h1 tracking-tight">better-review</span>
      </Link>
      <nav className="ml-auto flex items-center gap-5 text-meta" aria-label={t('app.nav.primary')}>
        <NavItem to="/prompt">{t('app.nav.prompt')}</NavItem>
        <NavItem to="/settings">{t('app.nav.settings')}</NavItem>
        <LanguageSwitcher />
        <DaemonStatus />
      </nav>
    </header>
  )
}

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

  useEffect(() => {
    const lang = cfg?.config.language
    if (!lang || i18n.language === lang) return
    void i18n.changeLanguage(lang)
    if (typeof document !== 'undefined') document.documentElement.lang = lang
  }, [cfg?.config.language, i18n])

  return (
    <div className="min-h-screen flex flex-col bg-canvas text-ink-primary">
      <TopBar />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/pr/:id" element={<PRDetail />} />
              <Route path="/prompt" element={<PromptEditor />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  )
}
