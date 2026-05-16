import type { Finding, PRSession } from '@shared/types'
import { X } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { FindingDetailPanel } from '@/components/FindingDetailPanel'

interface Props {
  finding: Finding
  session: PRSession
  unifiedDiff: string | null
  onClose: () => void
  readOnly?: boolean | undefined
}

export function FindingDetailDrawer({
  finding,
  session,
  unifiedDiff,
  onClose,
  readOnly,
}: Props) {
  const { t } = useTranslation()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <button
        type="button"
        aria-label={t('findingsWorkspace.drawerCloseAria')}
        onClick={onClose}
        className="fixed inset-0 z-30 bg-canvas/40 motion-safe:animate-fade-in"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t('findingsWorkspace.drawerAria')}
        className="fixed inset-y-0 right-0 z-30 w-[min(640px,100vw)] border-l border-rule bg-raised flex flex-col min-h-0 shadow-[0_8px_30px_-12px_color-mix(in_oklab,var(--brand)_20%,transparent)] motion-safe:animate-slide-in-right"
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-rule shrink-0">
          <span className="text-caps tracking-caps uppercase text-ink-muted">
            {t('findingsWorkspace.drawerAria')}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('findingsWorkspace.drawerCloseAria')}
            className="text-ink-secondary hover:text-ink-primary transition-colors duration-180 ease-out-quart"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="flex-1 min-h-0">
          <FindingDetailPanel
            finding={finding}
            session={session}
            unifiedDiff={unifiedDiff}
            readOnly={readOnly}
          />
        </div>
      </aside>
    </>
  )
}
