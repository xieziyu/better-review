import type { Severity } from '@shared/findings-schema'
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
import { useTranslation } from 'react-i18next'

import { SeverityLabel } from '@/components/ui/SeverityLabel'

interface ToastInput {
  title: string
  file: string
  line?: number
  severity: Severity
  onClick?: () => void
  persistent?: boolean
  durationMs?: number
}

interface ToastItem extends ToastInput {
  id: number
}

interface ToastContextValue {
  push: (toast: ToastInput) => void
}

const DEFAULT_DURATION = 6000
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

  const scheduleDismiss = useCallback(
    (id: number, durationMs: number) => {
      const handle = setTimeout(() => dismiss(id), durationMs)
      timers.current.set(id, handle)
    },
    [dismiss],
  )

  const pause = useCallback((id: number) => {
    const t = timers.current.get(id)
    if (t) {
      clearTimeout(t)
      timers.current.delete(id)
    }
  }, [])

  const resume = useCallback(
    (item: ToastItem) => {
      if (item.persistent) return
      if (timers.current.has(item.id)) return
      scheduleDismiss(item.id, item.durationMs ?? DEFAULT_DURATION)
    },
    [scheduleDismiss],
  )

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
      if (!toast.persistent) {
        scheduleDismiss(id, toast.durationMs ?? DEFAULT_DURATION)
      }
    },
    [scheduleDismiss],
  )

  useEffect(() => {
    const map = timers.current
    return () => {
      map.forEach((t) => clearTimeout(t))
      map.clear()
    }
  }, [])

  const value = useMemo(() => ({ push }), [push])

  const newestId = items.length > 0 ? items[items.length - 1]?.id : undefined

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col-reverse items-end gap-2"
      >
        {items.map((item) => (
          <PeekToast
            key={item.id}
            item={item}
            stacked={item.id !== newestId}
            onDismiss={() => dismiss(item.id)}
            onPause={() => pause(item.id)}
            onResume={() => resume(item)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

interface PeekToastProps {
  item: ToastItem
  stacked: boolean
  onDismiss: () => void
  onPause: () => void
  onResume: () => void
}

function PeekToast({ item, stacked, onDismiss, onPause, onResume }: PeekToastProps) {
  const { t } = useTranslation()
  const { title, file, line, severity, onClick } = item

  const handleClick = useCallback(() => {
    onClick?.()
    onDismiss()
  }, [onClick, onDismiss])

  const { base, dir } = splitPath(file)

  return (
    <div
      role="button"
      tabIndex={0}
      data-stacked={stacked ? 'true' : undefined}
      data-severity={severity}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleClick()
        }
      }}
      onMouseEnter={onPause}
      onMouseLeave={onResume}
      onFocus={onPause}
      onBlur={onResume}
      className="group pointer-events-auto relative w-[360px] cursor-pointer bg-raised border border-rule transition-[transform,border-color] duration-180 ease-out-quart hover:-translate-y-px hover:border-[--anchor] focus-visible:border-[--anchor] motion-safe:animate-peek-in"
    >
      <span
        aria-hidden="true"
        className="absolute -left-px -top-px -bottom-px w-0.5 bg-[--anchor] group-data-[stacked=true]:bg-ink-muted group-data-[stacked=true]:opacity-50"
      />

      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-rule">
        <SeverityLabel level={severity} />
        <span className="flex-1 min-w-0 truncate font-mono text-[11.5px] text-ink-secondary">
          <strong className="font-semibold text-ink-primary">{base}</strong>
          {line != null ? `:${line}` : ''}
          {dir ? <span className="text-ink-muted"> · {dir}</span> : null}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDismiss()
          }}
          aria-label={t('filesChanged.toast.dismiss')}
          className="font-mono text-[13px] leading-none text-ink-muted hover:text-ink-primary"
        >
          ×
        </button>
      </div>

      {!stacked && (
        <>
          <div className="px-3 py-2.5">
            <div className="text-[13.5px] font-semibold leading-[19px] line-clamp-2 text-ink-primary">
              {title}
            </div>
          </div>
          <div className="flex items-center justify-between px-3 py-2 border-t border-rule bg-sunken">
            <span className="font-mono text-[11px] text-ink-muted">
              {t('filesChanged.toast.clickHint')}
            </span>
            <span className="inline-flex items-center gap-1.5 text-caps font-bold tracking-caps uppercase text-[--anchor]">
              {t('filesChanged.toast.jump')}
              <span aria-hidden="true">↗</span>
            </span>
          </div>
        </>
      )}
    </div>
  )
}

function splitPath(file: string): { base: string; dir: string } {
  const idx = file.lastIndexOf('/')
  if (idx === -1) return { base: file, dir: '' }
  return { base: file.slice(idx + 1), dir: file.slice(0, idx) }
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    return { push: () => {} }
  }
  return ctx
}
