import { type ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface FieldProps {
  label: string
  hint?: ReactNode
  error?: ReactNode
  htmlFor?: string
  /** Optional content rendered to the right of the label (e.g. status tags). */
  trail?: ReactNode
  className?: string
  children: ReactNode
}

export function Field({ label, hint, error, htmlFor, trail, className, children }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center gap-2">
        <label htmlFor={htmlFor} className="text-caps tracking-caps text-ink-muted uppercase">
          {label}
        </label>
        {trail ? <span className="ml-auto inline-flex items-center gap-1.5">{trail}</span> : null}
      </div>
      {children}
      {error ? (
        <p className="text-meta text-severity-must">{error}</p>
      ) : hint ? (
        <p className="text-meta text-ink-muted">{hint}</p>
      ) : null}
    </div>
  )
}
