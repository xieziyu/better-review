import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

export type ResizableEdge = 'right' | 'left' | 'top' | 'bottom'

export interface UseResizableOptions {
  /** Initial size along the resize axis (width for horizontal, height for vertical). */
  defaultSize: number
  min: number
  max: number
  storageKey: string
  edge: ResizableEdge
  ariaLabel: string
}

export interface ResizableSeparatorProps {
  role: 'separator'
  'aria-orientation': 'vertical' | 'horizontal'
  'aria-label': string
  'aria-valuenow': number
  'aria-valuemin': number
  'aria-valuemax': number
  tabIndex: 0
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void
  onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void
}

export interface UseResizableResult {
  /** Current size along the axis (width or height in px). */
  size: number
  isDragging: boolean
  separatorProps: ResizableSeparatorProps
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function readStored(storageKey: string, fallback: number, min: number, max: number): number {
  if (typeof window === 'undefined') return fallback
  const raw = window.localStorage.getItem(storageKey)
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (!Number.isFinite(n)) return fallback
  return clamp(n, min, max)
}

function persist(storageKey: string, size: number): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(storageKey, String(size))
}

export function useResizable(opts: UseResizableOptions): UseResizableResult {
  const { defaultSize, min, max, storageKey, edge, ariaLabel } = opts
  const axis: 'x' | 'y' = edge === 'top' || edge === 'bottom' ? 'y' : 'x'
  // The separator is perpendicular to the resize axis: horizontal axis → vertical
  // separator (a vertical divider that slides left/right); vertical axis → horizontal
  // separator (a horizontal divider that slides up/down).
  const ariaOrientation: 'vertical' | 'horizontal' = axis === 'x' ? 'vertical' : 'horizontal'

  const [size, setSize] = useState<number>(() => readStored(storageKey, defaultSize, min, max))
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ start: number; startSize: number } | null>(null)

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      const start = axis === 'x' ? e.clientX : e.clientY
      dragRef.current = { start, startSize: size }
      setIsDragging(true)
    },
    [axis, size],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag) return
      const current = axis === 'x' ? e.clientX : e.clientY
      const delta = current - drag.start
      // edge === 'right' or 'bottom' → drag away from origin grows the panel.
      const direction = edge === 'right' || edge === 'bottom' ? 1 : -1
      setSize(clamp(drag.startSize + direction * delta, min, max))
    },
    [axis, edge, min, max],
  )

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // pointer capture may already be released or unsupported
      }
      dragRef.current = null
      setIsDragging(false)
      setSize((current) => {
        persist(storageKey, current)
        return current
      })
    },
    [storageKey],
  )

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const horizontal = axis === 'x'
      const minus = horizontal ? 'ArrowLeft' : 'ArrowUp'
      const plus = horizontal ? 'ArrowRight' : 'ArrowDown'
      if (e.key !== minus && e.key !== plus) return
      e.preventDefault()
      const step = e.shiftKey ? 32 : 8
      // For 'right' or 'bottom' edges, ArrowRight/ArrowDown grows; otherwise it shrinks.
      const positiveGrows = edge === 'right' || edge === 'bottom'
      const grow = positiveGrows ? e.key === plus : e.key === minus
      setSize((s) => {
        const next = clamp(s + (grow ? step : -step), min, max)
        persist(storageKey, next)
        return next
      })
    },
    [axis, edge, min, max, storageKey],
  )

  return {
    size,
    isDragging,
    separatorProps: {
      role: 'separator',
      'aria-orientation': ariaOrientation,
      'aria-label': ariaLabel,
      'aria-valuenow': size,
      'aria-valuemin': min,
      'aria-valuemax': max,
      tabIndex: 0,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onKeyDown,
    },
  }
}
