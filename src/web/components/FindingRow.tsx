import type { Finding } from '@shared/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { SeverityLabel, Tag } from '@/components/ui'
import { api, queryKeys } from '@/lib/api'
import { useSelectedFinding } from '@/lib/selection'
import { cn } from '@/lib/utils'

interface Props {
  finding: Finding
  sessionId: string
}

function LocationLabel({ file, line }: { file: string | null; line: number | null }) {
  const { t } = useTranslation()
  if (!file) {
    return (
      <span className="font-mono text-meta text-ink-muted shrink-0">{t('finding.wholePR')}</span>
    )
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

export function FindingRow({ finding, sessionId }: Props) {
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
        'relative group flex items-baseline gap-3 py-2.5 pl-5 pr-4 cursor-pointer transition-colors duration-180 ease-out-quart',
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
          select.mutate()
        }}
        disabled={select.isPending}
        aria-pressed={finding.selected}
        aria-label={t(finding.selected ? 'finding.unselectAriaLabel' : 'finding.selectAriaLabel', {
          id: finding.id,
        })}
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-sm border transition-colors duration-180 ease-out-quart self-center',
          finding.selected
            ? 'border-brand bg-brand text-brand-ink'
            : 'border-rule bg-transparent text-transparent hover:border-ink-muted',
        )}
      >
        <Check size={12} strokeWidth={3} aria-hidden="true" />
      </button>
      <span className="shrink-0 self-center">
        <SeverityLabel level={finding.severity} />
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-body',
          active ? 'text-ink-primary' : 'text-ink-primary',
        )}
        title={finding.title}
      >
        {finding.title}
      </span>
      <LocationLabel file={finding.file} line={finding.line} />
      <Tag tone="neutral" className="shrink-0">
        {finding.category}
      </Tag>
      {finding.edited ? (
        <Pencil size={12} className="shrink-0 text-ink-muted self-center" aria-label={t('finding.edited')} />
      ) : null}
    </div>
  )
}
