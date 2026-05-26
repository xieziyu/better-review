import type { AgentKind, PrepCall, PrepStep, SessionStatus } from '@shared/types'
import { ChevronDown, ChevronUp, Maximize2, Minimize2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ActivityTimeline } from '@/components/ActivityTimeline'
import { useResizable } from '@/lib/use-resizable'
import { cn } from '@/lib/utils'

const HEIGHT_DEFAULT = 240
const HEIGHT_MIN = 120
const HEIGHT_MAX = 480
const HEIGHT_KEY = 'better-review:transcript-drawer:height:v1'
const OPEN_KEY = 'better-review:transcript-drawer:open:v1'

interface UseTranscriptDrawerResult {
  open: boolean
  maximized: boolean
  toggle: () => void
  setOpen: (next: boolean) => void
  toggleMaximize: () => void
}

/**
 * Open/closed state for the transcript drawer, persisted across mounts and
 * across sessions (the user's preference is a property of *them*, not of any
 * single review). Height is owned by useResizable inside the drawer itself.
 *
 * `maximized` is intentionally *not* persisted: every PRDetail mount starts in
 * the normal (bottom-drawer) layout so the findings workspace is always the
 * first thing the user sees. Closing the drawer also drops the maximized flag.
 */
export function useTranscriptDrawer(): UseTranscriptDrawerResult {
  const [open, setOpenState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(OPEN_KEY) === '1'
  })
  const [maximized, setMaximized] = useState(false)

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next)
    if (!next) setMaximized(false)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(OPEN_KEY, next ? '1' : '0')
    }
  }, [])

  const toggle = useCallback(() => {
    setOpenState((v) => {
      const next = !v
      if (!next) setMaximized(false)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(OPEN_KEY, next ? '1' : '0')
      }
      return next
    })
  }, [])

  const toggleMaximize = useCallback(() => {
    setMaximized((m) => {
      const next = !m
      // Maximizing implies opening — there's nothing to maximize when closed.
      if (next) {
        setOpenState(true)
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(OPEN_KEY, '1')
        }
      }
      return next
    })
  }, [])

  return { open, maximized, toggle, setOpen, toggleMaximize }
}

interface TranscriptDrawerProps {
  chunks: string[]
  prepSteps: PrepStep[]
  prepCalls: PrepCall[]
  status: SessionStatus
  agent?: AgentKind | undefined
  workdir?: string | undefined
  open: boolean
  maximized: boolean
  onToggle: () => void
  onClose: () => void
  onToggleMaximize: () => void
}

const DRAWER_BODY_ID = 'transcript-drawer-body'

export function TranscriptDrawer({
  chunks,
  prepSteps,
  prepCalls,
  status,
  agent,
  workdir,
  open,
  maximized,
  onToggle,
  onClose,
  onToggleMaximize,
}: TranscriptDrawerProps) {
  const { t } = useTranslation()

  const isRunning = status === 'running'
  const isPending = status === 'pending'
  const hasPrep = prepSteps.length > 0 || prepCalls.length > 0
  // Mirrors the original AgentOutputPanel rule: don't render the drawer
  // handle if there's literally nothing to show. With prep observability,
  // an active prep phase counts as "something to show" even before the
  // agent starts streaming.
  if (!isRunning && !isPending && chunks.length === 0 && !hasPrep) return null

  // Count unique phases the way ActivityTimeline.bucketize does: a phase can
  // be marked multiple times (e.g. renderingPrompt is re-marked for excluded
  // files), and calls can produce synthetic buckets when no step event fired.
  // Using prepSteps.length here would diverge from the rendered node count.
  const phaseCount = new Set([...prepSteps.map((s) => s.phase), ...prepCalls.map((c) => c.phase)])
    .size
  const linesLabel = hasPrep
    ? t('transcriptDrawer.phasesAndLines', { phases: phaseCount, lines: chunks.length })
    : t('transcriptDrawer.linesLabel', { count: chunks.length })

  const effectiveMaximized = open && maximized

  return (
    <DrawerShell
      open={open}
      maximized={effectiveMaximized}
      onToggle={onToggle}
      onClose={onClose}
      onToggleMaximize={onToggleMaximize}
      handleLabel={t('transcriptDrawer.handleLabel')}
      linesLabel={linesLabel}
      streaming={isRunning || isPending}
      streamingLabel={t('transcriptDrawer.streaming')}
      openAria={t('transcriptDrawer.openAria')}
      closeAria={t('transcriptDrawer.closeAria')}
      maximizeAria={t('transcriptDrawer.maximizeAria')}
      restoreAria={t('transcriptDrawer.restoreAria')}
      maximizedTag={t('transcriptDrawer.maximizedTag')}
      resizeAria={t('transcriptDrawer.resizeAria')}
    >
      <ActivityTimeline
        prepSteps={prepSteps}
        prepCalls={prepCalls}
        chunks={chunks}
        status={status}
        agent={agent}
        workdir={workdir}
      />
    </DrawerShell>
  )
}

interface DrawerShellProps {
  open: boolean
  maximized: boolean
  onToggle: () => void
  onClose: () => void
  onToggleMaximize: () => void
  handleLabel: string
  linesLabel: string
  streaming: boolean
  streamingLabel: string
  openAria: string
  closeAria: string
  maximizeAria: string
  restoreAria: string
  maximizedTag: string
  resizeAria: string
  children: ReactNode
}

/**
 * Lower-level chrome around TranscriptStream: 32 px handle button (with pulse
 * dot when streaming), top resize handle (only when open), Esc-to-close when
 * focus is inside.
 *
 * In `maximized` mode the host (SessionDetail) hides the findings workspace
 * above the drawer and the drawer itself flexes to fill all remaining space —
 * so we drop the fixed-height body and use flex sizing instead. The top resize
 * handle is also suppressed because there's nothing to resize against.
 */
function DrawerShell({
  open,
  maximized,
  onToggle,
  onClose,
  onToggleMaximize,
  handleLabel,
  linesLabel,
  streaming,
  streamingLabel,
  openAria,
  closeAria,
  maximizeAria,
  restoreAria,
  maximizedTag,
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
        // Escape inside the drawer first restores from maximized, then closes.
        // This matches the two-step affordance of the toggle button: the user
        // can peek-and-leave without losing their open state.
        if (maximized) onToggleMaximize()
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, maximized, onClose, onToggleMaximize])

  return (
    <section
      ref={rootRef}
      aria-label={handleLabel}
      className={cn(
        'border-t border-rule bg-raised',
        maximized ? 'flex-1 min-h-0 flex flex-col' : 'shrink-0',
      )}
    >
      {open && !maximized ? (
        <div
          {...separatorProps}
          className={cn(
            'relative w-full h-1.5 cursor-row-resize select-none',
            'transition-colors duration-180 ease-out-quart',
            isDragging ? 'bg-brand' : 'hover:bg-brand/30',
          )}
        />
      ) : null}
      <div
        className={cn(
          'w-full h-8 pr-2 pl-0 flex items-stretch text-ink-secondary',
          maximized && 'bg-accent-active/8',
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={DRAWER_BODY_ID}
          aria-label={open ? closeAria : openAria}
          className="flex-1 min-w-0 h-full px-6 flex items-center gap-3 hover:text-ink-primary hover:bg-canvas/40 transition-colors duration-180 ease-out-quart"
        >
          {open ? (
            <ChevronDown size={14} className="shrink-0" aria-hidden="true" />
          ) : (
            <ChevronUp size={14} className="shrink-0" aria-hidden="true" />
          )}
          <span className="text-caps tracking-caps uppercase">{handleLabel}</span>
          {maximized ? (
            <>
              <span className="text-ink-muted">·</span>
              <span className="text-caps tracking-caps uppercase text-accent-active">
                {maximizedTag}
              </span>
            </>
          ) : null}
          <span className="text-ink-muted">·</span>
          <span className="font-mono text-meta text-ink-muted tabular-nums">{linesLabel}</span>
          {streaming ? (
            <span className="ml-2 inline-flex items-center gap-1.5 text-caps tracking-caps uppercase text-accent-active">
              <span
                className="inline-block size-1.5 rounded-full bg-accent-active motion-safe:animate-running-pulse"
                aria-hidden="true"
              />
              {streamingLabel}
            </span>
          ) : null}
        </button>
        {open ? (
          <button
            type="button"
            onClick={onToggleMaximize}
            aria-label={maximized ? restoreAria : maximizeAria}
            aria-pressed={maximized}
            title={maximized ? restoreAria : maximizeAria}
            className="shrink-0 inline-flex items-center justify-center size-8 text-ink-muted hover:text-ink-primary hover:bg-canvas/40 rounded-sm transition-colors duration-180 ease-out-quart"
          >
            {maximized ? (
              <Minimize2 size={14} aria-hidden="true" />
            ) : (
              <Maximize2 size={14} aria-hidden="true" />
            )}
          </button>
        ) : null}
      </div>
      {open ? (
        <div
          id={DRAWER_BODY_ID}
          style={maximized ? undefined : { height }}
          className={cn('border-t border-rule flex min-h-0', maximized && 'flex-1')}
        >
          {children}
        </div>
      ) : null}
    </section>
  )
}
