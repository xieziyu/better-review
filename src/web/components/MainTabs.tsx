import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { cn } from '@/lib/utils'

export type MainTabKey = 'findings' | 'transcript'

interface Props {
  findings: React.ReactNode
  transcript: React.ReactNode
  /** Number badge displayed next to the Findings tab. */
  findingsCount?: number
  /** Marker shown next to the Transcript tab while streaming. */
  transcriptStreaming?: boolean
}

const TAB_KEYS: readonly MainTabKey[] = ['findings', 'transcript']

function isMainTabKey(value: string | null): value is MainTabKey {
  return value === 'findings' || value === 'transcript'
}

export function MainTabs({ findings, transcript, findingsCount, transcriptStreaming }: Props) {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const active: MainTabKey = isMainTabKey(raw) ? raw : 'findings'

  const setActive = (key: MainTabKey) => {
    const next = new URLSearchParams(params)
    if (key === 'findings') next.delete('tab')
    else next.set('tab', key)
    setParams(next, { replace: true })
  }

  return (
    <div className="flex flex-col min-h-0">
      <div
        role="tablist"
        aria-label={t('mainTabs.ariaLabel')}
        className="flex items-center gap-1 border-b border-rule"
      >
        {TAB_KEYS.map((key) => {
          const selected = active === key
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`tabpanel-${key}`}
              id={`tab-${key}`}
              onClick={() => setActive(key)}
              className={cn(
                'relative inline-flex items-center gap-1.5 px-3 h-10 text-caps tracking-caps uppercase transition-colors duration-180 ease-out-quart',
                selected
                  ? 'text-ink-primary'
                  : 'text-ink-muted hover:text-ink-secondary',
              )}
            >
              <span>{t(`mainTabs.${key}`)}</span>
              {key === 'findings' && typeof findingsCount === 'number' ? (
                <span className="font-mono text-meta text-ink-muted tabular-nums">
                  {findingsCount}
                </span>
              ) : null}
              {key === 'transcript' && transcriptStreaming ? (
                <span
                  aria-hidden="true"
                  className="inline-block size-1.5 rounded-full bg-accent-running animate-running-pulse"
                />
              ) : null}
              <span
                aria-hidden="true"
                className={cn(
                  'absolute left-0 right-0 -bottom-px h-[2px]',
                  selected ? 'bg-brand' : 'bg-transparent',
                )}
              />
            </button>
          )
        })}
      </div>
      <div
        id={`tabpanel-${active}`}
        role="tabpanel"
        aria-labelledby={`tab-${active}`}
        className="flex-1 min-h-0 pt-4"
      >
        {active === 'findings' ? findings : transcript}
      </div>
    </div>
  )
}
