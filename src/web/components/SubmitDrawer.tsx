import type { Finding, ReviewEvent } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X, ExternalLink } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { api, queryKeys, ApiError } from '@/lib/api'
import { isLineInDiff } from '@/lib/diff-line-check'
import { cn } from '@/lib/utils'

interface Props {
  sessionId: string
  onClose: () => void
}

type Step = 1 | 2

const STEP_LABELS: Record<Step, string> = {
  1: 'Prepare',
  2: 'Confirm',
}

const EVENT_OPTIONS: Array<{ value: ReviewEvent; label: string; description: string }> = [
  {
    value: 'COMMENT',
    label: 'COMMENT',
    description: 'Leave comments without approving or rejecting.',
  },
  {
    value: 'REQUEST_CHANGES',
    label: 'REQUEST_CHANGES',
    description: 'Block merge until addressed.',
  },
  { value: 'APPROVE', label: 'APPROVE', description: 'Mark as ready to merge.' },
]

const SEVERITY_TOKENS: Record<
  Finding['severity'],
  { icon: string; dot: string; border: string; bg: string; text: string }
> = {
  must: {
    icon: '●',
    dot: 'bg-red-500',
    border: 'border-l-red-500',
    bg: 'bg-red-50 dark:bg-red-950/30',
    text: 'text-red-700 dark:text-red-300',
  },
  should: {
    icon: '◐',
    dot: 'bg-amber-500',
    border: 'border-l-amber-500',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    text: 'text-amber-700 dark:text-amber-300',
  },
  nit: {
    icon: '○',
    dot: 'bg-emerald-500',
    border: 'border-l-emerald-500',
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
}

function severityTag(severity: Finding['severity']): string {
  if (severity === 'must') return '🔴 **[must]**'
  if (severity === 'should') return '🟡 **[should]**'
  return '🟢 **[nit]**'
}

function formatPRWideBody(prWide: Finding[]): string {
  if (prWide.length === 0) return ''
  const lines = ['**PR-wide notes:**']
  for (const f of prWide) {
    lines.push(`- ${severityTag(f.severity)} **${f.title}**`)
    if (f.body.trim()) {
      const indented = f.body
        .trim()
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n')
      lines.push(indented)
    }
  }
  return lines.join('\n')
}

function severityCounts(findings: Finding[]): Record<'must' | 'should' | 'nit', number> {
  const counts = { must: 0, should: 0, nit: 0 }
  for (const f of findings) counts[f.severity] += 1
  return counts
}

function findingLocation(finding: Finding): string {
  if (!finding.file) return 'whole PR'
  return `${finding.file}${finding.line ? `:${finding.line}` : ''}`
}

function PreviewFindingCard({
  finding,
  destination,
}: {
  finding: Finding
  destination: 'Inline' | 'Body'
}) {
  const tokens = SEVERITY_TOKENS[finding.severity]

  return (
    <div
      role="listitem"
      className={cn(
        'relative overflow-hidden rounded-md border border-gray-200 dark:border-gray-800 border-l-4 bg-white dark:bg-gray-950 p-3',
        tokens.border,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', tokens.dot)}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] leading-5">
            <span className="font-mono text-gray-500 dark:text-gray-400">{finding.id}</span>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium',
                tokens.bg,
                tokens.text,
              )}
            >
              <span aria-hidden>{tokens.icon}</span>
              {finding.severity}
            </span>
            <span
              className={cn(
                'inline-flex rounded px-1.5 py-0.5 font-medium',
                destination === 'Inline'
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300'
                  : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
              )}
            >
              {destination}
            </span>
            {finding.category && (
              <span className="inline-flex rounded bg-gray-100 px-1.5 py-0.5 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                {finding.category}
              </span>
            )}
            <span className="min-w-0 truncate font-mono text-gray-500 dark:text-gray-400">
              {findingLocation(finding)}
            </span>
          </div>
          <div className="text-sm font-medium leading-5 text-gray-900 dark:text-gray-100">
            {finding.title}
          </div>
        </div>
      </div>
    </div>
  )
}

export function SubmitDrawer({ sessionId, onClose }: Props) {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: queryKeys.session(sessionId),
    queryFn: () => api.getSession(sessionId),
  })
  const { data: diffData } = useQuery({
    queryKey: ['session', sessionId, 'diff'] as const,
    queryFn: () => api.getSessionDiff(sessionId),
  })
  const [step, setStep] = useState<Step>(1)
  const [event, setEvent] = useState<ReviewEvent>('COMMENT')
  const [body, setBody] = useState('')
  const [bodyTouched, setBodyTouched] = useState(false)

  const findings = useMemo(
    () => (data?.findings ?? []).filter((f) => !f.archived),
    [data?.findings],
  )
  const selected = useMemo(() => findings.filter((f) => f.selected), [findings])
  const diff = diffData ?? null
  const groups = useMemo(() => {
    const inline: Finding[] = []
    const movedToBody: Finding[] = []
    const prWide: Finding[] = []
    for (const f of selected) {
      if (f.file === null || f.line === null) {
        prWide.push(f)
      } else if (diff && !isLineInDiff(diff, f.file, f.line)) {
        movedToBody.push(f)
      } else {
        inline.push(f)
      }
    }
    return { inline, movedToBody, prWide }
  }, [selected, diff])
  const inline = groups.inline
  const movedToBody = groups.movedToBody
  const prWide = groups.prWide
  const counts = useMemo(() => severityCounts(selected), [selected])

  // Prefill body with PR-wide findings the first time we have data; user can edit.
  useEffect(() => {
    if (!bodyTouched) {
      const auto = formatPRWideBody(prWide)
      setBody(auto)
    }
  }, [prWide, bodyTouched])

  const submit = useMutation({
    mutationFn: () => {
      const trimmed = body.trim()
      return api.submit(sessionId, trimmed ? { event, body } : { event })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
      void qc.invalidateQueries({ queryKey: queryKeys.sessions })
    },
  })

  const requestClose = () => {
    if (submit.isPending) return
    onClose()
  }

  return (
    <div
      className="fixed inset-0 bg-black/30 z-40 flex justify-end"
      onClick={requestClose}
      role="dialog"
      aria-modal="true"
      aria-label="Submit review"
    >
      <div
        className="w-full max-w-2xl bg-white dark:bg-gray-950 h-full overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-950 z-10">
          <h2 className="text-lg font-semibold">Submit review</h2>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={18} />
          </button>
        </header>

        <nav className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <ol className="flex items-center gap-2 text-xs text-gray-500">
            {([1, 2] as Step[]).map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span
                  className={cn(
                    'inline-flex w-5 h-5 items-center justify-center rounded-full border text-[11px]',
                    s === step
                      ? 'bg-blue-600 text-white border-blue-600'
                      : s < step
                        ? 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                        : 'border-gray-300 dark:border-gray-700',
                  )}
                >
                  {s}
                </span>
                <span className={cn(s === step && 'text-gray-900 dark:text-gray-100 font-medium')}>
                  {STEP_LABELS[s]}
                </span>
                {i < 1 && <span aria-hidden>·</span>}
              </li>
            ))}
          </ol>
        </nav>

        <div className="p-4 space-y-4">
          {step === 1 && (
            <section className="space-y-4">
              <fieldset className="space-y-2" role="radiogroup" aria-label="Review event type">
                <legend className="text-sm font-medium">Event type</legend>
                {EVENT_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={cn(
                      'flex items-start gap-3 p-3 rounded-md border cursor-pointer',
                      event === opt.value
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40'
                        : 'border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900',
                    )}
                  >
                    <input
                      type="radio"
                      name="event"
                      value={opt.value}
                      checked={event === opt.value}
                      onChange={() => setEvent(opt.value)}
                      aria-label={opt.label}
                      className="mt-0.5 h-4 w-4 text-blue-600"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium">{opt.label}</div>
                      <div className="text-xs text-gray-500">{opt.description}</div>
                    </div>
                  </label>
                ))}
              </fieldset>

              <label className="block">
                <span className="text-sm font-medium">Review body (markdown)</span>
                <textarea
                  aria-label="Review body"
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value)
                    setBodyTouched(true)
                  }}
                  className="mt-1 w-full h-40 p-2 text-sm font-mono rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {prWide.length > 0 && !bodyTouched && (
                  <span className="block text-xs text-gray-500 mt-1">
                    Auto-filled from {prWide.length} PR-wide finding{prWide.length === 1 ? '' : 's'}
                    .
                  </span>
                )}
              </label>

              <div>
                <div className="text-sm" data-testid="selection-summary">
                  <strong>{selected.length}</strong> finding{selected.length === 1 ? '' : 's'}{' '}
                  selected of {findings.length} total
                </div>
                <div className="mt-2 flex items-center gap-3 text-xs text-gray-600 dark:text-gray-400">
                  <span>● {counts.must} must</span>
                  <span>◐ {counts.should} should</span>
                  <span>○ {counts.nit} nit</span>
                </div>
              </div>
              {!diff && selected.some((f) => f.file !== null) && (
                <div className="text-xs text-gray-500">
                  Diff not loaded — line-in-diff check will run on submit.
                </div>
              )}
              {inline.length > 0 && (
                <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/40 p-3">
                  <div className="mb-2 text-xs font-medium text-gray-700 dark:text-gray-300">
                    {inline.length} inline comment{inline.length === 1 ? '' : 's'}
                  </div>
                  <div
                    data-testid="inline-list"
                    role="list"
                    className="space-y-2"
                  >
                    {inline.map((f) => (
                      <PreviewFindingCard key={f.dbId} finding={f} destination="Inline" />
                    ))}
                  </div>
                </div>
              )}
              {movedToBody.length > 0 && (
                <div className="rounded-md bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 p-3">
                  <div className="text-xs font-medium text-amber-800 dark:text-amber-300">
                    {movedToBody.length} finding{movedToBody.length === 1 ? '' : 's'} will be moved
                    to the review body
                  </div>
                  <div className="mb-2 mt-1 text-xs text-amber-700 dark:text-amber-400">
                    Their <code className="font-mono">file:line</code> is outside the PR diff, so
                    GitHub would reject them as inline comments.
                  </div>
                  <div
                    data-testid="moved-to-body-list"
                    role="list"
                    className="space-y-2"
                  >
                    {movedToBody.map((f) => (
                      <PreviewFindingCard key={f.dbId} finding={f} destination="Body" />
                    ))}
                  </div>
                </div>
              )}
              {prWide.length > 0 && (
                <div className="rounded-md bg-blue-50/40 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900 p-3">
                  <div className="mb-2 text-xs font-medium text-blue-700 dark:text-blue-300">
                    {prWide.length} PR-wide finding{prWide.length === 1 ? '' : 's'} will be added to
                    the review body
                  </div>
                  <div data-testid="pr-wide-list" role="list" className="space-y-2">
                    {prWide.map((f) => (
                      <PreviewFindingCard key={f.dbId} finding={f} destination="Body" />
                    ))}
                  </div>
                </div>
              )}
              {selected.length === 0 && (
                <div className="text-xs text-gray-500 rounded-md border border-gray-200 dark:border-gray-800 p-3">
                  No findings selected.
                </div>
              )}
            </section>
          )}

          {step === 2 && (
            <section className="space-y-4">
              {submit.data ? (
                <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 p-4 text-sm space-y-2">
                  <div className="font-medium text-emerald-800 dark:text-emerald-300">
                    Submitted
                  </div>
                  <a
                    href={submit.data.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 hover:underline break-all"
                  >
                    <ExternalLink size={12} />
                    {submit.data.url}
                  </a>
                  {submit.data.droppedToBody.length > 0 && (
                    <div className="text-xs text-amber-700 dark:text-amber-400">
                      {submit.data.droppedToBody.length} finding(s) dropped to review body (line not
                      in diff).
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-md border border-gray-200 dark:border-gray-800 p-4 text-sm space-y-1">
                  <div>
                    <strong>{event}</strong> on {data?.session.owner}/{data?.session.repo}#
                    {data?.session.number}
                  </div>
                  <div>
                    {inline.length} inline comment{inline.length === 1 ? '' : 's'}
                  </div>
                  {movedToBody.length > 0 && (
                    <div>
                      {movedToBody.length} finding{movedToBody.length === 1 ? '' : 's'} may move to
                      the review body
                    </div>
                  )}
                  {(body.trim() || prWide.length > 0) && <div>1 review body comment</div>}
                  <div className="text-xs text-gray-500 mt-2">
                    This will post immediately. There is no &quot;draft&quot; mode.
                  </div>
                </div>
              )}
              {submit.isError && (
                <div className="rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 p-3 text-sm text-red-700 dark:text-red-300">
                  {submit.error instanceof ApiError ? submit.error.message : 'Submit failed'}
                </div>
              )}
            </section>
          )}
        </div>

        <footer className="sticky bottom-0 bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800 p-4 flex items-center justify-between">
          <button
            type="button"
            onClick={requestClose}
            className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {submit.data ? 'Close' : 'Cancel'}
          </button>
          <div className="flex items-center gap-2">
            {step > 1 && !submit.data && (
              <button
                type="button"
                onClick={() => setStep((s) => (s - 1) as Step)}
                className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Back
              </button>
            )}
            {step < 2 && (
              <button
                type="button"
                onClick={() => setStep((s) => (s + 1) as Step)}
                disabled={step === 1 && selected.length === 0}
                className="px-4 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300"
              >
                Next
              </button>
            )}
            {step === 2 && !submit.data && (
              <button
                type="button"
                onClick={() => submit.mutate()}
                disabled={submit.isPending || selected.length === 0}
                className="px-4 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300"
              >
                {submit.isPending ? 'Submitting…' : 'Submit'}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}
