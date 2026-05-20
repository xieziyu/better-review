import type { Severity } from '@shared/findings-schema'
import type { PRSession } from '@shared/types'
import type { Finding } from '@shared/types'
import { ChevronRight } from 'lucide-react'
import { isValidElement, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { type Components } from 'react-markdown'

import { CodeBlock } from '@/components/CodeBlock'
import { EmptyState } from '@/components/ui'
import { parseFileList } from '@/lib/diff-utils'
import {
  computeReviewCoverage,
  type AttentionItem,
  type CoverageRow,
  type CoverageStatus,
  type SummaryStats,
} from '@/lib/review-coverage'
import { cn } from '@/lib/utils'

interface Props {
  session: PRSession
  findings: Finding[]
  unifiedDiff: string | null
  /** Jump to a file in the Files-changed tab. */
  onJumpToFile: (path: string) => void
}

const SEV_DOT: Record<Severity, string> = {
  must: 'bg-[color:var(--severity-must)]',
  should: 'bg-[color:var(--severity-should)]',
  nit: 'bg-[color:var(--severity-nit)]',
}

/**
 * The "Summary" tab body: a one-screen review report — change stats, the
 * agent-written overview, the curated "review this yourself" list, and a
 * full per-file coverage table. Stats + coverage are derived and always
 * render; the overview + agent-flagged attention wait on `summary.json`.
 */
export function ReviewSummary({ session, findings, unifiedDiff, onJumpToFile }: Props) {
  const { t } = useTranslation()
  const files = useMemo(() => (unifiedDiff ? parseFileList(unifiedDiff) : []), [unifiedDiff])
  const coverage = useMemo(
    () => computeReviewCoverage(files, findings, session.excludedFiles, session.reviewSummary),
    [files, findings, session.excludedFiles, session.reviewSummary],
  )

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 py-8 space-y-8">
        <StatStrip stats={coverage.stats} />
        <OverviewSection session={session} />
        <AttentionSection items={coverage.attention} onJumpToFile={onJumpToFile} />
        <CoverageSection
          rows={coverage.rows}
          hasDiff={unifiedDiff !== null}
          onJumpToFile={onJumpToFile}
        />
      </div>
    </div>
  )
}

function Section({
  title,
  count,
  meta,
  children,
}: {
  title: string
  count?: number | undefined
  meta?: string | undefined
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline gap-2.5">
        <h2 className="text-h2 text-ink-primary">{title}</h2>
        {count !== undefined ? (
          <span className="rounded-full border border-rule bg-sunken px-2 font-mono text-[11px] font-bold text-ink-secondary tabular-nums">
            {count}
          </span>
        ) : null}
        {meta ? <span className="text-meta text-ink-muted">{meta}</span> : null}
      </div>
      {children}
    </section>
  )
}

function StatStrip({ stats }: { stats: SummaryStats }) {
  const { t } = useTranslation()
  const { findingCounts: fc } = stats
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-rule bg-raised sm:grid-cols-4">
      <Stat label={t('summary.statFiles')}>
        <span className="tabular-nums">{stats.fileCount}</span>
      </Stat>
      <Stat label={t('summary.statLines')}>
        <span className="text-[color:var(--accent-ready)] tabular-nums">+{stats.additions}</span>{' '}
        <span className="text-[color:var(--severity-must)] tabular-nums">−{stats.deletions}</span>
      </Stat>
      <Stat label={t('summary.statFindings')}>
        <span className="tabular-nums">{fc.total}</span>
        {fc.total > 0 ? (
          <span className="ml-1.5 text-meta font-medium text-ink-secondary">
            {t('summary.findingsBreakdown', { must: fc.must, should: fc.should, nit: fc.nit })}
          </span>
        ) : null}
      </Stat>
      <Stat label={t('summary.statExcluded')}>
        <span className="tabular-nums">{stats.excludedCount}</span>
      </Stat>
    </div>
  )
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-r border-rule px-4 py-3 last:border-r-0 [&:nth-child(2)]:border-r-0 sm:border-b-0 sm:[&:nth-child(2)]:border-r">
      <div className="text-caps uppercase tracking-caps text-ink-muted">{label}</div>
      <div className="mt-1.5 text-h1 text-ink-primary">{children}</div>
    </div>
  )
}

const MD_COMPONENTS: Components = {
  pre({ children, ...rest }) {
    if (isValidElement(children) && children.type === 'code') {
      const codeProps = children.props as { className?: string; children?: unknown }
      const m = /language-([\w+#-]+)/.exec(codeProps.className ?? '')
      const text = String(codeProps.children ?? '').replace(/\n$/, '')
      return <CodeBlock code={text} lang={m?.[1] ?? null} fallbackFile={null} />
    }
    return <pre {...rest}>{children}</pre>
  },
}

function OverviewSection({ session }: { session: PRSession }) {
  const { t } = useTranslation()
  const summary = session.reviewSummary
  const isLive = session.status === 'running' || session.status === 'pending'
  return (
    <Section title={t('summary.overviewTitle')}>
      {summary ? (
        <div className="rounded-lg border border-rule bg-canvas px-4 py-4">
          <div className="prose prose-sm max-w-none prose-headings:text-ink-primary prose-p:text-ink-primary prose-li:text-ink-primary prose-strong:text-ink-primary prose-code:text-ink-primary prose-a:text-brand">
            <ReactMarkdown components={MD_COMPONENTS}>{summary.overview}</ReactMarkdown>
          </div>
          <div className="mt-3 border-t border-rule pt-2.5 text-meta text-ink-muted">
            {t('summary.attributedTo', { agent: session.agent })}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-rule bg-canvas px-4 py-6 text-body text-ink-secondary">
          {isLive ? t('summary.overviewPending') : t('summary.overviewMissing')}
        </div>
      )}
    </Section>
  )
}

function AttentionSection({
  items,
  onJumpToFile,
}: {
  items: AttentionItem[]
  onJumpToFile: (path: string) => void
}) {
  const { t } = useTranslation()
  return (
    <Section
      title={t('summary.attentionTitle')}
      count={items.length}
      meta={items.length > 0 ? t('summary.attentionHint') : undefined}
    >
      {items.length === 0 ? (
        <div className="rounded-lg border border-rule bg-canvas px-4 py-5 text-body text-ink-secondary">
          {t('summary.attentionEmpty')}
        </div>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-rule">
          {items.map((item, i) => (
            <AttentionRow
              key={`${item.file ?? '$pr'}-${i}`}
              item={item}
              onJumpToFile={onJumpToFile}
            />
          ))}
        </ul>
      )}
    </Section>
  )
}

function AttentionRow({
  item,
  onJumpToFile,
}: {
  item: AttentionItem
  onJumpToFile: (path: string) => void
}) {
  const { t } = useTranslation()
  const reason = item.reason ?? t('summary.attentionDerived', { count: item.findingCount })
  const dir = item.file ? item.file.slice(0, item.file.lastIndexOf('/') + 1) : ''
  const base = item.file ? item.file.slice(item.file.lastIndexOf('/') + 1) : ''
  const clickable = item.file !== null
  return (
    <li className="border-b border-rule last:border-b-0">
      <button
        type="button"
        disabled={!clickable}
        onClick={clickable ? () => onJumpToFile(item.file as string) : undefined}
        className={cn(
          'flex w-full items-start gap-3 px-4 py-3 text-left',
          clickable
            ? 'cursor-pointer hover:bg-[color:color-mix(in_oklch,var(--brand)_5%,transparent)]'
            : 'cursor-default',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 w-[3px] self-stretch rounded-full',
            item.hasMust ? 'bg-[color:var(--severity-must)]' : 'bg-[color:var(--severity-should)]',
          )}
        />
        <span className="min-w-0 flex-1">
          {item.file ? (
            <span className="font-mono text-[12.5px] font-semibold text-ink-primary">
              <span className="font-normal text-ink-muted">{dir}</span>
              {base}
            </span>
          ) : (
            <span className="text-caps uppercase tracking-caps text-ink-secondary">
              {t('summary.attentionPrWide')}
            </span>
          )}
          <span className="mt-0.5 block text-[13px] leading-5 text-ink-secondary">{reason}</span>
        </span>
        {item.findingCount > 0 ? (
          <span
            className={cn(
              'shrink-0 rounded-full border px-1.5 text-[10.5px] font-bold tabular-nums',
              item.hasMust
                ? 'border-[color:color-mix(in_oklch,var(--severity-must)_45%,var(--rule))] text-[color:var(--severity-must)]'
                : 'border-rule text-ink-secondary',
            )}
          >
            {t('summary.findingChip', { count: item.findingCount })}
          </span>
        ) : null}
        {clickable ? <ChevronRight className="size-4 shrink-0 text-ink-muted" /> : null}
      </button>
    </li>
  )
}

const STATUS_TONE: Record<CoverageStatus, string> = {
  flagged: 'text-[color:var(--severity-must)]',
  found: 'text-ink-primary',
  clean: 'text-[color:var(--accent-ready)]',
  excluded: 'text-ink-muted',
}
const STATUS_ICON: Record<CoverageStatus, string> = {
  flagged: '⚑',
  found: '●',
  clean: '✓',
  excluded: '⊘',
}

function CoverageSection({
  rows,
  hasDiff,
  onJumpToFile,
}: {
  rows: CoverageRow[]
  hasDiff: boolean
  onJumpToFile: (path: string) => void
}) {
  const { t } = useTranslation()
  const excludedShown = rows.some((r) => r.status === 'excluded')
  return (
    <Section title={t('summary.coverageTitle')} count={rows.length}>
      {rows.length === 0 ? (
        <EmptyState
          className="rounded-lg border border-rule bg-canvas !py-8 !px-4"
          title={hasDiff ? t('summary.coverageEmptyTitle') : t('summary.coveragePendingTitle')}
          body={hasDiff ? t('summary.coverageEmptyBody') : t('summary.coveragePendingBody')}
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-rule">
            <div className="grid grid-cols-[1fr_auto_auto] gap-4 border-b border-rule bg-sunken px-4 py-1.5 text-caps uppercase tracking-caps text-ink-muted">
              <span>{t('summary.covColFile')}</span>
              <span>{t('summary.covColLines')}</span>
              <span>{t('summary.covColStatus')}</span>
            </div>
            {rows.map((row) => (
              <CoverageRowItem key={row.path} row={row} onJumpToFile={onJumpToFile} />
            ))}
          </div>
          {excludedShown ? (
            <p className="mt-2.5 text-meta leading-[18px] text-ink-muted">
              {t('summary.excludedNote')}
            </p>
          ) : null}
        </>
      )}
    </Section>
  )
}

function CoverageRowItem({
  row,
  onJumpToFile,
}: {
  row: CoverageRow
  onJumpToFile: (path: string) => void
}) {
  const { t } = useTranslation()
  const dir = row.path.slice(0, row.path.lastIndexOf('/') + 1)
  const base = row.path.slice(row.path.lastIndexOf('/') + 1)
  const statusLabel =
    row.status === 'flagged'
      ? t('summary.statusFlagged')
      : row.status === 'found'
        ? t('summary.statusFound', { count: row.findingCount })
        : row.status === 'clean'
          ? t('summary.statusClean')
          : t('summary.statusExcluded')
  return (
    <button
      type="button"
      onClick={() => onJumpToFile(row.path)}
      className={cn(
        'grid w-full grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-rule px-4 py-2 text-left last:border-b-0',
        'cursor-pointer hover:bg-[color:color-mix(in_oklch,var(--brand)_5%,transparent)]',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            'truncate font-mono text-[12.5px]',
            row.status === 'excluded' ? 'text-ink-muted' : 'text-ink-primary',
          )}
        >
          <span className="text-ink-muted">{dir}</span>
          {base}
        </span>
        {row.severities.length > 0 ? (
          <span className="flex shrink-0 items-center gap-0.5">
            {row.severities.map((s) => (
              <span
                key={s}
                className={cn('size-1.5 rounded-full', SEV_DOT[s])}
                aria-hidden="true"
              />
            ))}
          </span>
        ) : null}
      </span>
      <span className="font-mono text-[11.5px] tabular-nums whitespace-nowrap">
        <span className="text-[color:var(--accent-ready)]">+{row.additions}</span>{' '}
        <span className="text-[color:var(--severity-must)]">−{row.deletions}</span>
      </span>
      <span
        className={cn(
          'flex items-center gap-1.5 whitespace-nowrap text-[11.5px] font-semibold',
          STATUS_TONE[row.status],
        )}
      >
        <span aria-hidden="true" className="w-3.5 text-center">
          {STATUS_ICON[row.status]}
        </span>
        {statusLabel}
        {row.excludedGlob ? (
          <span className="font-mono font-normal text-ink-muted">· {row.excludedGlob}</span>
        ) : null}
      </span>
    </button>
  )
}
