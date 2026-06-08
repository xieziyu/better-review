import type { Finding, PRSession } from '@shared/types'
import { Check, Columns2, ExternalLink, FilePlus2, Rows3 } from 'lucide-react'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { getChangeKey } from 'react-diff-view'
import { useTranslation } from 'react-i18next'

import { findNewSideChange, type FileSummary } from '@/lib/diff-utils'
import { useDiffViewMode } from '@/lib/use-diff-view-mode'
import { cn } from '@/lib/utils'

import { AddFindingForm } from './AddFindingForm'
import { FileDiff } from './FileDiff'
import { InlineFindingCard, OffDiffFindingsSection } from './InlineFindingCard'
import { PendingSelectionBar } from './PendingSelectionBar'

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
  const { mode: viewMode, setMode: setViewMode } = useDiffViewMode()
  // Manual-finding flow:
  //   selecting    → compact PendingSelectionBar; gutter + clicks extend the
  //                  range so the diff isn't pushed out of view by a full form.
  //   editing      → full AddFindingForm inline at the range; gutter + clicks
  //                  are ignored to avoid clobbering the in-progress draft.
  //   file-level   → full AddFindingForm rendered above the diff, no line
  //                  anchor (e.g. "this file shouldn't be committed").
  type Adding =
    | { phase: 'selecting'; anchor: number; head: number }
    | { phase: 'editing'; start: number; end: number }
    | { phase: 'file-level' }
  const [adding, setAdding] = useState<Adding | null>(null)

  const { anchored, offDiff } = useMemo(() => classifyFindings(findings, file), [findings, file])

  const range = useMemo(() => {
    if (!adding) return null
    if (adding.phase === 'file-level') return null
    if (adding.phase === 'selecting') {
      const start = Math.min(adding.anchor, adding.head)
      const end = Math.max(adding.anchor, adding.head)
      return { start, end }
    }
    return { start: adding.start, end: adding.end }
  }, [adding])

  const selectedChanges = useMemo<string[]>(() => {
    if (!range) return []
    const keys: string[] = []
    for (let l = range.start; l <= range.end; l++) {
      const c = findNewSideChange(file.hunks, l)
      if (c) keys.push(getChangeKey(c))
    }
    return keys
  }, [range, file.hunks])

  const validateRange = useCallback(
    (start: number, end: number): boolean => {
      for (let l = start; l <= end; l++) {
        if (!findNewSideChange(file.hunks, l)) return false
      }
      return true
    },
    [file.hunks],
  )

  const handleAddRequest = useCallback((line: number, opts: { extend: boolean }) => {
    setAdding((prev) => {
      // Ignore gutter clicks while a full form is open — don't clobber the draft.
      if (prev?.phase === 'editing' || prev?.phase === 'file-level') return prev
      if (opts.extend && prev?.phase === 'selecting') {
        return { phase: 'selecting', anchor: prev.anchor, head: line }
      }
      return { phase: 'selecting', anchor: line, head: line }
    })
  }, [])

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
        <div className="border-l-2 border-rule bg-sunken">
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
    // Inline selection bar or full form at the change for the range's end line.
    if (adding && range) {
      const change = findNewSideChange(file.hunks, range.end)
      if (change) {
        const key = getChangeKey(change)
        const existing = map[key]
        const startLine = range.start < range.end ? range.start : undefined
        const inner =
          adding.phase === 'selecting' ? (
            <PendingSelectionBar
              file={file.path}
              start={range.start}
              end={range.end}
              rangeValid={validateRange(range.start, range.end)}
              onCancel={() => setAdding(null)}
              onConfirm={() => setAdding({ phase: 'editing', start: range.start, end: range.end })}
            />
          ) : (
            <AddFindingForm
              sessionId={session.id}
              file={file.path}
              line={range.end}
              startLine={startLine}
              validateRange={validateRange}
              onCancel={() => setAdding(null)}
              onCreated={() => setAdding(null)}
            />
          )
        map[key] = (
          <div className="border-l-2 border-rule bg-sunken">
            {existing}
            {inner}
          </div>
        )
      }
    }
    return map
  }, [
    anchored,
    adding,
    range,
    validateRange,
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
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {/* View-preference group: quiet segmented control (no brand fill —
              active reads as a recessed sunken cell with a brand icon). */}
          <div
            className="inline-flex items-center h-[26px] rounded-md border border-rule bg-main overflow-hidden"
            role="group"
            aria-label={t('filesChanged.viewMode.label')}
          >
            {(['unified', 'split'] as const).map((m) => {
              const active = viewMode === m
              const Icon = m === 'unified' ? Rows3 : Columns2
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setViewMode(m)}
                  title={t(`filesChanged.viewMode.${m}`)}
                  aria-label={t(`filesChanged.viewMode.${m}`)}
                  className={cn(
                    'inline-flex items-center gap-1.5 h-full px-2.5 text-meta transition-colors',
                    m === 'split' && 'border-l border-rule',
                    active
                      ? 'bg-sunken text-ink-primary font-semibold'
                      : 'text-ink-secondary hover:text-ink-primary',
                  )}
                >
                  <Icon className={cn('h-3.5 w-3.5', active && 'text-brand')} />
                  {t(`filesChanged.viewMode.${m}`)}
                </button>
              )
            })}
          </div>
          <span className="w-px h-[18px] bg-rule" aria-hidden="true" />
          {/* File-action group: shared ghost-control language (transparent
              until hover, then sunken fill + emerging border). */}
          {!readOnly ? (
            <button
              type="button"
              onClick={() => setAdding({ phase: 'file-level' })}
              disabled={adding?.phase === 'file-level'}
              className={cn(
                'inline-flex items-center justify-center h-[26px] w-[26px] rounded-md border border-transparent text-ink-secondary transition-colors hover:text-ink-primary hover:bg-sunken hover:border-rule',
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-transparent',
              )}
              title={t('filesChanged.addFinding.fileLevelTriggerTitle')}
              aria-label={t('filesChanged.addFinding.fileLevelTrigger')}
            >
              <FilePlus2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {/* Mark-as-viewed: the primary per-file action, so it carries real
              weight — a stateful pill that fills green once checked. */}
          <button
            type="button"
            role="checkbox"
            aria-checked={isViewed}
            disabled={readOnly}
            onClick={onToggleViewed}
            className={cn(
              'inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-md border text-meta transition-colors select-none disabled:cursor-not-allowed disabled:opacity-60',
              isViewed
                ? 'border-[color:color-mix(in_oklch,var(--accent-ready)_45%,var(--rule))] bg-[color:color-mix(in_oklch,var(--accent-ready)_14%,transparent)] text-ink-primary'
                : 'border-rule bg-main text-ink-secondary hover:text-ink-primary hover:border-ink-muted',
            )}
          >
            <span
              className={cn(
                'inline-flex items-center justify-center h-3.5 w-3.5 rounded-[4px] border-[1.5px]',
                isViewed
                  ? 'border-accent-ready bg-accent-ready text-brand-ink'
                  : 'border-ink-muted text-transparent',
              )}
            >
              <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
            </span>
            {t('filesChanged.viewed.toggle')}
          </button>
          {fileUrl ? (
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center h-[26px] w-[26px] rounded-md border border-transparent text-ink-secondary transition-colors hover:text-ink-primary hover:bg-sunken hover:border-rule"
              title={t('filesChanged.openOnGithub')}
              aria-label={t('filesChanged.openOnGithub')}
            >
              <ExternalLink className="h-3.5 w-3.5" />
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
      {adding?.phase === 'file-level' ? (
        <AddFindingForm
          sessionId={session.id}
          file={file.path}
          onCancel={() => setAdding(null)}
          onCreated={() => setAdding(null)}
        />
      ) : null}
      <FileDiff
        file={file.path}
        fileType={file.status}
        hunks={file.hunks}
        widgets={widgets}
        selectedChanges={selectedChanges}
        viewType={viewMode}
        {...(readOnly
          ? {}
          : {
              onAddRequest: handleAddRequest,
              addRequestTitle: t('filesChanged.addFinding.gutterTitle'),
            })}
      />
    </div>
  )
}
