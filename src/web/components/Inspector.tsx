import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useMatch } from 'react-router-dom'

import { FindingDetailPanel } from '@/components/FindingDetailPanel'
import { EmptyState } from '@/components/ui'
import { api, queryKeys } from '@/lib/api'
import { useSelectedFinding } from '@/lib/selection'

export function Inspector() {
  const { t } = useTranslation()
  const { selectedFindingDbId } = useSelectedFinding()
  const match = useMatch('/pr/:id')
  const sessionId = match?.params.id ?? null

  const { data } = useQuery({
    queryKey: sessionId ? queryKeys.session(sessionId) : ['session', 'none'],
    queryFn: () => api.getSession(sessionId as string),
    enabled: !!sessionId,
  })
  const { data: diffData } = useQuery({
    queryKey: ['session', sessionId, 'diff'] as const,
    queryFn: () => api.getSessionDiff(sessionId as string),
    enabled: !!sessionId,
    retry: false,
  })

  const finding =
    selectedFindingDbId && data
      ? data.findings.find((f) => f.dbId === selectedFindingDbId && !f.archived)
      : undefined

  return (
    <aside
      aria-label={t('inspector.aria')}
      className="w-[360px] shrink-0 border-l border-rule bg-raised flex flex-col min-h-0"
    >
      {finding && data ? (
        <FindingDetailPanel
          finding={finding}
          session={data.session}
          unifiedDiff={data.diff ?? diffData ?? null}
        />
      ) : (
        <div className="px-6 py-10">
          <EmptyState
            eyebrow={t('inspector.emptyEyebrow')}
            title={t('inspector.emptyTitle')}
            body={t('inspector.emptyBody')}
          />
        </div>
      )}
    </aside>
  )
}
