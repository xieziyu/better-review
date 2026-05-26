import { ChevronDown } from 'lucide-react'
import { type InputHTMLAttributes, type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

interface ComboboxProps<T> {
  /** Current input value. Always a string — free-text typing is preserved. */
  value: string
  onChange: (next: string) => void
  /** Suggestion list. Empty list still renders the panel (showing `emptyHint`). */
  options: readonly T[]
  /** String that ends up in the input when the option is picked. */
  getValue: (opt: T) => string
  /** React key + selection-compare key. */
  getKey: (opt: T) => string
  /** Row content. `selected` is true when `value` equals `getValue(opt)`. */
  renderOption: (opt: T, selected: boolean) => ReactNode
  /** aria-label for the text input. */
  ariaLabel: string
  /** aria-label for the open suggestion panel. */
  menuAriaLabel: string
  placeholder?: string
  /** Optional content rendered to the left of the input (e.g. a folder icon). */
  leftIcon?: ReactNode
  /** Optional content rendered between the input and the chevron (Browse / Clear / Submit). */
  rightSlot?: ReactNode
  /** Shown inside the panel when `options` is empty. */
  emptyHint?: ReactNode
  /** Forwarded to the underlying <input>. `value`/`onChange`/`ariaLabel` are managed here. */
  inputProps?: Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onChange' | 'aria-label' | 'ref'
  >
  id?: string
}

// Combobox: a free-text input paired with a SelectMenu-styled suggestion
// panel. Mirrors SelectMenu's open/close mechanics (click chevron to
// toggle, focus to open, click-outside / Escape to close); the trigger
// is a real <input> so users can still type values that aren't in the
// list (paths, SHAs, refspecs like `HEAD~3`).
//
// No arrow-key navigation — same conscious tradeoff documented in
// SelectMenu.tsx. The list is short in our use cases (recent repos
// capped at ~10, local-branch count usually well under that).
export function Combobox<T>({
  value,
  onChange,
  options,
  getValue,
  getKey,
  renderOption,
  ariaLabel,
  menuAriaLabel,
  placeholder,
  leftIcon,
  rightSlot,
  emptyHint,
  inputProps,
  id,
}: ComboboxProps<T>) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // After a pick we re-focus the input so keyboard users can keep
  // editing — but onFocus opens the panel, which would immediately
  // re-open the menu the user just closed by selecting. Skip the next
  // focus-open in that case.
  const suppressNextFocusOpen = useRef(false)
  const fallbackId = useId()
  const inputId = id ?? fallbackId

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

  const pick = (opt: T) => {
    onChange(getValue(opt))
    setOpen(false)
    suppressNextFocusOpen.current = true
    // Return focus to the input so keyboard users can keep editing.
    inputRef.current?.focus()
  }

  const showPanel = open && (options.length > 0 || emptyHint != null)

  return (
    <div ref={wrapRef} className="relative flex items-center gap-2 w-full">
      {leftIcon ? (
        <span className="text-ink-muted shrink-0 inline-flex" aria-hidden="true">
          {leftIcon}
        </span>
      ) : null}
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        role="combobox"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (suppressNextFocusOpen.current) {
            suppressNextFocusOpen.current = false
            return
          }
          setOpen(true)
        }}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${inputId}-listbox`}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className="flex-1 min-w-0 py-1.5 bg-transparent text-meta text-ink-primary placeholder:text-ink-muted focus:outline-none font-mono"
        {...inputProps}
      />
      {rightSlot}
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o)
          if (!open) inputRef.current?.focus()
        }}
        aria-label={menuAriaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded text-ink-muted hover:text-ink-primary hover:bg-canvas transition-colors duration-180 ease-out-quart"
      >
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {showPanel ? (
        <div
          id={`${inputId}-listbox`}
          role="listbox"
          aria-label={menuAriaLabel}
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 rounded-md border border-rule bg-canvas py-1 text-left shadow-[0_8px_30px_-12px_color-mix(in_oklch,var(--ink-primary)_30%,transparent)]"
        >
          {options.length === 0 ? (
            <div className="px-3 py-2 text-meta text-ink-muted italic">{emptyHint}</div>
          ) : (
            options.map((option) => {
              const selected = getValue(option) === value
              return (
                <button
                  key={getKey(option)}
                  role="option"
                  aria-selected={selected}
                  type="button"
                  onClick={() => pick(option)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-body transition-colors duration-180 ease-out-quart',
                    selected
                      ? 'text-ink-primary bg-raised/40'
                      : 'text-ink-secondary hover:bg-raised hover:text-ink-primary',
                  )}
                >
                  {renderOption(option, selected)}
                </button>
              )
            })
          )}
        </div>
      ) : null}
    </div>
  )
}
