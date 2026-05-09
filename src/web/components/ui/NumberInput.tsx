import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type InputHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

const input = cva(
  'block w-full rounded-md border bg-raised px-3 text-body text-ink-primary tabular-nums placeholder:text-ink-muted transition-[border-color,box-shadow,background-color] duration-180 ease-out-quart focus:outline-none focus:border-brand focus:bg-canvas focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--brand)_16%,transparent)] disabled:opacity-40 disabled:cursor-not-allowed',
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

export interface NumberInputProps
  extends
    Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'>,
    VariantProps<typeof input> {}

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { className, size, tone, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type="number"
      inputMode="numeric"
      className={cn(input({ size, tone }), className)}
      {...rest}
    />
  )
})
