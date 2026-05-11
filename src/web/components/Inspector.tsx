import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/ui'
import { useSelectedFinding } from '@/lib/selection'

export function Inspector() {
  const { t } = useTranslation()
  const { selectedFindingDbId } = useSelectedFinding()
  return (
    <aside
      aria-label={t('inspector.aria')}
      className="w-[360px] shrink-0 border-l border-rule bg-raised overflow-y-auto"
    >
      {selectedFindingDbId == null ? (
        <div className="px-6 py-10">
          <EmptyState
            eyebrow={t('inspector.emptyEyebrow')}
            title={t('inspector.emptyTitle')}
            body={t('inspector.emptyBody')}
          />
        </div>
      ) : (
        <div className="px-6 py-6 text-meta text-ink-muted">{/* Phase 4 wires FindingDetailPanel */}</div>
      )}
    </aside>
  )
}
