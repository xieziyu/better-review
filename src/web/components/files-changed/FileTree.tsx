import type { Severity } from '@shared/findings-schema'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { FileSummary } from '@/lib/diff-utils'
import { cn } from '@/lib/utils'

interface Props {
  files: FileSummary[]
  selectedPath: string | null
  onSelect: (path: string) => void
  /** Per-file severity buckets for the badge dots; missing entry = 0 findings. */
  severitiesByFile: Map<string, Set<Severity>>
  /** Per-file total finding counts; used by the "only with findings" filter. */
  countsByFile: Map<string, number>
}

const STATUS_LETTER: Record<FileSummary['status'], string> = {
  add: 'A',
  delete: 'D',
  modify: 'M',
  rename: 'R',
  copy: 'C',
}

const STATUS_TONE: Record<FileSummary['status'], string> = {
  add: 'text-[color:var(--accent-ready)]',
  delete: 'text-[color:var(--severity-must)]',
  modify: 'text-ink-secondary',
  rename: 'text-[color:var(--severity-should)]',
  copy: 'text-ink-secondary',
}

const SEV_TONE: Record<Severity, string> = {
  must: 'bg-[color:var(--severity-must)]',
  should: 'bg-[color:var(--severity-should)]',
  nit: 'bg-[color:var(--severity-nit)]',
}

const SEV_ORDER: Severity[] = ['must', 'should', 'nit']

export function FileTree({ files, selectedPath, onSelect, severitiesByFile, countsByFile }: Props) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')
  const [onlyWithFindings, setOnlyWithFindings] = useState(false)

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return files.filter((f) => {
      if (onlyWithFindings && (countsByFile.get(f.path) ?? 0) === 0) return false
      if (!q) return true
      return f.path.toLowerCase().includes(q)
    })
  }, [files, filter, onlyWithFindings, countsByFile])

  const totalAdditions = files.reduce((a, f) => a + f.additions, 0)
  const totalDeletions = files.reduce((a, f) => a + f.deletions, 0)

  return (
    <div className="flex flex-col min-h-0 h-full bg-main">
      <div className="shrink-0 px-3 py-2 border-b border-rule space-y-2">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('filesChanged.filterPlaceholder')}
          className="w-full bg-sunken border border-rule rounded px-2 py-1 text-meta text-ink-primary placeholder:text-ink-muted"
          aria-label={t('filesChanged.filterPlaceholder')}
        />
        <label className="flex items-center gap-2 text-meta text-ink-secondary cursor-pointer select-none">
          <input
            type="checkbox"
            checked={onlyWithFindings}
            onChange={(e) => setOnlyWithFindings(e.target.checked)}
          />
          {t('filesChanged.onlyWithFindings')}
        </label>
      </div>
      <ul
        role="listbox"
        aria-label={t('filesChanged.treeAria')}
        className="flex-1 min-h-0 overflow-y-auto py-1"
      >
        {filtered.length === 0 ? (
          <li className="px-3 py-4 text-meta text-ink-muted">{t('filesChanged.noMatch')}</li>
        ) : (
          filtered.map((f) => {
            const isSelected = f.path === selectedPath
            const sevs = severitiesByFile.get(f.path)
            const dots = SEV_ORDER.filter((s) => sevs?.has(s))
            return (
              <li key={f.path}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => onSelect(f.path)}
                  className={cn(
                    'w-full px-3 py-1.5 flex items-center gap-2 text-left transition-colors duration-180 ease-out-quart',
                    isSelected
                      ? 'bg-[color:color-mix(in_oklch,var(--brand)_12%,transparent)] text-ink-primary'
                      : 'hover:bg-[color:color-mix(in_oklch,var(--brand)_6%,transparent)] text-ink-secondary',
                  )}
                >
                  <span
                    className={cn('font-mono w-3 shrink-0 text-center', STATUS_TONE[f.status])}
                    title={f.status}
                  >
                    {STATUS_LETTER[f.status]}
                  </span>
                  <span className="font-mono text-meta truncate flex-1">{f.path}</span>
                  {dots.length > 0 ? (
                    <span className="flex items-center gap-0.5 shrink-0">
                      {dots.map((s) => (
                        <span
                          key={s}
                          aria-label={`has ${s} finding`}
                          className={cn('h-1.5 w-1.5 rounded-full', SEV_TONE[s])}
                        />
                      ))}
                    </span>
                  ) : null}
                  <span className="font-mono text-[11px] tabular-nums shrink-0 text-ink-muted">
                    <span className="text-[color:var(--accent-ready)]">+{f.additions}</span>{' '}
                    <span className="text-[color:var(--severity-must)]">−{f.deletions}</span>
                  </span>
                </button>
              </li>
            )
          })
        )}
      </ul>
      <div className="shrink-0 px-3 py-2 border-t border-rule text-[11px] text-ink-muted font-mono">
        {t('filesChanged.fileCount', { count: files.length })}{' '}
        <span className="text-[color:var(--accent-ready)]">+{totalAdditions}</span>{' '}
        <span className="text-[color:var(--severity-must)]">−{totalDeletions}</span>
      </div>
    </div>
  )
}
