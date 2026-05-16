import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

interface ToastInput {
  message: string
  durationMs?: number
  actionLabel?: string
  onAction?: () => void
}

interface ToastItem extends ToastInput {
  id: number
}

interface ToastContextValue {
  push: (toast: ToastInput) => void
}

const DEFAULT_DURATION = 4000
const MAX_STACK = 3

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id)
    if (t) {
      clearTimeout(t)
      timers.current.delete(id)
    }
    setItems((prev) => prev.filter((x) => x.id !== id))
  }, [])

  const push = useCallback(
    (toast: ToastInput) => {
      const id = ++seq.current
      const item: ToastItem = { ...toast, id }
      setItems((prev) => {
        const next = [...prev, item]
        if (next.length > MAX_STACK) {
          const overflow = next.slice(0, next.length - MAX_STACK)
          overflow.forEach((o) => {
            const t = timers.current.get(o.id)
            if (t) clearTimeout(t)
            timers.current.delete(o.id)
          })
          return next.slice(-MAX_STACK)
        }
        return next
      })
      const duration = toast.durationMs ?? DEFAULT_DURATION
      const handle = setTimeout(() => dismiss(id), duration)
      timers.current.set(id, handle)
    },
    [dismiss],
  )

  useEffect(() => {
    const map = timers.current
    return () => {
      map.forEach((t) => clearTimeout(t))
      map.clear()
    }
  }, [])

  const value = useMemo(() => ({ push }), [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2"
      >
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            className="pointer-events-auto max-w-sm rounded-md border border-rule bg-raised text-sm text-ink-primary shadow-md px-3 py-2 flex items-center gap-3 motion-safe:animate-fade-in"
          >
            <span className="flex-1">{item.message}</span>
            {item.actionLabel ? (
              <button
                type="button"
                onClick={() => {
                  item.onAction?.()
                  dismiss(item.id)
                }}
                className="text-brand text-xs font-medium uppercase tracking-wide hover:underline"
              >
                {item.actionLabel}
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(item.id)}
              className="text-ink-muted hover:text-ink-primary text-xs"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    return { push: () => {} }
  }
  return ctx
}
