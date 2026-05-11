import type { SessionStatus } from '@shared/types'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ScrollPin } from '@/components/ui'

interface Props {
  chunks: string[]
  status: SessionStatus
}

const PIN_THRESHOLD_PX = 40

export function AgentOutputPanel({ chunks, status }: Props) {
  const { t } = useTranslation()
  const isRunning = status === 'running'
  const [open, setOpen] = useState<boolean>(isRunning)
  const [unpinned, setUnpinned] = useState(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setOpen(isRunning)
  }, [isRunning])

  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el || unpinned) return
    el.scrollTop = el.scrollHeight
  }, [chunks, unpinned])

  if (!isRunning && chunks.length === 0) return null

  const onScroll = () => {
    const el = bodyRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setUnpinned(distanceFromBottom > PIN_THRESHOLD_PX)
  }

  const followBottom = () => {
    setUnpinned(false)
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="group rounded-md border border-rule overflow-hidden bg-raised/40"
    >
      <summary className="flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
        <span className="text-caps tracking-caps text-ink-muted uppercase">
          {t('agentOutput.label')}
        </span>
        {isRunning ? (
          <span
            className="inline-flex items-center gap-1.5 text-caps tracking-caps text-accent-running uppercase"
            aria-label={t('agentOutput.streaming')}
          >
            <span
              className="inline-block size-1.5 rounded-full bg-accent-running animate-running-pulse"
              aria-hidden="true"
            />
            {t('agentOutput.streaming')}
          </span>
        ) : null}
        <span className="ml-auto font-mono text-meta text-ink-secondary tabular-nums">
          {chunks.length}
        </span>
      </summary>
      <div className="relative border-t border-rule">
        <div
          ref={bodyRef}
          onScroll={onScroll}
          role="log"
          aria-live="polite"
          aria-label={t('agentOutput.transcriptAria')}
          className="max-h-[420px] overflow-y-auto px-4 py-3 bg-sunken"
        >
          {chunks.length === 0 ? (
            <div className="text-meta text-ink-muted italic">{t('agentOutput.waiting')}</div>
          ) : (
            <pre className="font-mono text-code text-ink-primary whitespace-pre-wrap break-words">
              {chunks.join('\n')}
            </pre>
          )}
        </div>
        {unpinned && chunks.length > 0 ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-end pr-3">
            <div className="pointer-events-auto">
              <ScrollPin pinnedLines={chunks.length} onFollow={followBottom} />
            </div>
          </div>
        ) : null}
      </div>
    </details>
  )
}
