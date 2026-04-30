import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface Props {
  eyebrow?: string
  title: ReactNode
  body?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({ eyebrow, title, body, action, className }: Props) {
  return (
    <div
      className={cn(
        'flex flex-col items-start justify-center gap-3 py-10 px-1 text-ink-secondary',
        className,
      )}
    >
      {eyebrow ? (
        <span className="text-caps text-ink-muted uppercase tracking-caps">{eyebrow}</span>
      ) : null}
      <div className="text-h1 text-ink-primary">{title}</div>
      {body ? <p className="text-body max-w-prose">{body}</p> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  )
}
