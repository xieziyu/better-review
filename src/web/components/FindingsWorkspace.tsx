import type { Finding, PRSession } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FindingDetailDrawer } from '@/components/FindingDetailDrawer'
import { FindingDetailPanel } from '@/components/FindingDetailPanel'
import { FindingList } from '@/components/FindingList'
import { EmptyState } from '@/components/ui'
import { api } from '@/lib/api'
import { useSelectedFinding } from '@/lib/selection'
import { useResizable } from '@/lib/use-resizable'
import { cn } from '@/lib/utils'

const LIST_DEFAULT = 380
const LIST_MIN = 320
const LIST_MAX = 560
const LIST_KEY = 'better-review:findings-list-width:v1'
const WIDE_QUERY = '(min-width: 1280px)'

function readWide(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia(WIDE_QUERY).matches
}

interface Props {
  findings: Finding[]
  session: PRSession
  /** Pre-fetched diff from PRDetail's main session query, when available. */
  unifiedDiff: string | null
  selectedCount: number
}

export function FindingsWorkspace({ findings, session, unifiedDiff, selectedCount }: Props) {
  const { t } = useTranslation()
  const { selectedFindingDbId, setSelectedFindingDbId } = useSelectedFinding()
  const [wide, setWide] = useState<boolean>(() => readWide())

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(WIDE_QUERY)
    const onChange = (e: MediaQueryListEvent) => setWide(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  const { data: diffFallback } = useQuery({
    queryKey: ['session', session.id, 'diff'] as const,
    queryFn: () => api.getSessionDiff(session.id),
    enabled: !unifiedDiff,
    retry: false,
  })
  const diff = unifiedDiff ?? diffFallback ?? null

  const finding = selectedFindingDbId
    ? findings.find((f) => f.dbId === selectedFindingDbId && !f.archived)
    : undefined

  const {
    size: width,
    isDragging,
    separatorProps,
  } = useResizable({
    defaultSize: LIST_DEFAULT,
    min: LIST_MIN,
    max: LIST_MAX,
    storageKey: LIST_KEY,
    edge: 'right',
    ariaLabel: t('findingsWorkspace.resizeAria'),
  })

  if (!wide) {
    return (
      <div className="flex flex-col min-h-0 flex-1">
        <ListColumn findings={findings} session={session} selectedCount={selectedCount} />
        {finding ? (
          <FindingDetailDrawer
            finding={finding}
            session={session}
            unifiedDiff={diff}
            onClose={() => setSelectedFindingDbId(null)}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div
        style={{ width }}
        className="relative shrink-0 border-r border-rule flex flex-col min-h-0"
      >
        <ListColumn findings={findings} session={session} selectedCount={selectedCount} />
        <div
          {...separatorProps}
          className={cn(
            'absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none z-10',
            'transition-colors duration-180 ease-out-quart',
            isDragging ? 'bg-brand' : 'hover:bg-brand/30',
          )}
        />
      </div>
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {finding ? (
          <FindingDetailPanel finding={finding} session={session} unifiedDiff={diff} />
        ) : (
          <div className="px-6 py-10">
            <EmptyState
              eyebrow={t('findingsWorkspace.detailEmptyEyebrow')}
              title={t('findingsWorkspace.detailEmptyTitle')}
              body={t('findingsWorkspace.detailEmptyBody')}
            />
          </div>
        )}
      </div>
    </div>
  )
}

interface ListColumnProps {
  findings: Finding[]
  session: PRSession
  selectedCount: number
}

function ListColumn({ findings, session, selectedCount }: ListColumnProps) {
  const { t } = useTranslation()
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <FindingList findings={findings} session={session} />
      </div>
      {selectedCount > 0 ? (
        <div className="shrink-0 border-t border-rule px-5 py-2 bg-raised/40">
          <span className="text-caps tracking-caps text-ink-secondary uppercase">
            {t('prdetail.selectedCount', { count: selectedCount })}
          </span>
        </div>
      ) : null}
    </div>
  )
}
