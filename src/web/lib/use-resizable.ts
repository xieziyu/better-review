import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

export interface UseResizableOptions {
  defaultWidth: number
  min: number
  max: number
  storageKey: string
  edge: 'right' | 'left'
  ariaLabel: string
}

export interface ResizableSeparatorProps {
  role: 'separator'
  'aria-orientation': 'vertical'
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
  width: number
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

function persist(storageKey: string, width: number): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(storageKey, String(width))
}

export function useResizable(opts: UseResizableOptions): UseResizableResult {
  const { defaultWidth, min, max, storageKey, edge, ariaLabel } = opts
  const [width, setWidth] = useState<number>(() => readStored(storageKey, defaultWidth, min, max))
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = { startX: e.clientX, startW: width }
      setIsDragging(true)
    },
    [width],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag) return
      const dx = e.clientX - drag.startX
      const direction = edge === 'right' ? 1 : -1
      setWidth(clamp(drag.startW + direction * dx, min, max))
    },
    [edge, min, max],
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
      setWidth((current) => {
        persist(storageKey, current)
        return current
      })
    },
    [storageKey],
  )

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      const step = e.shiftKey ? 32 : 8
      const grow = edge === 'right' ? e.key === 'ArrowRight' : e.key === 'ArrowLeft'
      setWidth((w) => {
        const next = clamp(w + (grow ? step : -step), min, max)
        persist(storageKey, next)
        return next
      })
    },
    [edge, min, max, storageKey],
  )

  return {
    width,
    isDragging,
    separatorProps: {
      role: 'separator',
      'aria-orientation': 'vertical',
      'aria-label': ariaLabel,
      'aria-valuenow': width,
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
