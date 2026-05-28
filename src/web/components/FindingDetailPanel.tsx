import type { Severity } from '@shared/findings-schema'
import type { Finding, PRSession } from '@shared/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, Pencil, Trash2 } from 'lucide-react'
import { isValidElement, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { type Components } from 'react-markdown'

import { CodeBlock } from '@/components/CodeBlock'
import { DiffViewer } from '@/components/DiffViewer'
import { Button, ConfirmAction, KbdTooltip, SeverityLabel, Tag } from '@/components/ui'
import { api, queryKeys, ApiError } from '@/lib/api'
import { useSelectedFinding } from '@/lib/selection'
import { cn } from '@/lib/utils'

interface Props {
  finding: Finding
  session: PRSession
  unifiedDiff: string | null
  /** Historical (archived) round — disable Include toggle, hide Edit/Delete. */
  readOnly?: boolean | undefined
}

const SEVERITY_LIST: Severity[] = ['must', 'should', 'nit']

function githubLineLink(session: PRSession, file: string, line: number | null): string {
  const base = session.url ? `${session.url}/files` : '#'
  const anchor = line ? `R${line}` : ''
  return `${base}#diff-${encodeURIComponent(file)}${anchor}`
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <div className="text-caps tracking-caps text-ink-muted uppercase">{children}</div>
}

export function FindingDetailPanel({ finding, session, unifiedDiff, readOnly }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { setSelectedFindingDbId } = useSelectedFinding()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({
    title: finding.title,
    body: finding.body,
    severity: finding.severity,
    suggestion: finding.suggestion ?? '',
  })

  useEffect(() => {
    if (editing) return
    setDraft({
      title: finding.title,
      body: finding.body,
      severity: finding.severity,
      suggestion: finding.suggestion ?? '',
    })
  }, [editing, finding])

  // When the user selects a different finding from the list while editing,
  // exit edit mode so the form re-syncs to the new finding's content.
  useEffect(() => {
    setEditing(false)
  }, [finding.dbId])

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: queryKeys.session(session.id) })
  }

  const select = useMutation({
    mutationFn: (next: boolean) => api.selectFinding(finding.dbId, { selected: next }),
    onSuccess: invalidate,
  })

  // File-level findings render into the review body, where GitHub's
  // suggestion fence isn't actionable. Hide the editor and never write
  // suggestion back for them.
  const isFileLevel = finding.line === null
  const save = useMutation({
    mutationFn: () =>
      api.updateFinding(finding.dbId, {
        title: draft.title,
        body: draft.body,
        severity: draft.severity,
        suggestion: isFileLevel ? null : draft.suggestion ? draft.suggestion : null,
      }),
    onSuccess: () => {
      invalidate()
      setEditing(false)
    },
  })

  const remove = useMutation({
    mutationFn: () => api.deleteFinding(finding.dbId),
    onSuccess: () => {
      invalidate()
      setSelectedFindingDbId(null)
    },
  })

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (editing) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setEditing(false)
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        save.mutate()
      }
      return
    }
    if (!readOnly && e.key === 'e' && e.target === containerRef.current) {
      e.preventDefault()
      setEditing(true)
    }
  }

  const githubHref = finding.file ? githubLineLink(session, finding.file, finding.line) : null

  // Override <pre> in markdown so fenced code blocks route through <CodeBlock>.
  // react-markdown v9 wraps the fenced <code> in a <pre>; inline <code> never
  // gets a <pre> parent, so this only fires for block-level code.
  const fallbackFile = finding.file
  const markdownComponents = useMemo<Components>(
    () => ({
      pre({ children, ...rest }) {
        if (isValidElement(children) && children.type === 'code') {
          const codeProps = children.props as { className?: string; children?: unknown }
          const m = /language-([\w+#-]+)/.exec(codeProps.className ?? '')
          const text = String(codeProps.children ?? '').replace(/\n$/, '')
          return <CodeBlock code={text} lang={m?.[1] ?? null} fallbackFile={fallbackFile} />
        }
        return <pre {...rest}>{children}</pre>
      },
    }),
    [fallbackFile],
  )

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-finding-id={finding.dbId}
      className="flex flex-col h-full outline-none"
    >
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-6 py-5 space-y-5">
          <header className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <SeverityLabel level={finding.severity} />
              <div className="flex items-center gap-3">
                <span className="font-mono text-meta text-ink-muted tabular-nums">
                  {finding.id}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (readOnly) return
                    select.mutate(!finding.selected)
                  }}
                  disabled={readOnly || select.isPending}
                  aria-pressed={finding.selected}
                  aria-label={t(
                    finding.selected ? 'finding.unselectAriaLabel' : 'finding.selectAriaLabel',
                    { id: finding.id },
                  )}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-meta transition-colors duration-180 ease-out-quart disabled:opacity-60',
                    finding.selected
                      ? 'border-brand bg-brand/10 text-brand'
                      : 'border-rule text-ink-secondary hover:border-ink-muted',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-3.5 items-center justify-center rounded-[2px] border',
                      finding.selected
                        ? 'border-brand bg-brand text-brand-ink'
                        : 'border-rule bg-transparent text-transparent',
                    )}
                  >
                    <Check size={10} strokeWidth={3} aria-hidden="true" />
                  </span>
                  {finding.selected ? t('inspector.cta.included') : t('inspector.cta.include')}
                </button>
              </div>
            </div>
            {!editing ? (
              <h2 className="text-h1 text-ink-primary">{finding.title}</h2>
            ) : (
              <input
                type="text"
                aria-label={t('finding.form.titleAria')}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className="w-full bg-transparent border-b border-rule py-1 text-h1 text-ink-primary focus:outline-none focus:border-brand transition-colors duration-180 ease-out-quart"
              />
            )}
          </header>

          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-meta">
            <dt className="text-caps tracking-caps text-ink-muted uppercase">
              {t('inspector.section.category')}
            </dt>
            <dd className="flex flex-wrap items-center gap-2">
              <Tag tone="neutral">{finding.category}</Tag>
              {finding.edited ? (
                <Tag tone="neutral" className="normal-case">
                  {t('finding.edited')}
                </Tag>
              ) : null}
              {finding.submittedAt !== null
                ? (() => {
                    const url =
                      finding.submittedCommentId !== null && session.url
                        ? `${session.url.split('#')[0]}#discussion_r${finding.submittedCommentId}`
                        : null
                    const badge = (
                      <Tag tone="success" className="inline-flex items-center gap-1 normal-case">
                        <Check size={10} strokeWidth={3} aria-hidden="true" />
                        <span>{t('finding.submittedBadge')}</span>
                        {url ? (
                          <ExternalLink size={10} aria-hidden="true" className="opacity-70" />
                        ) : null}
                      </Tag>
                    )
                    return url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer noopener"
                        aria-label={t('finding.submittedBadgeAria')}
                        className="hover:opacity-80"
                      >
                        {badge}
                      </a>
                    ) : (
                      <span aria-label={t('finding.submittedNoLinkAria')}>{badge}</span>
                    )
                  })()
                : null}
            </dd>
            <dt className="text-caps tracking-caps text-ink-muted uppercase">
              {t('inspector.section.target')}
            </dt>
            <dd className="min-w-0">
              {finding.file ? (
                <span className="inline-flex items-baseline gap-1.5 min-w-0">
                  <span
                    className="font-mono text-code text-ink-secondary truncate"
                    title={`${finding.file}${finding.line ? `:${finding.line}` : ''}`}
                  >
                    {finding.file}
                    {finding.line ? <span className="text-ink-muted">:{finding.line}</span> : null}
                  </span>
                  {githubHref ? (
                    <a
                      href={githubHref}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={t('finding.openOnGithub')}
                      className="text-ink-muted hover:text-brand transition-colors duration-180 ease-out-quart"
                    >
                      <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  ) : null}
                </span>
              ) : (
                <span className="font-mono text-meta text-ink-muted">{t('finding.wholePR')}</span>
              )}
            </dd>
          </dl>

          {editing ? (
            <fieldset>
              <legend className="text-caps tracking-caps text-ink-muted uppercase mb-1.5">
                {t('finding.form.severity')}
              </legend>
              <div role="radiogroup" className="inline-flex gap-1">
                {SEVERITY_LIST.map((sev) => {
                  const activeSev = draft.severity === sev
                  return (
                    <label
                      key={sev}
                      className={cn(
                        'px-2.5 py-1 rounded-sm cursor-pointer text-caps tracking-caps uppercase transition-colors duration-180 ease-out-quart',
                        activeSev
                          ? sev === 'must'
                            ? 'bg-severity-must/15 text-severity-must'
                            : sev === 'should'
                              ? 'bg-severity-should/15 text-severity-should'
                              : 'bg-severity-nit/15 text-severity-nit'
                          : 'text-ink-muted hover:text-ink-primary hover:bg-raised',
                      )}
                    >
                      <input
                        type="radio"
                        name={`severity-${finding.dbId}`}
                        value={sev}
                        checked={activeSev}
                        onChange={() => setDraft({ ...draft, severity: sev })}
                        aria-label={sev}
                        className="sr-only"
                      />
                      {sev}
                    </label>
                  )
                })}
              </div>
            </fieldset>
          ) : null}

          <section className="space-y-2">
            <SectionHeader>{t('inspector.section.claim')}</SectionHeader>
            {!editing ? (
              <div className="prose prose-sm max-w-[72ch] prose-headings:text-ink-primary prose-p:text-ink-primary prose-strong:text-ink-primary prose-code:text-ink-primary prose-a:text-brand prose-a:no-underline hover:prose-a:underline">
                <ReactMarkdown components={markdownComponents}>{finding.body}</ReactMarkdown>
              </div>
            ) : (
              <>
                <textarea
                  aria-label={t('finding.form.bodyAria')}
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  className="w-full min-h-[10rem] p-2 font-mono text-code rounded-md bg-sunken border border-rule text-ink-primary focus:outline-none focus:border-brand transition-colors duration-180 ease-out-quart resize-y"
                />
                <details className="text-meta">
                  <summary className="cursor-pointer text-caps tracking-caps text-ink-muted uppercase">
                    {t('finding.form.preview')}
                  </summary>
                  <div className="mt-2 p-3 rounded-md bg-sunken border border-rule prose prose-sm max-w-none prose-headings:text-ink-primary prose-p:text-ink-primary prose-strong:text-ink-primary prose-code:text-ink-primary">
                    <ReactMarkdown components={markdownComponents}>
                      {draft.body || t('finding.form.previewEmpty')}
                    </ReactMarkdown>
                  </div>
                </details>
              </>
            )}
          </section>

          {isFileLevel ? null : (
            <section className="space-y-2">
              <SectionHeader>{t('inspector.section.suggestion')}</SectionHeader>
              {!editing ? (
                finding.suggestion ? (
                  <CodeBlock code={finding.suggestion} fallbackFile={finding.file} />
                ) : (
                  <p className="text-meta text-ink-muted">
                    {t('inspector.section.suggestionEmpty')}
                  </p>
                )
              ) : (
                <textarea
                  aria-label={t('finding.form.suggestionAria')}
                  value={draft.suggestion}
                  onChange={(e) => setDraft({ ...draft, suggestion: e.target.value })}
                  className="w-full min-h-[6rem] p-2 font-mono text-code rounded-md bg-sunken border border-rule text-ink-primary focus:outline-none focus:border-brand transition-colors duration-180 ease-out-quart resize-y"
                />
              )}
            </section>
          )}

          {!editing && finding.file && finding.line !== null ? (
            <section className="space-y-2">
              <SectionHeader>{t('inspector.section.source')}</SectionHeader>
              <DiffViewer
                unifiedDiff={unifiedDiff}
                file={finding.file}
                line={finding.line}
                findingId={finding.id}
              />
            </section>
          ) : null}

          {save.isError ? (
            <div className="text-meta text-severity-must">
              {save.error instanceof ApiError ? save.error.message : t('finding.saveFailed')}
            </div>
          ) : null}
        </div>
      </div>

      <footer
        className={cn(
          'sticky bottom-0 shrink-0 border-t border-rule bg-raised px-6 py-3',
          readOnly && !editing && 'hidden',
        )}
      >
        {!editing ? (
          <div className="flex items-center gap-1 justify-end">
            <KbdTooltip keys={['e']} label={t('inspector.cta.edit')}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEditing(true)}
                aria-label={t('inspector.cta.edit')}
              >
                <Pencil size={12} aria-hidden="true" />
                {t('inspector.cta.edit')}
              </Button>
            </KbdTooltip>
            <ConfirmAction
              title={t('finding.deleteTitle', { id: finding.id })}
              description={t('finding.deleteDesc')}
              confirmLabel={t('finding.deleteConfirm')}
              onConfirm={() => remove.mutate()}
            >
              {(requestConfirm) => (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={requestConfirm}
                  aria-label={t('inspector.cta.discard')}
                >
                  <Trash2 size={12} aria-hidden="true" />
                  {t('inspector.cta.discard')}
                </Button>
              )}
            </ConfirmAction>
          </div>
        ) : (
          <div className="flex items-center gap-2 justify-end">
            <KbdTooltip keys={['Esc']} label={t('common.cancel')}>
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </Button>
            </KbdTooltip>
            <KbdTooltip keys={['⌘', '⏎']} label={t('common.save')}>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => save.mutate()}
                disabled={save.isPending}
              >
                {save.isPending ? t('common.saving') : t('common.save')}
              </Button>
            </KbdTooltip>
          </div>
        )}
      </footer>
    </div>
  )
}
