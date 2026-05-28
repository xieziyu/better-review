import { sortByPriority } from '@shared/findings-sort'
import type { Finding, PRSession } from '@shared/types'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { FindingRow } from '@/components/FindingRow'
import { EmptyState } from '@/components/ui'

interface Props {
  findings: Finding[]
  session: PRSession
  readOnly?: boolean | undefined
}

interface Group {
  pending: Finding[]
  submitted: Finding[]
}

function splitSubmitted(findings: Finding[]): Group {
  const pending: Finding[] = []
  const submitted: Finding[] = []
  for (const f of findings) {
    if (f.submittedAt !== null) submitted.push(f)
    else pending.push(f)
  }
  pending.sort(sortByPriority)
  submitted.sort(sortByPriority)
  return { pending, submitted }
}

function SubmittedSection({
  findings,
  session,
  readOnly,
}: {
  findings: Finding[]
  session: PRSession
  readOnly?: boolean | undefined
}) {
  const { t } = useTranslation()
  return (
    <details className="border-t border-rule group">
      <summary className="flex items-baseline gap-3 pl-5 pr-4 py-2 cursor-pointer select-none list-none hover:bg-canvas/60">
        <span className="text-caps tracking-caps text-ink-muted uppercase">
          {t('finding.list.submittedSection', { count: findings.length })}
        </span>
        <span className="text-meta text-ink-secondary">
          {t('finding.list.submittedSectionHint')}
        </span>
        <span className="ml-auto font-mono text-meta text-ink-muted tabular-nums">
          {findings.length}
        </span>
      </summary>
      <div role="list" className="divide-y divide-rule border-t border-rule">
        {findings.map((f) => (
          <FindingRow
            key={f.dbId}
            finding={f}
            sessionId={session.id}
            sessionUrl={session.url}
            readOnly={readOnly}
          />
        ))}
      </div>
    </details>
  )
}

export function FindingList({ findings, session, readOnly }: Props) {
  const { t } = useTranslation()
  const { fileScoped, prWide } = useMemo(() => {
    const scoped: Finding[] = []
    const wide: Finding[] = []
    for (const f of findings) {
      if (f.file === null) wide.push(f)
      else scoped.push(f)
    }
    return { fileScoped: splitSubmitted(scoped), prWide: splitSubmitted(wide) }
  }, [findings])

  if (findings.length === 0) {
    return (
      <EmptyState
        eyebrow={t('finding.list.emptyEyebrow')}
        title={t('finding.list.emptyTitle')}
        body={t('finding.list.emptyBody')}
      />
    )
  }

  return (
    <div className="border-t border-rule">
      <div role="list" className="divide-y divide-rule">
        {fileScoped.pending.map((f) => (
          <FindingRow
            key={f.dbId}
            finding={f}
            sessionId={session.id}
            sessionUrl={session.url}
            readOnly={readOnly}
          />
        ))}
      </div>
      {fileScoped.submitted.length > 0 ? (
        <SubmittedSection findings={fileScoped.submitted} session={session} readOnly={readOnly} />
      ) : null}
      {prWide.pending.length + prWide.submitted.length > 0 ? (
        <section className="border-t border-rule mt-2">
          <h2 className="flex items-baseline gap-3 pl-5 pr-4 py-2">
            <span className="text-caps tracking-caps text-ink-muted uppercase">
              {t('finding.list.prWide')}
            </span>
            <span className="text-meta text-ink-secondary">{t('finding.list.addedToBody')}</span>
            <span className="ml-auto font-mono text-meta text-ink-muted tabular-nums">
              {prWide.pending.length + prWide.submitted.length}
            </span>
          </h2>
          <div role="list" className="divide-y divide-rule border-t border-rule">
            {prWide.pending.map((f) => (
              <FindingRow
                key={f.dbId}
                finding={f}
                sessionId={session.id}
                sessionUrl={session.url}
                readOnly={readOnly}
              />
            ))}
          </div>
          {prWide.submitted.length > 0 ? (
            <SubmittedSection findings={prWide.submitted} session={session} readOnly={readOnly} />
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
