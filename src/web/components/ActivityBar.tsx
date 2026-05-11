import { BookText, Inbox, Settings as SettingsIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink } from 'react-router-dom'

import { DaemonStatus } from '@/components/DaemonStatus'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { ThemeToggle } from '@/components/ThemeToggle'
import { cn } from '@/lib/utils'

interface IconNavLinkProps {
  to: string
  label: string
  icon: React.ReactNode
}

function IconNavLink({ to, label, icon }: IconNavLinkProps) {
  return (
    <NavLink
      to={to}
      end
      aria-label={label}
      title={label}
      className={({ isActive }) =>
        cn(
          'relative inline-flex items-center justify-center size-10 rounded-md transition-colors duration-180 ease-out-quart',
          isActive
            ? 'text-ink-primary bg-canvas'
            : 'text-ink-secondary hover:text-ink-primary hover:bg-canvas/60',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span aria-hidden="true">{icon}</span>
          <span
            aria-hidden="true"
            className={cn(
              'absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-sm',
              isActive ? 'bg-brand' : 'bg-transparent',
            )}
          />
        </>
      )}
    </NavLink>
  )
}

export function ActivityBar() {
  const { t } = useTranslation()
  return (
    <aside
      aria-label={t('activityBar.aria')}
      className="w-14 shrink-0 border-r border-rule bg-raised flex flex-col items-center gap-1 py-3"
    >
      <Link
        to="/"
        aria-label={t('activityBar.brand')}
        title={t('activityBar.brand')}
        className="inline-flex items-center justify-center size-10 mb-2"
      >
        <img src="/logo.svg" alt="" className="size-6" aria-hidden="true" />
      </Link>
      <IconNavLink to="/" label={t('activityBar.sessions')} icon={<Inbox size={18} />} />
      <IconNavLink to="/prompt" label={t('activityBar.prompt')} icon={<BookText size={18} />} />
      <IconNavLink
        to="/settings"
        label={t('activityBar.settings')}
        icon={<SettingsIcon size={18} />}
      />
      <div className="flex-1" />
      <ThemeToggle />
      <LanguageSwitcher />
      <DaemonStatus />
    </aside>
  )
}
