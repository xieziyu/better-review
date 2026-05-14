import { type AgentKind } from '@shared/types'
import { useTranslation } from 'react-i18next'

import { Tag } from '@/components/ui'
import { cn } from '@/lib/utils'

export function PresenceMark({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex items-center justify-center size-3.5 rounded-full text-[10px] font-bold leading-none shrink-0',
        ok ? 'bg-accent-ready/15 text-accent-ready' : 'bg-severity-must/15 text-severity-must',
      )}
    >
      {ok ? '✓' : '✗'}
    </span>
  )
}

// A plain colored status dot — used where a ✓/✗ mark would clash with
// selection semantics (e.g. inside the agent SelectMenu, which also renders a
// real selected-check). Green = available, red = not found.
export function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn('size-2 rounded-full shrink-0', ok ? 'bg-accent-ready' : 'bg-severity-must')}
    />
  )
}

// One agent's availability row: presence mark + kind + resolved path (or
// "not found") + an optional "default" tag. Vertical-list shaped so it scales
// to any number of agents — shared by the daemon-status popover and Settings.
export function AgentRow({
  kind,
  path,
  found,
  isDefault,
}: {
  kind: AgentKind
  path: string | undefined
  found: boolean
  isDefault: boolean
}) {
  const { t } = useTranslation()
  return (
    <li className="flex items-center gap-2 min-w-0">
      <PresenceMark ok={found} />
      <span className="text-meta text-ink-secondary w-12 shrink-0">{kind}</span>
      <span
        className="font-mono text-code text-ink-secondary truncate flex-1"
        title={path ?? t('daemon.notFound')}
      >
        {path ?? t('daemon.notFound')}
      </span>
      {isDefault ? <Tag tone="brand">{t('daemon.default')}</Tag> : null}
    </li>
  )
}
