import type { Severity } from '@shared/findings-schema'

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

const LABEL: Record<Severity, string> = {
  must: 'MUST',
  should: 'SHOULD',
  nit: 'NIT',
}

export function SeverityLabel({ level, className }: Props) {
  return (
    <span
      data-level={level}
      className={cn(
        'inline-flex items-center gap-1 text-caps font-bold tracking-caps uppercase',
        COLOR[level],
        className,
      )}
      aria-label={`severity: ${LABEL[level].toLowerCase()}`}
    >
      <span aria-hidden="true">→</span>
      <span>{LABEL[level]}</span>
    </span>
  )
}
