import { ArrowDown } from 'lucide-react'

import { cn } from '@/lib/utils'

interface Props {
  pinnedLines: number
  onFollow: () => void
  className?: string
}

export function ScrollPin({ pinnedLines, onFollow, className }: Props) {
  if (pinnedLines <= 0) return null
  return (
    <button
      type="button"
      onClick={onFollow}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md bg-ink-primary text-canvas px-2.5 py-1 text-caps uppercase tracking-caps shadow-[0_0_0_1px_var(--rule)] hover:[background-color:color-mix(in_oklch,var(--ink-primary)_85%,var(--brand))] transition-colors duration-180 ease-out-quart',
        className,
      )}
      aria-label="follow stream to bottom"
    >
      <ArrowDown size={12} aria-hidden="true" />
      <span>{pinnedLines}</span>
      <span className="text-ink-muted/60">·</span>
      <span>follow</span>
    </button>
  )
}
