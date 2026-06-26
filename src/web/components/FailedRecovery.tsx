import { RotateCcw, RotateCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui'

interface Props {
  // In-place retry: resume the same session from where it failed, reusing prep
  // artifacts and frozen source state.
  onRetry: () => void
  // Archive this run and start a fresh round from the latest HEAD.
  onRerun: () => void
  retryPending: boolean
  rerunPending: boolean
}

/**
 * Recovery card shown in the findings tab when a session has failed. Replaces
 * the plain "run did not finish" empty state and presents the two recovery
 * paths — Retry (continue in place) vs Rerun (fresh round) — side by side with
 * an explanation each, so the choice is made where the user is already looking
 * rather than via two near-identical buttons in the top action bar.
 */
export function FailedRecovery({ onRetry, onRerun, retryPending, rerunPending }: Props) {
  const { t } = useTranslation()
  return (
    <div className="rounded-lg border border-severity-must/30 bg-[color:color-mix(in_oklch,var(--severity-must)_5%,var(--bg-main))] p-5">
      <div className="text-h2 text-ink-primary">{t('prdetail.findingsFailedTitle')}</div>
      <p className="mt-1.5 max-w-prose text-body text-ink-secondary">
        {t('prdetail.findingsFailedBody')}
      </p>
      <div className="mt-5 flex flex-wrap gap-3.5">
        <RecoveryChoice
          primary
          icon={<RotateCcw size={14} aria-hidden="true" />}
          title={t('prdetail.retry')}
          desc={t('prdetail.retryTitle')}
        >
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={onRetry}
            disabled={retryPending}
          >
            <RotateCcw size={13} className={retryPending ? 'animate-spin' : undefined} />
            {t('prdetail.retry')}
          </Button>
        </RecoveryChoice>
        <RecoveryChoice
          icon={<RotateCw size={14} aria-hidden="true" />}
          title={t('prdetail.rerun')}
          desc={t('prdetail.rerunDesc')}
        >
          <Button type="button" variant="ghost" size="md" onClick={onRerun} disabled={rerunPending}>
            <RotateCw size={13} className={rerunPending ? 'animate-spin' : undefined} />
            {t('prdetail.rerun')}
          </Button>
        </RecoveryChoice>
      </div>
    </div>
  )
}

function RecoveryChoice({
  primary,
  icon,
  title,
  desc,
  children,
}: {
  primary?: boolean
  icon: ReactNode
  title: string
  desc: string
  children: ReactNode
}) {
  return (
    <div
      className={[
        'flex min-w-[230px] flex-1 flex-col rounded-md border bg-main p-3.5',
        primary ? 'border-brand/45' : 'border-rule',
      ].join(' ')}
    >
      <div className="flex items-center gap-2 text-body font-medium text-ink-primary">
        <span className={primary ? 'text-brand' : 'text-ink-secondary'}>{icon}</span>
        {title}
      </div>
      <p className="mt-1.5 mb-3.5 flex-1 text-meta text-ink-secondary">{desc}</p>
      {children}
    </div>
  )
}
