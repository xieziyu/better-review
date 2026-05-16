import type { Finding } from '@shared/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { SeverityLabel } from '@/components/ui'
import { api, queryKeys } from '@/lib/api'
import { useSelectedFinding } from '@/lib/selection'
import { cn } from '@/lib/utils'

interface Props {
  finding: Finding
  sessionId: string
  readOnly?: boolean | undefined
}

function LocationLabel({ file, line }: { file: string | null; line: number | null }) {
  const { t } = useTranslation()
  if (!file) {
    return <span className="font-mono text-meta text-ink-muted">{t('finding.wholePR')}</span>
  }
  const slash = file.lastIndexOf('/')
  const dirname = slash >= 0 ? file.slice(0, slash + 1) : ''
  const basename = slash >= 0 ? file.slice(slash + 1) : file
  const label = `${file}${line ? `:${line}` : ''}`
  return (
    <span
      className="inline-flex min-w-0 items-baseline font-mono text-meta text-ink-secondary"
      title={label}
      aria-label={label}
    >
      {dirname ? <span className="min-w-0 truncate">{dirname}</span> : null}
      <span className="shrink-0">{basename}</span>
      {line ? <span className="shrink-0 text-ink-muted">:{line}</span> : null}
    </span>
  )
}

export function FindingRow({ finding, sessionId, readOnly }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { selectedFindingDbId, setSelectedFindingDbId } = useSelectedFinding()
  const active = selectedFindingDbId === finding.dbId

  const select = useMutation({
    mutationFn: () => api.selectFinding(finding.dbId, { selected: !finding.selected }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
    },
  })

  return (
    <div
      role="listitem"
      data-finding-id={finding.dbId}
      data-active={active || undefined}
      className={cn(
        'relative group grid cursor-pointer py-2.5 pl-5 pr-4 transition-colors duration-180 ease-out-quart',
        'grid-cols-[16px_1fr] gap-x-3 gap-y-1',
        active ? 'bg-canvas' : 'hover:bg-canvas/60',
      )}
      onClick={() => setSelectedFindingDbId(finding.dbId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setSelectedFindingDbId(finding.dbId)
        }
      }}
      tabIndex={0}
      aria-pressed={active}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-0 top-0 bottom-0 w-[2px]',
          active ? 'bg-brand' : 'bg-transparent',
        )}
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (readOnly) return
          select.mutate()
        }}
        disabled={readOnly || select.isPending}
        aria-pressed={finding.selected}
        aria-label={t(finding.selected ? 'finding.unselectAriaLabel' : 'finding.selectAriaLabel', {
          id: finding.id,
        })}
        className={cn(
          'row-span-2 mt-[3px] flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors duration-180 ease-out-quart',
          finding.selected
            ? 'border-brand bg-brand text-brand-ink'
            : 'border-rule bg-transparent text-transparent hover:border-ink-muted',
          readOnly && 'opacity-50 cursor-not-allowed',
        )}
      >
        <Check size={11} strokeWidth={3} aria-hidden="true" />
      </button>
      <div className="min-w-0 flex items-baseline gap-2 flex-wrap">
        <SeverityLabel level={finding.severity} />
        <span className="text-body text-ink-primary leading-snug" title={finding.title}>
          {finding.title}
        </span>
      </div>
      <div className="min-w-0 flex items-baseline gap-2 flex-wrap text-meta">
        <LocationLabel file={finding.file} line={finding.line} />
        <span aria-hidden="true" className="text-ink-muted">
          ·
        </span>
        <span className="text-caps tracking-caps uppercase text-ink-muted">{finding.category}</span>
        {finding.edited ? (
          <>
            <span aria-hidden="true" className="text-ink-muted">
              ·
            </span>
            <Pencil size={11} className="text-ink-muted" aria-label={t('finding.edited')} />
          </>
        ) : null}
      </div>
    </div>
  )
}
