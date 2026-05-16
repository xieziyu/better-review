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

export function FindingList({ findings, session, readOnly }: Props) {
  const { t } = useTranslation()
  const { fileScoped, prWide } = useMemo(() => {
    const scoped: Finding[] = []
    const wide: Finding[] = []
    for (const f of findings) {
      if (f.file === null) wide.push(f)
      else scoped.push(f)
    }
    scoped.sort(sortByPriority)
    wide.sort(sortByPriority)
    return { fileScoped: scoped, prWide: wide }
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
    <div role="list" className="border-t border-rule">
      <div className="divide-y divide-rule">
        {fileScoped.map((f) => (
          <FindingRow key={f.dbId} finding={f} sessionId={session.id} readOnly={readOnly} />
        ))}
      </div>
      {prWide.length > 0 ? (
        <section className="border-t border-rule mt-2">
          <h2 className="flex items-baseline gap-3 pl-5 pr-4 py-2">
            <span className="text-caps tracking-caps text-ink-muted uppercase">
              {t('finding.list.prWide')}
            </span>
            <span className="text-meta text-ink-secondary">{t('finding.list.addedToBody')}</span>
            <span className="ml-auto font-mono text-meta text-ink-muted tabular-nums">
              {prWide.length}
            </span>
          </h2>
          <div className="divide-y divide-rule border-t border-rule">
            {prWide.map((f) => (
              <FindingRow key={f.dbId} finding={f} sessionId={session.id} readOnly={readOnly} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
