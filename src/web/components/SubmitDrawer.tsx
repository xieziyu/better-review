import type { Finding, ReviewEvent } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { Button, KbdTooltip, Tag } from '@/components/ui'
import { api, queryKeys, ApiError } from '@/lib/api'
import { isLineInDiff } from '@/lib/diff-line-check'
import { cn } from '@/lib/utils'

interface Props {
  sessionId: string
  onClose: () => void
}

type Step = 1 | 2

const EVENT_VALUES: ReviewEvent[] = ['COMMENT', 'REQUEST_CHANGES', 'APPROVE']

const SEVERITY_TONE: Record<Finding['severity'], 'must' | 'should' | 'nit'> = {
  must: 'must',
  should: 'should',
  nit: 'nit',
}

const SEVERITY_TEXT: Record<Finding['severity'], string> = {
  must: 'text-severity-must',
  should: 'text-severity-should',
  nit: 'text-severity-nit',
}

function severityTag(severity: Finding['severity']): string {
  if (severity === 'must') return '🔴 **[must]**'
  if (severity === 'should') return '🟡 **[should]**'
  return '🔵 **[nit]**'
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

function PreviewFindingRow({ finding }: { finding: Finding }) {
  const sev = SEVERITY_TONE[finding.severity]
  return (
    <div role="listitem" className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-baseline gap-2.5 flex-wrap">
        <span className="font-mono text-meta text-ink-muted tabular-nums">{finding.id}</span>
        <span className={cn('text-caps tracking-caps uppercase', SEVERITY_TEXT[sev])}>
          {finding.severity}
        </span>
        {finding.category ? <Tag tone="neutral">{finding.category}</Tag> : null}
        <span className="font-mono text-meta text-ink-secondary truncate min-w-0">
          {findingLocation(finding)}
        </span>
      </div>
      <div className="mt-1 text-body text-ink-primary">{finding.title}</div>
    </div>
  )
}

export function SubmitDrawer({ sessionId, onClose }: Props) {
  const { t } = useTranslation()
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div
      className="fixed inset-0 z-40 bg-ink-primary/30 backdrop-blur-[1px] flex justify-end"
      role="presentation"
      onClick={requestClose}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t('submit.ariaLabel')}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[680px] bg-canvas border-l border-rule shadow-2xl flex flex-col min-h-0"
      >
        <div aria-hidden="true" className="h-px bg-brand shrink-0" />
        <header className="px-7 pt-6 pb-5 flex items-start gap-4 shrink-0 border-b border-rule">
          <div className="flex-1 min-w-0">
            <div className="text-caps tracking-caps text-brand uppercase mb-2">
              {t('submit.eyebrow')}
            </div>
            <h2 className="text-h1 text-ink-primary">{t('submit.title')}</h2>
            {data?.session ? (
              <div className="mt-1 font-mono text-meta text-ink-secondary tabular-nums">
                {data.session.owner}/{data.session.repo}#{data.session.number}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label={t('submit.closeAriaLabel')}
            className="p-2 -m-2 text-ink-muted hover:text-ink-primary transition-colors duration-180 ease-out-quart"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-7 py-6 space-y-8">
          {step === 1 ? (
            <>
              <section
                data-testid="selection-summary"
                className="border-b border-rule pb-5 space-y-2"
              >
                <div className="font-mono text-h2 text-ink-primary tabular-nums">
                  {t('submit.selectionSummary', {
                    count: selected.length,
                    total: findings.length,
                  })}
                </div>
                <div className="font-mono text-meta text-ink-secondary tabular-nums">
                  {t('submit.breakdown', {
                    inline: inline.length,
                    body: movedToBody.length,
                    prWide: prWide.length,
                  })}
                </div>
                <div className="font-mono text-meta text-ink-muted tabular-nums">
                  {t('submit.severityCounts', counts)}
                </div>
              </section>

              {inline.length > 0 ? (
                <section>
                  <h3 className="text-caps tracking-caps text-ink-muted uppercase mb-2">
                    {t('submit.inlineSection', { count: inline.length })}
                  </h3>
                  <div data-testid="inline-list" role="list" className="divide-y divide-rule">
                    {inline.map((f) => (
                      <PreviewFindingRow key={f.dbId} finding={f} />
                    ))}
                  </div>
                </section>
              ) : null}

              {movedToBody.length > 0 ? (
                <section>
                  <h3 className="text-caps tracking-caps text-severity-should uppercase mb-1">
                    {t('submit.movedToBodySection', { count: movedToBody.length })}
                  </h3>
                  <p className="text-meta text-ink-secondary mb-2">
                    <Trans
                      i18nKey="submit.movedToBodyNote"
                      components={[<code key="file" className="font-mono" />]}
                    />
                  </p>
                  <div
                    data-testid="moved-to-body-list"
                    role="list"
                    className="divide-y divide-rule"
                  >
                    {movedToBody.map((f) => (
                      <PreviewFindingRow key={f.dbId} finding={f} />
                    ))}
                  </div>
                </section>
              ) : null}

              {prWide.length > 0 ? (
                <section>
                  <h3 className="text-caps tracking-caps text-ink-muted uppercase mb-1">
                    {t('submit.prWideSection', { count: prWide.length })}
                  </h3>
                  <p className="text-meta text-ink-secondary mb-2">{t('submit.prWideNote')}</p>
                  <div data-testid="pr-wide-list" role="list" className="divide-y divide-rule">
                    {prWide.map((f) => (
                      <PreviewFindingRow key={f.dbId} finding={f} />
                    ))}
                  </div>
                </section>
              ) : null}

              {selected.length === 0 ? (
                <p className="text-meta text-ink-muted border-t border-rule pt-4">
                  {t('submit.noSelection')}
                </p>
              ) : null}

              <hr className="border-t border-brand" />

              <section className="space-y-4">
                <fieldset
                  role="radiogroup"
                  aria-label={t('submit.event.ariaLabel')}
                  className="space-y-2"
                >
                  <legend className="text-caps tracking-caps text-ink-muted uppercase mb-1">
                    {t('submit.event.label')}
                  </legend>
                  {EVENT_VALUES.map((value) => (
                    <label
                      key={value}
                      className={cn(
                        'group grid grid-cols-[auto_1fr] sm:grid-cols-[auto_11rem_1fr] gap-x-3 gap-y-1 rounded-md border px-3.5 py-3 cursor-pointer transition-[background-color,border-color,color] duration-180 ease-out-quart focus-within:outline focus-within:outline-[1.5px] focus-within:outline-brand focus-within:outline-offset-2',
                        event === value
                          ? 'border-brand bg-raised text-ink-primary'
                          : 'border-rule bg-transparent text-ink-secondary hover:border-ink-muted hover:bg-raised/45 hover:text-ink-primary',
                      )}
                    >
                      <input
                        type="radio"
                        name="event"
                        value={value}
                        checked={event === value}
                        onChange={() => setEvent(value)}
                        aria-label={value}
                        className="sr-only"
                      />
                      <span
                        aria-hidden="true"
                        className={cn(
                          'flex size-4 shrink-0 self-center items-center justify-center rounded-full border transition-colors duration-180 ease-out-quart',
                          event === value
                            ? 'border-brand bg-brand'
                            : 'border-rule bg-canvas group-hover:border-ink-muted',
                        )}
                      >
                        <span
                          className={cn(
                            'size-1.5 rounded-full transition-colors duration-180 ease-out-quart',
                            event === value ? 'bg-brand-ink' : 'bg-transparent',
                          )}
                        />
                      </span>
                      <span className="flex min-h-5 items-center font-mono text-meta tabular-nums">
                        {value}
                      </span>
                      <span className="col-start-2 flex min-h-5 items-center text-meta text-ink-muted sm:col-start-auto">
                        {t(`submit.event.${value}_desc`)}
                      </span>
                    </label>
                  ))}
                </fieldset>

                <label className="block">
                  <span className="text-caps tracking-caps text-ink-muted uppercase">
                    {t('submit.reviewBody')}
                  </span>
                  <textarea
                    aria-label={t('submit.reviewBodyAria')}
                    value={body}
                    onChange={(e) => {
                      setBody(e.target.value)
                      setBodyTouched(true)
                    }}
                    className="mt-1 w-full h-40 p-3 font-mono text-code rounded-md bg-sunken border border-rule text-ink-primary focus:outline-none focus:border-brand transition-colors duration-180 ease-out-quart resize-y"
                  />
                  {prWide.length > 0 && !bodyTouched ? (
                    <span className="block text-meta text-ink-muted mt-1">
                      {t('submit.autoFilled', { count: prWide.length })}
                    </span>
                  ) : null}
                </label>

                {!diff && selected.some((f) => f.file !== null) ? (
                  <p className="text-meta text-ink-muted">{t('submit.diffNotLoaded')}</p>
                ) : null}
              </section>
            </>
          ) : null}

          {step === 2 ? (
            <section className="space-y-5">
              {submit.data ? (
                <div className="border-t border-brand pt-5 space-y-2">
                  <div className="text-caps tracking-caps text-brand uppercase">
                    {t('submit.submitted')}
                  </div>
                  <a
                    href={submit.data.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-body text-ink-primary hover:text-brand transition-colors duration-180 ease-out-quart break-all"
                  >
                    <ExternalLink size={12} aria-hidden="true" />
                    {submit.data.url}
                  </a>
                  {submit.data.droppedToBody.length > 0 ? (
                    <div className="text-meta text-severity-should">
                      {t('submit.droppedToBody', { count: submit.data.droppedToBody.length })}
                    </div>
                  ) : null}
                  {submit.data.skippedDuplicates > 0 ? (
                    <div className="text-meta text-ink-secondary">
                      {t('submit.skippedDuplicates', { count: submit.data.skippedDuplicates })}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="border-y border-rule py-5 space-y-2">
                  <div className="text-caps tracking-caps text-ink-muted uppercase">
                    {t('submit.confirmation')}
                  </div>
                  <div className="text-h2 text-ink-primary font-mono">
                    {event} on {data?.session.owner}/{data?.session.repo}#{data?.session.number}
                  </div>
                  <div className="text-meta text-ink-secondary">
                    {t('submit.confirmationLine', { count: inline.length })}
                  </div>
                  {movedToBody.length > 0 ? (
                    <div className="text-meta text-ink-secondary">
                      {t('submit.confirmationMaybeMove', { count: movedToBody.length })}
                    </div>
                  ) : null}
                  {body.trim() || prWide.length > 0 ? (
                    <div className="text-meta text-ink-secondary">
                      {t('submit.confirmationReviewBody')}
                    </div>
                  ) : null}
                  <p className="text-meta text-ink-muted pt-2">{t('submit.confirmationNote')}</p>
                </div>
              )}
              {submit.isError ? (
                <div className="text-meta text-severity-must border-t border-severity-must/40 pt-3">
                  {submit.error instanceof ApiError
                    ? submit.error.message
                    : t('submit.submitFailed')}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>

        <footer className="shrink-0 border-t border-rule bg-canvas">
          <div className="px-7 py-3.5 flex items-center justify-between">
            <Button type="button" variant="ghost" size="md" onClick={requestClose}>
              {submit.data ? t('submit.closeButton') : t('common.cancel')}
            </Button>
            <div className="flex items-center gap-3">
              {step > 1 && !submit.data ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={() => setStep((s) => (s - 1) as Step)}
                >
                  {t('common.back')}
                </Button>
              ) : null}
              {step < 2 ? (
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={() => setStep((s) => (s + 1) as Step)}
                  disabled={step === 1 && selected.length === 0}
                >
                  {t('common.next')}
                </Button>
              ) : null}
              {step === 2 && !submit.data ? (
                <KbdTooltip keys={['⌘', '⏎']} label={t('submit.submitButton')}>
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    onClick={() => submit.mutate()}
                    disabled={submit.isPending || selected.length === 0}
                  >
                    {submit.isPending ? t('submit.submitting') : t('submit.submitButton')}
                  </Button>
                </KbdTooltip>
              ) : null}
            </div>
          </div>
        </footer>
      </aside>
    </div>
  )
}
