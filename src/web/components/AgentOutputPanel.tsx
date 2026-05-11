import type { SessionStatus } from '@shared/types'
import { useLayoutEffect, useRef, useState } from 'react'
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
  const [unpinned, setUnpinned] = useState(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)

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
    <div className="relative flex flex-col min-h-0 h-full bg-sunken border border-rule rounded-md overflow-hidden">
      <header className="flex items-center gap-3 px-4 py-2 border-b border-rule bg-raised/40 shrink-0">
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
      </header>
      <div
        ref={bodyRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-label={t('agentOutput.transcriptAria')}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-3"
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
  )
}
