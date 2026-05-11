import { type Language } from '@shared/types'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'

// Picks the supported locale that best matches `navigator.language(s)`. Used
// for the SPA's first paint before `/api/config` resolves so users on a
// Chinese OS don't briefly see English. Once the config response arrives,
// `App.tsx` may call `i18n.changeLanguage()` to reconcile with the persisted
// value.
export function detectBrowserLanguage(): Language {
  if (typeof navigator === 'undefined') return 'en'
  const langs: readonly string[] =
    navigator.languages && navigator.languages.length > 0
      ? navigator.languages
      : navigator.language
        ? [navigator.language]
        : []
  for (const l of langs) {
    if (l.toLowerCase().startsWith('zh')) return 'zh-CN'
  }
  return 'en'
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { common: en },
    'zh-CN': { common: zhCN },
  },
  lng: detectBrowserLanguage(),
  fallbackLng: 'en',
  defaultNS: 'common',
  // Prep-phase keys embed `:` (e.g. `prep.phase.prep:fetching-pr`); disabling
  // the namespace separator keeps `:` literal inside keys.
  nsSeparator: false,
  interpolation: { escapeValue: false },
})

export default i18n
