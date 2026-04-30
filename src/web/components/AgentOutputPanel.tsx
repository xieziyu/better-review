import type { SessionStatus } from '@shared/types'
import { Loader2, Terminal } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

interface Props {
  chunks: string[]
  status: SessionStatus
}

const PIN_THRESHOLD_PX = 40

export function AgentOutputPanel({ chunks, status }: Props) {
  const isRunning = status === 'running'
  const [open, setOpen] = useState<boolean>(isRunning)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const pinnedRef = useRef<boolean>(true)

  useEffect(() => {
    setOpen(isRunning)
  }, [isRunning])

  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el || !pinnedRef.current) return
    el.scrollTop = el.scrollHeight
  }, [chunks])

  if (!isRunning && chunks.length === 0) return null

  const onScroll = () => {
    const el = bodyRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    pinnedRef.current = distanceFromBottom <= PIN_THRESHOLD_PX
  }

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="rounded-md border border-gray-200 dark:border-gray-800 overflow-hidden"
    >
      <summary
        className={cn(
          'flex items-center gap-2 px-3 py-2 text-sm cursor-pointer select-none',
          'bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300',
          'hover:bg-gray-100 dark:hover:bg-gray-800/60',
        )}
      >
        <Terminal size={14} className="text-gray-500" aria-hidden />
        <span className="font-medium">Agent output</span>
        {isRunning && (
          <span
            className="inline-flex items-center gap-1 text-xs text-blue-700 dark:text-blue-300"
            aria-label="streaming"
          >
            <Loader2 size={12} className="animate-spin" />
            streaming…
          </span>
        )}
        <span className="ml-auto text-xs font-mono text-gray-500">{chunks.length}</span>
      </summary>
      <div
        ref={bodyRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-label="Agent output transcript"
        className={cn(
          'max-h-[360px] overflow-y-auto px-3 py-2',
          'bg-white dark:bg-gray-950',
          'border-t border-gray-200 dark:border-gray-800',
        )}
      >
        {chunks.length === 0 ? (
          <div className="text-xs text-gray-500 italic">
            Waiting for the agent to start streaming…
          </div>
        ) : (
          <pre className="text-xs font-mono whitespace-pre-wrap break-words text-gray-800 dark:text-gray-200 leading-relaxed">
            {chunks.join('\n')}
          </pre>
        )}
      </div>
    </details>
  )
}
