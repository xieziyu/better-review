import type { SessionStatus } from '@shared/types'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { TranscriptStream } from '@/components/TranscriptStream'
import { useResizable } from '@/lib/use-resizable'
import { cn } from '@/lib/utils'

const HEIGHT_DEFAULT = 240
const HEIGHT_MIN = 120
const HEIGHT_MAX = 480
const HEIGHT_KEY = 'better-review:transcript-drawer:height:v1'
const OPEN_KEY = 'better-review:transcript-drawer:open:v1'

interface UseTranscriptDrawerResult {
  open: boolean
  toggle: () => void
  setOpen: (next: boolean) => void
}

/**
 * Open/closed state for the transcript drawer, persisted across mounts and
 * across sessions (the user's preference is a property of *them*, not of any
 * single review). Height is owned by useResizable inside the drawer itself.
 */
export function useTranscriptDrawer(): UseTranscriptDrawerResult {
  const [open, setOpenState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(OPEN_KEY) === '1'
  })

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(OPEN_KEY, next ? '1' : '0')
    }
  }, [])

  const toggle = useCallback(() => {
    setOpenState((v) => {
      const next = !v
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(OPEN_KEY, next ? '1' : '0')
      }
      return next
    })
  }, [])

  return { open, toggle, setOpen }
}

interface TranscriptDrawerProps {
  chunks: string[]
  status: SessionStatus
  open: boolean
  onToggle: () => void
  onClose: () => void
}

const DRAWER_BODY_ID = 'transcript-drawer-body'

export function TranscriptDrawer({
  chunks,
  status,
  open,
  onToggle,
  onClose,
}: TranscriptDrawerProps) {
  const { t } = useTranslation()

  const isRunning = status === 'running'
  // Mirrors the original AgentOutputPanel rule: avoid leaving a 32 px handle
  // hanging at the bottom of completed sessions that have nothing to show.
  if (!isRunning && chunks.length === 0) return null

  return (
    <DrawerShell
      open={open}
      onToggle={onToggle}
      onClose={onClose}
      handleLabel={t('transcriptDrawer.handleLabel')}
      linesLabel={t('transcriptDrawer.linesLabel', { count: chunks.length })}
      streaming={isRunning}
      streamingLabel={t('transcriptDrawer.streaming')}
      openAria={t('transcriptDrawer.openAria')}
      closeAria={t('transcriptDrawer.closeAria')}
      resizeAria={t('transcriptDrawer.resizeAria')}
    >
      <TranscriptStream chunks={chunks} status={status} />
    </DrawerShell>
  )
}

interface DrawerShellProps {
  open: boolean
  onToggle: () => void
  onClose: () => void
  handleLabel: string
  linesLabel: string
  streaming: boolean
  streamingLabel: string
  openAria: string
  closeAria: string
  resizeAria: string
  children: ReactNode
}

/**
 * Lower-level chrome around TranscriptStream: 32 px handle button (with pulse
 * dot when streaming), top resize handle (only when open), Esc-to-close when
 * focus is inside.
 */
function DrawerShell({
  open,
  onToggle,
  onClose,
  handleLabel,
  linesLabel,
  streaming,
  streamingLabel,
  openAria,
  closeAria,
  resizeAria,
  children,
}: DrawerShellProps) {
  const rootRef = useRef<HTMLElement | null>(null)
  const {
    size: height,
    isDragging,
    separatorProps,
  } = useResizable({
    defaultSize: HEIGHT_DEFAULT,
    min: HEIGHT_MIN,
    max: HEIGHT_MAX,
    storageKey: HEIGHT_KEY,
    edge: 'top',
    ariaLabel: resizeAria,
  })

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const root = rootRef.current
      if (!root) return
      if (root.contains(document.activeElement)) {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <section
      ref={rootRef}
      aria-label={handleLabel}
      className="shrink-0 border-t border-rule bg-raised"
    >
      {open ? (
        <div
          {...separatorProps}
          className={cn(
            'relative w-full h-1.5 cursor-row-resize select-none',
            'transition-colors duration-180 ease-out-quart',
            isDragging ? 'bg-brand' : 'hover:bg-brand/30',
          )}
        />
      ) : null}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={DRAWER_BODY_ID}
        aria-label={open ? closeAria : openAria}
        className="w-full h-8 px-6 flex items-center gap-3 text-ink-secondary hover:text-ink-primary hover:bg-canvas/40 transition-colors duration-180 ease-out-quart"
      >
        {open ? (
          <ChevronDown size={14} className="shrink-0" aria-hidden="true" />
        ) : (
          <ChevronUp size={14} className="shrink-0" aria-hidden="true" />
        )}
        <span className="text-caps tracking-caps uppercase">{handleLabel}</span>
        <span className="text-ink-muted">·</span>
        <span className="font-mono text-meta text-ink-muted tabular-nums">{linesLabel}</span>
        {streaming ? (
          <span className="ml-2 inline-flex items-center gap-1.5 text-caps tracking-caps uppercase text-accent-running">
            <span
              className="inline-block size-1.5 rounded-full bg-accent-running motion-safe:animate-running-pulse"
              aria-hidden="true"
            />
            {streamingLabel}
          </span>
        ) : null}
      </button>
      {open ? (
        <div id={DRAWER_BODY_ID} style={{ height }} className="border-t border-rule flex min-h-0">
          {children}
        </div>
      ) : null}
    </section>
  )
}
