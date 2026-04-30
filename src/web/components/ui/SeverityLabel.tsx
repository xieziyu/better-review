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
        'inline-block w-16 shrink-0 text-caps font-bold tracking-caps-wide opacity-70 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-180 ease-out-quart',
        COLOR[level],
        className,
      )}
      aria-label={`severity: ${LABEL[level].toLowerCase()}`}
    >
      {LABEL[level]}
    </span>
  )
}
