import { useTranslation } from 'react-i18next'

export function useRelativeTime(): (timestamp: number) => string {
  const { t } = useTranslation()
  return (timestamp: number) => {
    const diffMs = Date.now() - timestamp
    if (diffMs < 0) return t('time.justNow')
    const seconds = Math.floor(diffMs / 1000)
    if (seconds < 60) return t('time.secondsAgo', { n: seconds })
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return t('time.minutesAgo', { n: minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('time.hoursAgo', { n: hours })
    const days = Math.floor(hours / 24)
    return t('time.daysAgo', { n: days })
  }
}

export function useUptime(): (startedAt: number, now: number) => string {
  const { t } = useTranslation()
  return (startedAt: number, now: number) => {
    const ms = Math.max(0, now - startedAt)
    const totalMin = Math.floor(ms / 60_000)
    if (totalMin < 1) return t('time.justNow')
    if (totalMin < 60) return t('time.minutes', { n: totalMin })
    const totalHrs = Math.floor(totalMin / 60)
    const remMin = totalMin % 60
    if (totalHrs < 24) return t('time.hoursAndMinutes', { h: totalHrs, m: remMin })
    const days = Math.floor(totalHrs / 24)
    return t('time.daysAndHours', { d: days, h: totalHrs % 24 })
  }
}
