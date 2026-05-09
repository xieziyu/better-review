import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type SelectHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

const select = cva(
  'block w-full rounded-md border bg-raised pl-3 pr-8 text-body text-ink-primary appearance-none transition-[border-color,box-shadow,background-color] duration-180 ease-out-quart focus:outline-none focus:border-brand focus:bg-canvas focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--brand)_16%,transparent)] disabled:opacity-40 disabled:cursor-not-allowed',
  {
    variants: {
      size: {
        sm: 'h-7 text-meta',
        md: 'h-9 text-body',
        lg: 'h-11 text-h2',
      },
      tone: {
        default: 'border-rule',
        error:
          'border-severity-must focus:border-severity-must focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--severity-must)_16%,transparent)]',
      },
    },
    defaultVariants: { size: 'md', tone: 'default' },
  },
)

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'>, VariantProps<typeof select> {}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, size, tone, children, ...rest },
  ref,
) {
  return (
    <span className="relative inline-flex w-full">
      <select ref={ref} className={cn(select({ size, tone }), className)} {...rest}>
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 12 12"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 size-3 text-ink-muted"
      >
        <path
          d="M2 4.5l4 4 4-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
})
