import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

const button = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors duration-180 ease-out-quart disabled:opacity-40 disabled:cursor-not-allowed select-none',
  {
    variants: {
      variant: {
        primary:
          'border-[color:var(--btn-primary-border)] bg-[color:var(--btn-primary-bg)] text-[color:var(--btn-primary-ink)] hover:bg-[color:color-mix(in_oklch,var(--btn-primary-bg)_85%,var(--btn-primary-border))]',
        ghost:
          'border-rule bg-raised/35 text-ink-primary hover:bg-raised hover:border-ink-muted active:bg-sunken',
        danger:
          'border-rule bg-transparent text-severity-must hover:bg-sunken hover:border-severity-must/50 active:bg-sunken',
      },
      size: {
        sm: 'h-7 px-2.5 text-meta',
        md: 'h-9 px-3.5 text-body',
        lg: 'h-11 px-5 text-h2',
      },
    },
    defaultVariants: {
      variant: 'ghost',
      size: 'md',
    },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cn(button({ variant, size }), className)} {...rest} />
  )
})
