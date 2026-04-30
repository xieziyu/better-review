import { Fragment } from 'react'

import { cn } from '@/lib/utils'

interface Props {
  keys: string[]
  label?: string
  className?: string
}

export function KbdHint({ keys, label, className }: Props) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-caps text-ink-muted', className)}>
      <span className="inline-flex items-center gap-0.5">
        {keys.map((k, i) => (
          <Fragment key={`${k}-${i}`}>
            {i > 0 ? <span aria-hidden="true">+</span> : null}
            <kbd className="inline-flex items-center justify-center min-w-[1.4em] h-[1.4em] px-1 rounded-sm border border-rule font-mono text-[10px] font-semibold leading-none text-ink-secondary bg-canvas">
              {k}
            </kbd>
          </Fragment>
        ))}
      </span>
      {label ? <span className="lowercase tracking-normal font-medium">{label}</span> : null}
    </span>
  )
}
