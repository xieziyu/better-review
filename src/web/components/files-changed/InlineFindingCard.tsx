import type { Severity } from '@shared/findings-schema'
import type { Finding, PRSession } from '@shared/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'

import { CodeBlock } from '@/components/CodeBlock'
import { Button, ConfirmAction, SeverityLabel } from '@/components/ui'
import { api, queryKeys } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Props {
  finding: Finding
  session: PRSession
  expanded: boolean
  onToggle: () => void
  /** Switch to the Findings tab and select this finding for full-editor work. */
  onOpenInPanel?: () => void
}

const STRIPE: Record<Severity, string> = {
  must: 'bg-[color:var(--severity-must)]',
  should: 'bg-[color:var(--severity-should)]',
  nit: 'bg-[color:var(--severity-nit)]',
}

const TINT: Record<Severity, string> = {
  must: 'bg-[color:color-mix(in_oklch,var(--severity-must)_5%,var(--bg-main))]',
  should: 'bg-[color:color-mix(in_oklch,var(--severity-should)_5%,var(--bg-main))]',
  nit: 'bg-[color:color-mix(in_oklch,var(--severity-nit)_5%,var(--bg-main))]',
}

export function InlineFindingCard({ finding, session, expanded, onToggle, onOpenInPanel }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.session(session.id) })
  const select = useMutation({
    mutationFn: (next: boolean) => api.selectFinding(finding.dbId, { selected: next }),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: () => api.deleteFinding(finding.dbId),
    onSuccess: invalidate,
  })

  const sourceLabel =
    finding.source === 'manual' ? t('filesChanged.sourceManual') : t('filesChanged.sourceAgent')

  return (
    <div
      className={cn(
        'border border-rule rounded-md overflow-hidden my-2 mx-2 flex',
        TINT[finding.severity],
      )}
    >
      <div className={cn('w-1 shrink-0', STRIPE[finding.severity])} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="w-full px-3 py-2 flex items-center gap-2 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-secondary" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-secondary" />
          )}
          <SeverityLabel level={finding.severity} className="shrink-0" />
          <span className="text-meta text-ink-muted truncate shrink-0">{finding.category}</span>
          <span className="text-body text-ink-primary truncate flex-1">{finding.title}</span>
          <span className="text-[11px] text-ink-muted shrink-0 font-mono uppercase">
            {sourceLabel}
          </span>
        </button>
        {expanded ? (
          <div className="px-3 pb-3 space-y-3">
            <div className="prose-finding text-body text-ink-secondary leading-relaxed">
              <ReactMarkdown components={{ code: CodeBlock }}>{finding.body}</ReactMarkdown>
            </div>
            {finding.suggestion ? (
              <div className="space-y-1">
                <div className="text-caps tracking-caps text-ink-muted uppercase">
                  {t('filesChanged.suggestion')}
                </div>
                <CodeBlock>{finding.suggestion}</CodeBlock>
              </div>
            ) : null}
            <div className="flex items-center gap-2 pt-1 border-t border-rule">
              <label className="flex items-center gap-1.5 text-meta text-ink-secondary cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={finding.selected}
                  onChange={(e) => select.mutate(e.target.checked)}
                  aria-label={t('filesChanged.includeInReview')}
                />
                {t('filesChanged.includeInReview')}
              </label>
              <div className="ml-auto flex items-center gap-1">
                {onOpenInPanel ? (
                  <Button variant="ghost" size="sm" onClick={onOpenInPanel}>
                    <Pencil className="h-3 w-3" />
                    {t('filesChanged.editInPanel')}
                  </Button>
                ) : null}
                <ConfirmAction
                  title={t('filesChanged.confirmDeleteTitle')}
                  description={t('filesChanged.confirmDeleteBody')}
                  confirmLabel={t('common.delete')}
                  onConfirm={() => remove.mutate()}
                >
                  {(askConfirm) => (
                    <Button variant="danger" size="sm" onClick={askConfirm}>
                      <Trash2 className="h-3 w-3" />
                      {t('common.delete')}
                    </Button>
                  )}
                </ConfirmAction>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

interface OffDiffSectionProps {
  findings: Finding[]
  session: PRSession
  expandedIds: Set<string>
  onToggle: (dbId: string) => void
  onOpenInPanel?: (dbId: string) => void
}

export function OffDiffFindingsSection({
  findings,
  session,
  expandedIds,
  onToggle,
  onOpenInPanel,
}: OffDiffSectionProps) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)
  if (findings.length === 0) return null
  return (
    <section className="border-b border-rule bg-sunken/40">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        className="w-full px-3 py-2 flex items-center gap-2 text-left"
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 text-ink-secondary" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-ink-secondary" />
        )}
        <span className="text-caps tracking-caps text-ink-secondary uppercase">
          {t('filesChanged.offDiffHeader', { count: findings.length })}
        </span>
      </button>
      {!collapsed
        ? findings.map((f) => (
            <InlineFindingCard
              key={f.dbId}
              finding={f}
              session={session}
              expanded={expandedIds.has(f.dbId)}
              onToggle={() => onToggle(f.dbId)}
              {...(onOpenInPanel ? { onOpenInPanel: () => onOpenInPanel(f.dbId) } : {})}
            />
          ))
        : null}
    </section>
  )
}
