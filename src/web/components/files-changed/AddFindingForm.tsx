import type { ManualFindingInput, Severity } from '@shared/findings-schema'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, SeverityLabel } from '@/components/ui'
import { api, queryKeys } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Props {
  sessionId: string
  file: string
  /** Omit for a file-level finding (the whole file, no line anchor). */
  line?: number | undefined
  /** When set and `< line`, the finding spans a range from startLine..line (inclusive). */
  startLine?: number | undefined
  /** Optional client-side check: every line in [start..end] must map to a new-side change. */
  validateRange?: ((start: number, end: number) => boolean) | undefined
  onCancel: () => void
  onCreated: () => void
}

const SEVERITY_LIST: Severity[] = ['must', 'should', 'nit']

export function AddFindingForm({
  sessionId,
  file,
  line,
  startLine,
  validateRange,
  onCancel,
  onCreated,
}: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [severity, setSeverity] = useState<Severity>('should')
  const [category, setCategory] = useState('Manual')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [suggestion, setSuggestion] = useState('')

  const isFileLevel = line === undefined
  const isRange = !isFileLevel && startLine != null && startLine < line
  const rangeValid =
    !isRange || !validateRange || startLine === undefined ? true : validateRange(startLine, line)

  const create = useMutation({
    mutationFn: (input: ManualFindingInput) => api.createManualFinding(sessionId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
      onCreated()
    },
  })

  const submit = (): void => {
    if (!title.trim() || !body.trim()) return
    if (!rangeValid) return
    const input: ManualFindingInput = {
      severity,
      category: category.trim() || 'Manual',
      file,
      title: title.trim(),
      body: body.trim(),
    }
    if (!isFileLevel) input.line = line
    if (isRange) input.startLine = startLine
    // File-level findings render into the review body — a `suggestion`
    // fenced block is only actionable on inline comments, so attaching one
    // here would just produce a misleading code block in the review body.
    if (!isFileLevel && suggestion.trim()) input.suggestion = suggestion
    create.mutate(input)
  }

  return (
    <div className="border border-rule rounded-md mx-2 my-2 p-3 bg-raised space-y-3">
      <div className="flex items-center gap-2 text-meta text-ink-secondary">
        <span className="text-caps tracking-caps uppercase">
          {isFileLevel
            ? t('filesChanged.addFinding.fileLevelHeading')
            : t('filesChanged.addFinding.heading')}
        </span>
        <span className="font-mono text-ink-muted">
          {isFileLevel
            ? `${file} · ${t('filesChanged.addFinding.fileLevelLoc')}`
            : `${file}:${isRange ? `${startLine}-${line}` : line}`}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-caps tracking-caps text-ink-muted uppercase">
          {t('filesChanged.addFinding.severity')}
        </span>
        {SEVERITY_LIST.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSeverity(s)}
            aria-pressed={severity === s}
            className={cn(
              'px-2 py-0.5 rounded border text-meta transition-colors duration-180 ease-out-quart',
              severity === s
                ? 'border-brand bg-[color:color-mix(in_oklch,var(--brand)_12%,transparent)]'
                : 'border-rule hover:bg-sunken',
            )}
          >
            <SeverityLabel level={s} />
          </button>
        ))}
      </div>
      <label className="block">
        <span className="text-caps tracking-caps text-ink-muted uppercase">
          {t('filesChanged.addFinding.category')}
        </span>
        <input
          type="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="mt-1 w-full bg-sunken border border-rule rounded px-2 py-1 text-body"
        />
      </label>
      <label className="block">
        <span className="text-caps tracking-caps text-ink-muted uppercase">
          {t('filesChanged.addFinding.title')}
        </span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          autoFocus
          className="mt-1 w-full bg-sunken border border-rule rounded px-2 py-1 text-body"
        />
      </label>
      <label className="block">
        <span className="text-caps tracking-caps text-ink-muted uppercase">
          {t('filesChanged.addFinding.body')}
        </span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          rows={4}
          className="mt-1 w-full bg-sunken border border-rule rounded px-2 py-1 text-body font-mono"
        />
      </label>
      {isFileLevel ? null : (
        <label className="block">
          <span className="text-caps tracking-caps text-ink-muted uppercase">
            {t('filesChanged.addFinding.suggestion')}
          </span>
          <textarea
            value={suggestion}
            onChange={(e) => setSuggestion(e.target.value)}
            rows={3}
            className="mt-1 w-full bg-sunken border border-rule rounded px-2 py-1 text-body font-mono"
          />
        </label>
      )}
      {!rangeValid ? (
        <div className="text-meta text-[color:var(--severity-must)]">
          {t('filesChanged.addFinding.rangeInvalid')}
        </div>
      ) : null}
      {create.isError ? (
        <div className="text-meta text-[color:var(--severity-must)]">
          {(create.error as Error).message}
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={create.isPending}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={submit}
          disabled={create.isPending || !title.trim() || !body.trim() || !rangeValid}
        >
          {create.isPending
            ? t('filesChanged.addFinding.saving')
            : t('filesChanged.addFinding.save')}
        </Button>
      </div>
    </div>
  )
}
