import { Check, ChevronDown } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

interface SelectMenuProps<T> {
  value: T | null
  options: readonly T[]
  onChange: (value: T) => void
  getKey: (value: T) => string
  /** Content rendered inside the closed trigger button for the current value. */
  renderTrigger: (value: T) => ReactNode
  /**
   * Content rendered inside the trigger when `value` is null. Required only
   * when callers actually pass null; existing callers that always have a
   * value can omit it.
   */
  renderEmpty?: () => ReactNode
  /** Content rendered inside each menu item. */
  renderOption: (value: T, selected: boolean) => ReactNode
  /** aria-label for the trigger button. */
  ariaLabel: string
  /** aria-label for the open menu. */
  menuAriaLabel: string
  id?: string
}

// A custom dropdown that looks like a native <select> but renders rich option
// content (icons, status marks). Mechanics mirror LanguageSwitcher: click to
// toggle, click-outside or Escape to close. No arrow-key navigation — parity
// with the existing LanguageSwitcher pattern.
export function SelectMenu<T>({
  value,
  options,
  onChange,
  getKey,
  renderTrigger,
  renderEmpty,
  renderOption,
  ariaLabel,
  menuAriaLabel,
  id,
}: SelectMenuProps<T>) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const select = (next: T) => {
    setOpen(false)
    if (value === null || getKey(next) !== getKey(value)) onChange(next)
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        id={id}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-full items-center gap-2 rounded-md border border-rule bg-raised pl-3 pr-8 text-left text-body text-ink-primary transition-[border-color,box-shadow,background-color] duration-180 ease-out-quart hover:border-ink-muted focus:outline-none focus:border-brand focus:bg-canvas focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--brand)_16%,transparent)]"
      >
        {value === null ? (renderEmpty ? renderEmpty() : null) : renderTrigger(value)}
        <ChevronDown
          aria-hidden="true"
          size={12}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted"
        />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={menuAriaLabel}
          className="absolute left-0 top-[calc(100%+4px)] z-30 w-full rounded-md border border-rule bg-canvas py-1 text-left shadow-[0_8px_30px_-12px_color-mix(in_oklch,var(--ink-primary)_30%,transparent)]"
        >
          {options.map((option) => {
            const selected = value !== null && getKey(option) === getKey(value)
            return (
              <button
                key={getKey(option)}
                role="menuitemradio"
                aria-checked={selected}
                type="button"
                onClick={() => select(option)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-body transition-colors duration-180 ease-out-quart',
                  selected
                    ? 'text-ink-primary'
                    : 'text-ink-secondary hover:bg-raised hover:text-ink-primary',
                )}
              >
                {renderOption(option, selected)}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

// Fixed-width selected-check slot for use inside renderOption, so rows don't
// shift between selected and unselected states.
export function SelectMenuCheck({ selected }: { selected: boolean }) {
  return (
    <span aria-hidden="true" className="inline-flex w-3 shrink-0 justify-center">
      {selected ? <Check size={12} /> : null}
    </span>
  )
}
