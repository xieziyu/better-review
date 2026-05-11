import { MonitorSmartphone, Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getThemePreference, setThemePreference, type ThemePreference } from '@/lib/theme'

const ORDER: readonly ThemePreference[] = ['system', 'light', 'dark']

export function ThemeToggle() {
  const { t } = useTranslation()
  const [pref, setPref] = useState<ThemePreference>(() => getThemePreference())

  const cycle = () => {
    const idx = ORDER.indexOf(pref)
    const next = ORDER[(idx + 1) % ORDER.length] ?? 'system'
    setThemePreference(next)
    setPref(next)
  }

  const label =
    pref === 'light'
      ? t('activityBar.themeLight')
      : pref === 'dark'
        ? t('activityBar.themeDark')
        : t('activityBar.themeSystem')

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={cycle}
      className="inline-flex items-center justify-center size-7 rounded-md text-ink-secondary hover:bg-canvas hover:text-ink-primary transition-colors duration-180 ease-out-quart focus:outline-none focus-visible:border focus-visible:border-brand"
    >
      <span aria-hidden="true">
        {pref === 'light' ? (
          <Sun size={14} />
        ) : pref === 'dark' ? (
          <Moon size={14} />
        ) : (
          <MonitorSmartphone size={14} />
        )}
      </span>
    </button>
  )
}
