import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Button } from './Button'

interface ConfirmActionProps {
  title: string
  description?: string
  confirmLabel: string
  onConfirm: () => void
  disabled?: boolean
  children: (requestConfirm: () => void) => ReactNode
}

export function ConfirmAction({
  title,
  description,
  confirmLabel,
  onConfirm,
  disabled,
  children,
}: ConfirmActionProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const requestConfirm = () => {
    if (!disabled) setOpen(true)
  }

  return (
    <span ref={ref} className="relative inline-flex">
      {children(requestConfirm)}
      {open ? (
        <span
          role="dialog"
          aria-label={title}
          className="absolute right-0 top-[calc(100%+8px)] z-30 w-72 rounded-md border border-rule bg-canvas p-3 text-left"
        >
          <span className="block text-caps tracking-caps text-severity-must uppercase">
            Confirm
          </span>
          <span className="mt-1 block text-body font-medium text-ink-primary">{title}</span>
          {description ? (
            <span className="mt-1 block text-meta text-ink-secondary">{description}</span>
          ) : null}
          <span className="mt-3 flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={() => {
                setOpen(false)
                onConfirm()
              }}
            >
              {confirmLabel}
            </Button>
          </span>
        </span>
      ) : null}
    </span>
  )
}
