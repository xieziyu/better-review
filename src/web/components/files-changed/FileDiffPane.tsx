import type { Finding, PRSession } from '@shared/types'
import { ExternalLink } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { getChangeKey } from 'react-diff-view'
import { useTranslation } from 'react-i18next'

import { findNewSideChange, type FileSummary } from '@/lib/diff-utils'

import { AddFindingForm } from './AddFindingForm'
import { FileDiff } from './FileDiff'
import { InlineFindingCard, OffDiffFindingsSection } from './InlineFindingCard'

interface Props {
  file: FileSummary
  findings: Finding[]
  session: PRSession
  expandedFindingIds: Set<string>
  onToggleFinding: (dbId: string) => void
  onOpenInPanel: (dbId: string) => void
  /** PR file URL on github, derived once by the parent. */
  fileUrl?: string | null
  /** Whether the reviewer has marked this file as viewed. */
  isViewed: boolean
  /** Toggle the viewed state for this file. */
  onToggleViewed: () => void
  /** Historical (archived) round — hide the inline "+ add finding" + inline mutations. */
  readOnly?: boolean | undefined
}

interface AnchoredFinding {
  finding: Finding
  changeKey: string
}

function classifyFindings(
  findings: Finding[],
  file: FileSummary,
): { anchored: AnchoredFinding[]; offDiff: Finding[] } {
  const anchored: AnchoredFinding[] = []
  const offDiff: Finding[] = []
  for (const f of findings) {
    if (f.file !== file.path && f.file !== file.newPath && f.file !== file.oldPath) continue
    if (f.line == null) {
      offDiff.push(f)
      continue
    }
    const change = findNewSideChange(file.hunks, f.line)
    if (!change) {
      offDiff.push(f)
      continue
    }
    anchored.push({ finding: f, changeKey: getChangeKey(change) })
  }
  return { anchored, offDiff }
}

export function FileDiffPane({
  file,
  findings,
  session,
  expandedFindingIds,
  onToggleFinding,
  onOpenInPanel,
  fileUrl,
  isViewed,
  onToggleViewed,
  readOnly,
}: Props) {
  const { t } = useTranslation()
  const [addingLine, setAddingLine] = useState<number | null>(null)

  const { anchored, offDiff } = useMemo(() => classifyFindings(findings, file), [findings, file])

  const widgets = useMemo<Record<string, ReactNode>>(() => {
    const map: Record<string, ReactNode> = {}
    const byChangeKey = new Map<string, AnchoredFinding[]>()
    for (const a of anchored) {
      const arr = byChangeKey.get(a.changeKey) ?? []
      arr.push(a)
      byChangeKey.set(a.changeKey, arr)
    }
    for (const [changeKey, group] of byChangeKey) {
      map[changeKey] = (
        <div className="border-l-2 border-rule bg-canvas">
          {group.map((a) => (
            <InlineFindingCard
              key={a.finding.dbId}
              finding={a.finding}
              session={session}
              expanded={expandedFindingIds.has(a.finding.dbId)}
              onToggle={() => onToggleFinding(a.finding.dbId)}
              onOpenInPanel={() => onOpenInPanel(a.finding.dbId)}
              readOnly={readOnly}
            />
          ))}
        </div>
      )
    }
    // Inline AddFindingForm at the change for `addingLine`.
    if (addingLine != null) {
      const change = findNewSideChange(file.hunks, addingLine)
      if (change) {
        const key = getChangeKey(change)
        const existing = map[key]
        map[key] = (
          <div className="border-l-2 border-rule bg-canvas">
            {existing}
            <AddFindingForm
              sessionId={session.id}
              file={file.path}
              line={addingLine}
              onCancel={() => setAddingLine(null)}
              onCreated={() => setAddingLine(null)}
            />
          </div>
        )
      }
    }
    return map
  }, [
    anchored,
    addingLine,
    expandedFindingIds,
    file.hunks,
    file.path,
    onOpenInPanel,
    onToggleFinding,
    session,
    readOnly,
  ])

  return (
    <div className="flex flex-col min-h-0">
      <header className="sticky top-0 z-10 flex items-center gap-3 px-4 py-2 bg-raised border-b border-rule">
        <span className="font-mono text-body font-medium truncate">{file.path}</span>
        <span className="text-meta text-ink-muted font-mono shrink-0 tabular-nums">
          <span className="text-[color:var(--accent-ready)]">+{file.additions}</span>{' '}
          <span className="text-[color:var(--severity-must)]">−{file.deletions}</span>
        </span>
        {findings.length > 0 ? (
          <span className="text-meta text-ink-secondary shrink-0">
            {t('filesChanged.fileFindings', { count: findings.length })}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-3 shrink-0">
          <label className="flex items-center gap-1.5 text-meta text-ink-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isViewed}
              disabled={readOnly}
              onChange={onToggleViewed}
            />
            {t('filesChanged.viewed.toggle')}
          </label>
          {fileUrl ? (
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-meta text-ink-muted hover:text-brand inline-flex items-center gap-1"
            >
              <ExternalLink className="h-3 w-3" />
              {t('filesChanged.openOnGithub')}
            </a>
          ) : null}
        </div>
      </header>
      <OffDiffFindingsSection
        findings={offDiff}
        session={session}
        expandedIds={expandedFindingIds}
        onToggle={onToggleFinding}
        onOpenInPanel={onOpenInPanel}
        readOnly={readOnly}
      />
      <FileDiff
        file={file.path}
        fileType={file.status}
        hunks={file.hunks}
        widgets={widgets}
        {...(readOnly ? {} : { onAddRequest: (line: number) => setAddingLine(line) })}
      />
    </div>
  )
}
