import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'

void i18n.use(initReactI18next).init({
  resources: {
    en: { common: en },
    'zh-CN': { common: zhCN },
  },
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  // Prep-phase keys embed `:` (e.g. `prep.phase.prep:fetching-pr`); disabling
  // the namespace separator keeps `:` literal inside keys.
  nsSeparator: false,
  interpolation: { escapeValue: false },
})

export default i18n
