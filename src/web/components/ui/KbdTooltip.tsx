import type { ReactElement } from 'react'

import { cn } from '@/lib/utils'

import { KbdHint } from './KbdHint'

interface Props {
  keys: string[]
  label?: string
  placement?: 'top' | 'bottom'
  className?: string
  children: ReactElement
}

export function KbdTooltip({ keys, label, placement = 'top', className, children }: Props) {
  return (
    <span className={cn('group/kbd relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 -translate-x-1/2 z-10 px-2 py-1 rounded-sm border border-rule bg-raised shadow-sm whitespace-nowrap',
          'opacity-0 group-hover/kbd:opacity-100 group-focus-within/kbd:opacity-100 transition-opacity duration-180 ease-out-quart',
          placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
        )}
      >
        <KbdHint keys={keys} {...(label !== undefined ? { label } : {})} />
      </span>
    </span>
  )
}
