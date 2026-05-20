import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type TextareaHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

const textarea = cva(
  'block w-full rounded-md border bg-raised px-3 py-2 font-mono text-code text-ink-primary placeholder:text-ink-muted transition-[border-color,box-shadow,background-color] duration-180 ease-out-quart focus:outline-none focus:border-brand focus:bg-canvas focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--brand)_16%,transparent)] disabled:opacity-40 disabled:cursor-not-allowed resize-y',
  {
    variants: {
      tone: {
        default: 'border-rule',
        error:
          'border-severity-must focus:border-severity-must focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--severity-must)_16%,transparent)]',
      },
    },
    defaultVariants: { tone: 'default' },
  },
)

export interface TextAreaProps
  extends
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'>,
    VariantProps<typeof textarea> {}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className, tone, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(textarea({ tone }), className)} {...rest} />
})
