import type { Severity } from '@shared/findings-schema'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { FileSummary } from '@/lib/diff-utils'
import {
  buildFileTree,
  collectAncestorsOfMatches,
  flattenVisible,
  type FileNode,
  type FolderNode,
  type VisibleRow,
} from '@/lib/file-tree'
import { useCollapsedFolders } from '@/lib/use-collapsed-folders'
import { cn } from '@/lib/utils'

interface Props {
  files: FileSummary[]
  selectedPath: string | null
  onSelect: (path: string) => void
  /** Per-file severity buckets for the badge dots; missing entry = 0 findings. */
  severitiesByFile: Map<string, Set<Severity>>
  /** Per-file total finding counts; used by the "only with findings" filter. */
  countsByFile: Map<string, number>
  /** Used to scope the persisted collapse state to this PR. */
  sessionId: string
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

const INDENT_PX = 12
const ROW_BASE_PX = 8

export function FileTree({
  files,
  selectedPath,
  onSelect,
  severitiesByFile,
  countsByFile,
  sessionId,
}: Props) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')
  const [onlyWithFindings, setOnlyWithFindings] = useState(false)
  const collapsed = useCollapsedFolders(sessionId)

  const filteredFiles = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return files.filter((f) => {
      if (onlyWithFindings && (countsByFile.get(f.path) ?? 0) === 0) return false
      if (!q) return true
      return f.path.toLowerCase().includes(q)
    })
  }, [files, filter, onlyWithFindings, countsByFile])

  const tree = useMemo(
    () => buildFileTree(filteredFiles, { countsByFile, severitiesByFile }),
    [filteredFiles, countsByFile, severitiesByFile],
  )

  const forcedExpanded = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return new Set<string>()
    return collectAncestorsOfMatches(tree, (f) => f.path.toLowerCase().includes(q))
  }, [tree, filter])

  const visibleRows = useMemo(
    () =>
      flattenVisible(tree, {
        isFolderOpen: (p) => !collapsed.isCollapsed(p) || forcedExpanded.has(p),
      }),
    [tree, collapsed, forcedExpanded],
  )

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
        aria-label={t('filesChanged.tree.ariaTree')}
        className="flex-1 min-h-0 overflow-y-auto py-1"
      >
        {visibleRows.length === 0 ? (
          <li className="px-3 py-4 text-meta text-ink-muted">
            {t('filesChanged.noMatch')}
          </li>
        ) : (
          visibleRows.map((row) => (
            // Namespace the key by row kind so a folder and a file with the
            // same path (rare but possible: a refactor that deletes a file
            // and adds a same-named directory) don't collide as React keys.
            <Row
              key={`${row.kind}:${row.node.path}`}
              row={row}
              selectedPath={selectedPath}
              onSelectFile={onSelect}
              onToggleFolder={collapsed.toggle}
            />
          ))
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

interface RowProps {
  row: VisibleRow
  selectedPath: string | null
  onSelectFile: (path: string) => void
  onToggleFolder: (path: string) => void
}

function Row({ row, selectedPath, onSelectFile, onToggleFolder }: RowProps) {
  if (row.kind === 'folder') {
    return (
      <FolderRowItem
        node={row.node}
        isOpen={row.isOpen}
        onToggle={() => onToggleFolder(row.node.path)}
      />
    )
  }
  return (
    <FileRowItem
      node={row.node}
      isSelected={row.node.path === selectedPath}
      onSelect={() => onSelectFile(row.node.path)}
    />
  )
}

function PathSegments({
  segments,
  emphasize,
  trailingSlash,
}: {
  segments: string[]
  emphasize: 'primary' | 'secondary'
  trailingSlash: boolean
}) {
  const last = segments[segments.length - 1] ?? ''
  const prefix = segments.slice(0, -1)
  const leafClass = emphasize === 'primary' ? 'text-ink-primary' : 'text-ink-secondary'
  return (
    <span className="font-mono text-meta truncate flex-1">
      {prefix.map((seg, i) => (
        <span key={`${i}:${seg}`} className="text-ink-muted">
          {seg}/
        </span>
      ))}
      <span className={leafClass}>
        {last}
        {trailingSlash ? '/' : ''}
      </span>
    </span>
  )
}

function SeverityDots({ severities }: { severities: Set<Severity> }) {
  const dots = SEV_ORDER.filter((s) => severities.has(s))
  if (dots.length === 0) return null
  return (
    <span className="flex items-center gap-0.5 shrink-0">
      {dots.map((s) => (
        <span
          key={s}
          aria-label={`has ${s} finding`}
          className={cn('h-1.5 w-1.5 rounded-full', SEV_TONE[s])}
        />
      ))}
    </span>
  )
}

function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="font-mono text-[11px] tabular-nums shrink-0 text-ink-muted">
      <span className="text-[color:var(--accent-ready)]">+{additions}</span>{' '}
      <span className="text-[color:var(--severity-must)]">−{deletions}</span>
    </span>
  )
}

function Chevron({ isOpen }: { isOpen: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={cn(
        'h-3 w-3 shrink-0 text-ink-muted transition-transform duration-180 ease-out-quart',
        isOpen ? '' : '-rotate-90',
      )}
    >
      <path
        d="M3 4l3 3 3-3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

function FolderRowItem({
  node,
  isOpen,
  onToggle,
}: {
  node: FolderNode
  isOpen: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const { aggregate } = node
  const paddingLeft = node.depth * INDENT_PX + ROW_BASE_PX
  const buttonLabel =
    aggregate.count > 0
      ? t('filesChanged.tree.ariaFolder', { path: node.path, count: aggregate.count })
      : t('filesChanged.tree.ariaFolderEmpty', { path: node.path })

  return (
    <li>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={onToggle}
        aria-label={buttonLabel}
        title={isOpen ? t('filesChanged.tree.ariaToggleCollapse', { path: node.path }) : t('filesChanged.tree.ariaToggleExpand', { path: node.path })}
        className="w-full py-1.5 pr-3 flex items-center gap-2 text-left transition-colors duration-180 ease-out-quart text-ink-secondary hover:bg-[color:color-mix(in_oklch,var(--brand)_6%,transparent)]"
        style={{ paddingLeft }}
      >
        <Chevron isOpen={isOpen} />
        <PathSegments segments={node.displaySegments} emphasize="secondary" trailingSlash />
        {aggregate.count > 0 ? (
          <span
            aria-hidden="true"
            className="font-mono text-[10px] leading-4 px-1.5 rounded-full shrink-0 text-ink-secondary bg-[color:color-mix(in_oklch,var(--brand)_14%,transparent)]"
          >
            {aggregate.count}
          </span>
        ) : null}
        <SeverityDots severities={aggregate.severities} />
        <DiffStat additions={aggregate.additions} deletions={aggregate.deletions} />
      </button>
    </li>
  )
}

function FileRowItem({
  node,
  isSelected,
  onSelect,
}: {
  node: FileNode
  isSelected: boolean
  onSelect: () => void
}) {
  const { file, aggregate } = node
  const paddingLeft = node.depth * INDENT_PX + ROW_BASE_PX
  return (
    <li>
      <button
        type="button"
        aria-current={isSelected ? 'true' : undefined}
        onClick={onSelect}
        className={cn(
          'w-full py-1.5 pr-3 flex items-center gap-2 text-left transition-colors duration-180 ease-out-quart',
          isSelected
            ? 'bg-[color:color-mix(in_oklch,var(--brand)_12%,transparent)] text-ink-primary'
            : 'hover:bg-[color:color-mix(in_oklch,var(--brand)_6%,transparent)] text-ink-secondary',
        )}
        style={{ paddingLeft }}
      >
        <span
          className={cn('font-mono w-3 shrink-0 text-center', STATUS_TONE[file.status])}
          title={file.status}
        >
          {STATUS_LETTER[file.status]}
        </span>
        <PathSegments
          segments={node.displaySegments}
          emphasize={isSelected ? 'primary' : 'secondary'}
          trailingSlash={false}
        />
        <SeverityDots severities={aggregate.severities} />
        <DiffStat additions={file.additions} deletions={file.deletions} />
      </button>
    </li>
  )
}
