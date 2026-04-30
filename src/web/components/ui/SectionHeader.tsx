import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface Props {
  eyebrow?: string
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  className?: string
}

export function SectionHeader({ eyebrow, title, meta, actions, className }: Props) {
  return (
    <header className={cn('flex items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <div className="text-caps text-ink-muted uppercase tracking-caps mb-1">{eyebrow}</div>
        ) : null}
        <h2 className="text-h1 text-ink-primary truncate">{title}</h2>
        {meta ? <div className="mt-1 text-meta text-ink-secondary">{meta}</div> : null}
      </div>
      {actions ? <div className="flex items-center gap-1.5 shrink-0">{actions}</div> : null}
    </header>
  )
}
