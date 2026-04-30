import type { Severity } from '@shared/findings-schema'
import type { Finding, PRSession } from '@shared/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Pencil, Trash2, ExternalLink } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'

import { DiffViewer } from '@/components/DiffViewer'
import { Button, ConfirmAction, KbdTooltip, Tag } from '@/components/ui'
import { api, queryKeys, ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Props {
  finding: Finding
  session: PRSession
  unifiedDiff: string | null
}

const SEVERITY_LIST: Severity[] = ['must', 'should', 'nit']

const SEVERITY_LABEL: Record<Severity, string> = {
  must: 'must',
  should: 'should',
  nit: 'nit',
}

const SEVERITY_TEXT: Record<Severity, string> = {
  must: 'text-severity-must',
  should: 'text-severity-should',
  nit: 'text-severity-nit',
}

function githubLineLink(session: PRSession, file: string, line: number | null): string {
  const base = session.url ? `${session.url}/files` : '#'
  const anchor = line ? `R${line}` : ''
  return `${base}#diff-${encodeURIComponent(file)}${anchor}`
}

function FindingLocation({ file, line }: { file: string | null; line: number | null }) {
  if (!file) {
    return <span className="font-mono text-meta text-ink-secondary">(whole PR)</span>
  }

  const slash = file.lastIndexOf('/')
  const dirname = slash >= 0 ? file.slice(0, slash + 1) : ''
  const basename = slash >= 0 ? file.slice(slash + 1) : file
  const label = `${file}${line ? `:${line}` : ''}`

  return (
    <span
      className="inline-flex min-w-[7rem] max-w-full items-baseline overflow-hidden font-mono text-meta text-ink-secondary"
      title={label}
      aria-label={label}
    >
      {dirname ? <span className="min-w-0 truncate">{dirname}</span> : null}
      <span className="shrink-0">{basename}</span>
      {line ? <span className="shrink-0 text-ink-muted">:{line}</span> : null}
    </span>
  )
}

export function FindingCard({ finding, session, unifiedDiff }: Props) {
  const qc = useQueryClient()
  const cardRef = useRef<HTMLElement | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({
    title: finding.title,
    body: finding.body,
    severity: finding.severity,
    suggestion: finding.suggestion ?? '',
  })

  useEffect(() => {
    if (!editing) {
      setDraft({
        title: finding.title,
        body: finding.body,
        severity: finding.severity,
        suggestion: finding.suggestion ?? '',
      })
    }
  }, [editing, finding])

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: queryKeys.session(session.id) })
  }

  const select = useMutation({
    mutationFn: () => api.selectFinding(finding.dbId, { selected: !finding.selected }),
    onSuccess: invalidate,
  })

  const save = useMutation({
    mutationFn: () =>
      api.updateFinding(finding.dbId, {
        title: draft.title,
        body: draft.body,
        severity: draft.severity,
        suggestion: draft.suggestion ? draft.suggestion : null,
      }),
    onSuccess: () => {
      invalidate()
      setEditing(false)
    },
  })

  const remove = useMutation({
    mutationFn: () => api.deleteFinding(finding.dbId),
    onSuccess: invalidate,
  })

  const onKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
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
    if (e.key === 'e' && e.target === cardRef.current) {
      e.preventDefault()
      setEditing(true)
    }
  }

  return (
    <article
      ref={(el) => {
        cardRef.current = el
      }}
      role="article"
      aria-labelledby={`f-${finding.dbId}-title`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="group relative flex gap-4 py-5 outline-none"
    >
      <div className="w-11 shrink-0 pt-0.5">
        <button
          type="button"
          onClick={() => select.mutate()}
          disabled={select.isPending}
          aria-pressed={finding.selected}
          aria-label={`${finding.selected ? 'Unselect' : 'Select'} finding ${finding.id}`}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-md border transition-colors duration-180 ease-out-quart',
            finding.selected
              ? 'border-brand bg-brand text-brand-ink'
              : 'border-rule bg-raised/35 text-ink-muted hover:border-ink-muted hover:bg-raised hover:text-ink-primary',
            select.isPending && 'cursor-not-allowed opacity-50',
          )}
        >
          <Check
            size={16}
            strokeWidth={3}
            className={finding.selected ? 'opacity-100' : 'opacity-0'}
            aria-hidden="true"
          />
        </button>
      </div>

      <div className="min-w-0 flex-1 space-y-3">
        <header className="flex items-start gap-2.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
            <span className="font-mono text-meta text-ink-muted tabular-nums">{finding.id}</span>
            <span
              className={cn('text-caps tracking-caps uppercase', SEVERITY_TEXT[finding.severity])}
            >
              {finding.severity}
            </span>
            <Tag tone="neutral">{finding.category}</Tag>
            <span className="inline-flex min-w-0 max-w-full items-center gap-2">
              <FindingLocation file={finding.file} line={finding.line} />
              {finding.file && session.url ? (
                <a
                  href={githubLineLink(session, finding.file, finding.line)}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-ink-muted hover:text-brand transition-colors duration-180 ease-out-quart"
                  aria-label="Open on GitHub"
                >
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              ) : null}
            </span>
            {finding.edited ? (
              <Pencil size={12} className="shrink-0 text-ink-muted" aria-label="Edited" />
            ) : null}
          </div>
          {!editing ? (
            <div className="flex shrink-0 items-center gap-1">
              <KbdTooltip keys={['e']} label="edit">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  aria-label="Edit"
                  className="p-1 rounded-sm text-ink-muted hover:text-ink-primary hover:bg-raised transition-colors duration-180 ease-out-quart opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
              </KbdTooltip>
              <ConfirmAction
                title={`Delete finding ${finding.id}?`}
                description="This removes it from the current review session."
                confirmLabel="Delete"
                onConfirm={() => remove.mutate()}
              >
                {(requestConfirm) => (
                  <button
                    type="button"
                    onClick={requestConfirm}
                    aria-label="Delete"
                    className="p-1 rounded-sm text-ink-muted hover:text-severity-must hover:bg-raised transition-colors duration-180 ease-out-quart opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                )}
              </ConfirmAction>
            </div>
          ) : null}
        </header>

        {!editing ? (
          <>
            <h3 id={`f-${finding.dbId}-title`} className="text-h2 text-ink-primary">
              {finding.title}
            </h3>
            <div className="prose prose-sm max-w-none prose-headings:text-ink-primary prose-p:text-ink-primary prose-strong:text-ink-primary prose-code:text-ink-primary prose-a:text-brand prose-a:no-underline hover:prose-a:underline">
              <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{finding.body}</ReactMarkdown>
            </div>
            {finding.file && finding.line !== null ? (
              <DiffViewer
                unifiedDiff={unifiedDiff}
                file={finding.file}
                line={finding.line}
                findingId={finding.id}
              />
            ) : null}
            {finding.suggestion ? (
              <div className="border-t border-rule pt-3">
                <div className="text-caps tracking-caps text-ink-muted uppercase mb-1.5">
                  Suggestion
                </div>
                <pre className="font-mono text-code text-ink-primary bg-sunken border border-rule rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
                  <code>{finding.suggestion}</code>
                </pre>
              </div>
            ) : null}
          </>
        ) : (
          <div className="space-y-4">
            <label className="block">
              <span className="text-caps tracking-caps text-ink-muted uppercase">Title</span>
              <input
                type="text"
                aria-label="Title"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className="mt-1 w-full bg-transparent border-b border-rule py-1 text-h2 text-ink-primary focus:outline-none focus:border-brand transition-colors duration-180 ease-out-quart"
              />
            </label>

            <fieldset>
              <legend className="text-caps tracking-caps text-ink-muted uppercase mb-1.5">
                Severity
              </legend>
              <div role="radiogroup" className="inline-flex gap-1">
                {SEVERITY_LIST.map((sev) => {
                  const active = draft.severity === sev
                  return (
                    <label
                      key={sev}
                      className={cn(
                        'px-2.5 py-1 rounded-sm cursor-pointer text-caps tracking-caps uppercase transition-colors duration-180 ease-out-quart',
                        active
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
                        checked={active}
                        onChange={() => setDraft({ ...draft, severity: sev })}
                        aria-label={SEVERITY_LABEL[sev]}
                        className="sr-only"
                      />
                      {SEVERITY_LABEL[sev]}
                    </label>
                  )
                })}
              </div>
            </fieldset>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-caps tracking-caps text-ink-muted uppercase">
                  Body (markdown)
                </span>
                <textarea
                  aria-label="Body"
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  className="mt-1 w-full h-48 p-2 font-mono text-code rounded-md bg-sunken border border-rule text-ink-primary focus:outline-none focus:border-brand transition-colors duration-180 ease-out-quart resize-y"
                />
              </label>
              <div className="block">
                <span className="text-caps tracking-caps text-ink-muted uppercase">Preview</span>
                <div className="mt-1 h-48 p-3 rounded-md bg-sunken border border-rule overflow-auto prose prose-sm max-w-none prose-headings:text-ink-primary prose-p:text-ink-primary prose-strong:text-ink-primary prose-code:text-ink-primary prose-a:text-brand prose-a:no-underline">
                  <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
                    {draft.body || '*(empty)*'}
                  </ReactMarkdown>
                </div>
              </div>
            </div>

            <label className="block">
              <span className="text-caps tracking-caps text-ink-muted uppercase">
                Suggestion (optional)
              </span>
              <textarea
                aria-label="Suggestion"
                value={draft.suggestion}
                onChange={(e) => setDraft({ ...draft, suggestion: e.target.value })}
                className="mt-1 w-full h-24 p-2 font-mono text-code rounded-md bg-sunken border border-rule text-ink-primary focus:outline-none focus:border-brand transition-colors duration-180 ease-out-quart resize-y"
              />
            </label>

            <div className="flex items-center gap-3">
              <KbdTooltip keys={['⌘', '⏎']} label="save">
                <Button
                  type="button"
                  variant="ink"
                  size="sm"
                  onClick={() => save.mutate()}
                  disabled={save.isPending}
                >
                  {save.isPending ? 'Saving…' : 'Save'}
                </Button>
              </KbdTooltip>
              <KbdTooltip keys={['Esc']} label="cancel">
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </KbdTooltip>
              {save.isError ? (
                <span className="text-caps tracking-caps text-severity-must uppercase">
                  {save.error instanceof ApiError ? save.error.message : 'save failed'}
                </span>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </article>
  )
}
