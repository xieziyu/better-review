import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { Button } from './Button'

interface ConfirmActionProps {
  title: string
  description?: string
  confirmLabel: string
  onConfirm: () => void
  disabled?: boolean
  children: (requestConfirm: () => void) => ReactNode
}

const POPUP_WIDTH = 288 // matches w-72
const VIEWPORT_MARGIN = 8

export function ConfirmAction({
  title,
  description,
  confirmLabel,
  onConfirm,
  disabled,
  children,
}: ConfirmActionProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLSpanElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const compute = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const preferredLeft = rect.right - POPUP_WIDTH
      const maxLeft = window.innerWidth - POPUP_WIDTH - VIEWPORT_MARGIN
      const minLeft = VIEWPORT_MARGIN
      const left = Math.min(Math.max(preferredLeft, minLeft), maxLeft)
      setPosition({ top: rect.bottom + 8, left })
    }
    compute()
    window.addEventListener('resize', compute)
    window.addEventListener('scroll', compute, true)
    return () => {
      window.removeEventListener('resize', compute)
      window.removeEventListener('scroll', compute, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (popupRef.current?.contains(target)) return
      setOpen(false)
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
    <>
      <span ref={triggerRef} className="inline-flex">
        {children(requestConfirm)}
      </span>
      {open && position
        ? createPortal(
            <div
              ref={popupRef}
              role="dialog"
              aria-label={title}
              style={{
                position: 'fixed',
                top: position.top,
                left: position.left,
                width: POPUP_WIDTH,
              }}
              className="z-50 rounded-md border border-rule bg-canvas p-3 text-left shadow-lg"
            >
              <span className="block text-caps tracking-caps text-severity-must uppercase">
                {t('common.confirm')}
              </span>
              <span className="mt-1 block text-body font-medium text-ink-primary">{title}</span>
              {description ? (
                <span className="mt-1 block text-meta text-ink-secondary">{description}</span>
              ) : null}
              <span className="mt-3 flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  {t('common.cancel')}
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
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
