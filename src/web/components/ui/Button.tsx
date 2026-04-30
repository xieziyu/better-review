import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

const button = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors duration-180 ease-out-quart disabled:opacity-40 disabled:cursor-not-allowed select-none',
  {
    variants: {
      variant: {
        primary:
          'bg-brand text-brand-ink hover:[background-color:color-mix(in_oklch,var(--brand)_85%,black)]',
        ink: 'bg-ink-primary text-canvas hover:[background-color:color-mix(in_oklch,var(--ink-primary)_88%,var(--brand))]',
        ghost: 'bg-transparent text-ink-primary hover:bg-raised',
        danger: 'bg-transparent text-severity-must hover:bg-sunken',
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
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cn(button({ variant, size }), className)} {...rest} />
  )
})
