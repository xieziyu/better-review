import { FileText, Settings as SettingsIcon } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { Link, NavLink, Routes, Route } from 'react-router-dom'

import { HealthBanner } from '@/components/HealthBanner'
import { Sidebar } from '@/components/Sidebar'

const Home = lazy(() => import('@/pages/Home').then((m) => ({ default: m.Home })))
const PRDetail = lazy(() => import('@/pages/PRDetail').then((m) => ({ default: m.PRDetail })))
const PromptEditor = lazy(() =>
  import('@/pages/PromptEditor').then((m) => ({ default: m.PromptEditor })),
)
const Settings = lazy(() => import('@/pages/Settings').then((m) => ({ default: m.Settings })))

function TopBar() {
  return (
    <header className="h-12 flex items-center px-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
      <Link
        to="/"
        className="inline-flex items-center gap-2 font-semibold tracking-tight text-gray-900 dark:text-gray-100"
      >
        <img src="/logo.svg" alt="" className="size-6 rounded-md" aria-hidden="true" />
        better-review
      </Link>
      <div className="flex-1 mx-4">
        <HealthBanner />
      </div>
      <nav className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400">
        <NavLink
          to="/prompt"
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-900 dark:hover:text-gray-100 aria-[current=page]:bg-gray-100 aria-[current=page]:text-gray-900 dark:aria-[current=page]:bg-gray-900 dark:aria-[current=page]:text-gray-100"
        >
          <FileText size={14} aria-hidden="true" />
          Prompt
        </NavLink>
        <NavLink
          to="/settings"
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-900 dark:hover:text-gray-100 aria-[current=page]:bg-gray-100 aria-[current=page]:text-gray-900 dark:aria-[current=page]:bg-gray-900 dark:aria-[current=page]:text-gray-100"
        >
          <SettingsIcon size={14} aria-hidden="true" />
          Settings
        </NavLink>
      </nav>
    </header>
  )
}

function RouteFallback() {
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-3 animate-pulse" aria-label="Loading page">
      <div className="h-5 w-2/3 bg-gray-200 dark:bg-gray-800 rounded" />
      <div className="h-4 w-1/3 bg-gray-200 dark:bg-gray-800 rounded" />
      <div className="h-32 bg-gray-200 dark:bg-gray-800 rounded mt-6" />
    </div>
  )
}

export function App() {
  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
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
