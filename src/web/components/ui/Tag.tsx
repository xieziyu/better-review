import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

const tag = cva(
  'inline-flex items-center rounded-sm uppercase tracking-caps font-bold leading-none px-1.5 py-0.5 text-[11px] whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'text-ink-secondary border border-rule',
        brand: 'bg-brand/15 text-brand border border-brand/40',
        running: 'text-accent-running border border-accent-running/40',
        success: 'text-accent-ready border border-accent-ready/40',
        warning: 'text-severity-should border border-severity-should/40',
        danger: 'bg-severity-must text-canvas',
        ink: 'bg-ink-primary text-canvas',
      },
    },
    defaultVariants: {
      tone: 'neutral',
    },
  },
)

export interface TagProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof tag> {}

export const Tag = forwardRef<HTMLSpanElement, TagProps>(function Tag(
  { className, tone, children, ...rest },
  ref,
) {
  return (
    <span ref={ref} className={cn(tag({ tone }), className)} {...rest}>
      {children}
    </span>
  )
})
