import type { Severity } from '@shared/findings-schema'
import type { Finding, PRSession } from '@shared/types'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/ui'
import { parseFileList, type FileSummary } from '@/lib/diff-utils'
import { useSelectedFinding } from '@/lib/selection'
import { useResizable } from '@/lib/use-resizable'
import { cn } from '@/lib/utils'

import { FileDiffPane } from './FileDiffPane'
import { FileTree } from './FileTree'

interface Props {
  session: PRSession
  findings: Finding[]
  unifiedDiff: string | null
  /** Controlled selection so PRDetail can react to SSE events. Null = use first file. */
  selectedPath: string | null
  onSelectPath: (path: string | null) => void
  /** Called when the user requests the full editor for a finding (switches tab + selects). */
  onOpenFindingInPanel: (dbId: string) => void
}

const TREE_DEFAULT = 280
const TREE_MIN = 220
const TREE_MAX = 480
const TREE_KEY = 'better-review:files-tree-width:v1'

function indexFindings(findings: Finding[]): {
  byFile: Map<string, Finding[]>
  severitiesByFile: Map<string, Set<Severity>>
  countsByFile: Map<string, number>
} {
  const byFile = new Map<string, Finding[]>()
  const severitiesByFile = new Map<string, Set<Severity>>()
  const countsByFile = new Map<string, number>()
  for (const f of findings) {
    if (!f.file) continue
    const arr = byFile.get(f.file) ?? []
    arr.push(f)
    byFile.set(f.file, arr)
    const sevs = severitiesByFile.get(f.file) ?? new Set<Severity>()
    sevs.add(f.severity)
    severitiesByFile.set(f.file, sevs)
    countsByFile.set(f.file, (countsByFile.get(f.file) ?? 0) + 1)
  }
  return { byFile, severitiesByFile, countsByFile }
}

function githubFileLink(session: PRSession, file: string): string | null {
  if (!session.url) return null
  return `${session.url}/files#diff-${encodeURIComponent(file)}`
}

export function FilesChangedView({
  session,
  findings,
  unifiedDiff,
  selectedPath,
  onSelectPath,
  onOpenFindingInPanel,
}: Props) {
  const { t } = useTranslation()
  const { setSelectedFindingDbId } = useSelectedFinding()

  const files = useMemo(() => parseFileList(unifiedDiff ?? ''), [unifiedDiff])
  const { byFile, severitiesByFile, countsByFile } = useMemo(
    () => indexFindings(findings),
    [findings],
  )
  const [expandedFindingIds, setExpandedFindingIds] = useState<Set<string>>(() => new Set())

  // Pin the selection to a valid file when the diff arrives or the file list
  // changes. `files` length === 0 is handled below.
  const effectivePath: string | null = useMemo(() => {
    if (selectedPath && files.some((f) => f.path === selectedPath)) return selectedPath
    return files[0]?.path ?? null
  }, [selectedPath, files])

  // Reflect the resolved path back so PRDetail can compare against incoming
  // SSE events (toast on cross-file new findings).
  useEffect(() => {
    if (effectivePath !== selectedPath) onSelectPath(effectivePath)
  }, [effectivePath, selectedPath, onSelectPath])

  const selectedFile: FileSummary | undefined = useMemo(
    () => (effectivePath ? files.find((f) => f.path === effectivePath) : undefined),
    [files, effectivePath],
  )

  const {
    size: treeWidth,
    isDragging,
    separatorProps,
  } = useResizable({
    defaultSize: TREE_DEFAULT,
    min: TREE_MIN,
    max: TREE_MAX,
    storageKey: TREE_KEY,
    edge: 'right',
    ariaLabel: t('filesChanged.resizeAria'),
  })

  // Distinguish "diff not fetched yet" (null) from "fetched and is empty"
  // (string with no diff entries) — the first shows a loading hint, the
  // second is the empty-PR state.
  if (unifiedDiff === null) {
    return (
      <div className="flex-1 min-h-0 grid place-items-center">
        <div className="text-meta text-ink-muted">{t('filesChanged.diffPending')}</div>
      </div>
    )
  }
  if (files.length === 0) {
    return (
      <div className="flex-1 min-h-0 grid place-items-center">
        <EmptyState title={t('filesChanged.emptyTitle')} body={t('filesChanged.emptyBody')} />
      </div>
    )
  }

  const toggleFinding = (dbId: string): void => {
    setExpandedFindingIds((prev) => {
      const next = new Set(prev)
      if (next.has(dbId)) next.delete(dbId)
      else next.add(dbId)
      return next
    })
  }

  const openInPanel = (dbId: string): void => {
    setSelectedFindingDbId(dbId)
    onOpenFindingInPanel(dbId)
  }

  return (
    <div className="flex flex-1 min-h-0">
      <div
        style={{ width: treeWidth }}
        className="relative shrink-0 border-r border-rule min-h-0 flex flex-col"
      >
        <FileTree
          files={files}
          selectedPath={effectivePath}
          onSelect={onSelectPath}
          severitiesByFile={severitiesByFile}
          countsByFile={countsByFile}
        />
        <div
          {...separatorProps}
          className={cn(
            'absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none z-10 transition-colors duration-180 ease-out-quart',
            isDragging ? 'bg-brand' : 'hover:bg-brand/30',
          )}
        />
      </div>
      <div className="flex-1 min-w-0 min-h-0 overflow-auto bg-canvas">
        {selectedFile ? (
          <FileDiffPane
            file={selectedFile}
            findings={byFile.get(selectedFile.path) ?? []}
            session={session}
            expandedFindingIds={expandedFindingIds}
            onToggleFinding={toggleFinding}
            onOpenInPanel={openInPanel}
            fileUrl={githubFileLink(session, selectedFile.path)}
          />
        ) : null}
      </div>
    </div>
  )
}
