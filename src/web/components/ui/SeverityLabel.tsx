import type { Severity } from '@shared/findings-schema'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

interface Props {
  level: Severity
  className?: string
}

const COLOR: Record<Severity, string> = {
  must: 'text-severity-must',
  should: 'text-severity-should',
  nit: 'text-severity-nit',
}

const ICON: Record<Severity, string> = {
  must: '🔴',
  should: '🟡',
  nit: '🔵',
}

export function SeverityLabel({ level, className }: Props) {
  const { t } = useTranslation()
  const label = t(`severity.${level}`)
  return (
    <span
      data-level={level}
      className={cn(
        'inline-flex items-center gap-1 text-caps font-bold tracking-caps uppercase',
        COLOR[level],
        className,
      )}
      aria-label={t('severity.ariaLabel', { label })}
    >
      <span aria-hidden="true">{ICON[level]}</span>
      <span>{label}</span>
    </span>
  )
}
