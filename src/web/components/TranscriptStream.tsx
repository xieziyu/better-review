import type { SessionStatus } from '@shared/types'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ScrollPin } from '@/components/ui'

interface Props {
  chunks: string[]
  status: SessionStatus
}

const PIN_THRESHOLD_PX = 40

/**
 * Body-only transcript view: scrollable pre with auto-scroll-to-bottom and a
 * floating ScrollPin when the user scrolls away. No outer chrome — the chrome
 * is owned by the surrounding TranscriptDrawer.
 */
export function TranscriptStream({ chunks, status }: Props) {
  const { t } = useTranslation()
  const isRunning = status === 'running'
  const [unpinned, setUnpinned] = useState(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el || unpinned) return
    el.scrollTop = el.scrollHeight
  }, [chunks, unpinned])

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
    <div className="relative flex flex-col min-h-0 h-full">
      <div
        ref={bodyRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-label={t('transcriptDrawer.transcriptAria')}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-3 bg-sunken"
      >
        {chunks.length === 0 ? (
          <div className="text-meta text-ink-muted italic">
            {isRunning ? t('transcriptDrawer.waiting') : null}
          </div>
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
