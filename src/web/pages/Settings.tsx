import { AGENT_KINDS, type AppConfig } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { Button, Field, NumberInput, Select, Tag } from '@/components/ui'
import { ApiError, api, queryKeys } from '@/lib/api'

interface FieldErrors {
  port?: string
  maxConcurrentReviews?: string
  stallMinutes?: string
  perPRGCDays?: string
}

function validate(draft: AppConfig | null): FieldErrors {
  const errors: FieldErrors = {}
  if (!draft) return errors
  if (!Number.isInteger(draft.port) || draft.port < 0 || draft.port > 65535) {
    errors.port = 'Must be an integer between 0 and 65535.'
  }
  if (
    !Number.isInteger(draft.maxConcurrentReviews) ||
    draft.maxConcurrentReviews < 1 ||
    draft.maxConcurrentReviews > 16
  ) {
    errors.maxConcurrentReviews = 'Must be an integer between 1 and 16.'
  }
  if (!Number.isInteger(draft.stallMinutes) || draft.stallMinutes < 1 || draft.stallMinutes > 60) {
    errors.stallMinutes = 'Must be an integer between 1 and 60.'
  }
  if (!Number.isInteger(draft.perPRGCDays) || draft.perPRGCDays < 0 || draft.perPRGCDays > 365) {
    errors.perPRGCDays = 'Must be an integer between 0 and 365.'
  }
  return errors
}

function isDirty(server: AppConfig, draft: AppConfig): boolean {
  return (
    server.port !== draft.port ||
    server.maxConcurrentReviews !== draft.maxConcurrentReviews ||
    server.stallMinutes !== draft.stallMinutes ||
    server.defaultAgent !== draft.defaultAgent ||
    server.perPRGCDays !== draft.perPRGCDays
  )
}

export function Settings() {
  const qc = useQueryClient()
  const cfgQ = useQuery({ queryKey: queryKeys.config, queryFn: api.getConfig })
  const healthQ = useQuery({ queryKey: queryKeys.health, queryFn: api.health })

  const [draft, setDraft] = useState<AppConfig | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    if (cfgQ.data && draft === null) setDraft({ ...cfgQ.data.config })
  }, [cfgQ.data, draft])

  const dirty = useMemo(() => {
    if (!cfgQ.data || !draft) return false
    return isDirty(cfgQ.data.config, draft)
  }, [cfgQ.data, draft])

  const errors = useMemo(() => validate(draft), [draft])
  const hasErrors = Object.values(errors).some(Boolean)

  const saveMut = useMutation({
    mutationFn: (next: AppConfig) => api.putConfig(next),
    onSuccess: ({ config }) => {
      qc.setQueryData(queryKeys.config, { config, file: cfgQ.data?.file ?? '' })
      void qc.invalidateQueries({ queryKey: queryKeys.health })
      setDraft({ ...config })
      setSavedFlash(true)
      window.setTimeout(() => setSavedFlash(false), 2000)
    },
  })

  if (!cfgQ.data || !draft) {
    return (
      <div className="px-8 py-10 mx-auto max-w-2xl space-y-6" aria-label="Loading settings">
        <div className="text-caps tracking-caps text-ink-muted uppercase">Loading</div>
        <div className="h-8 w-2/3 bg-raised rounded" />
        <div className="h-px w-full bg-rule" />
        <div className="h-9 w-full bg-raised/70 rounded" />
        <div className="h-9 w-full bg-raised/70 rounded" />
      </div>
    )
  }

  const set = <K extends keyof AppConfig>(key: K, value: AppConfig[K]): void => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  const numericChange =
    (key: 'port' | 'maxConcurrentReviews' | 'stallMinutes' | 'perPRGCDays') =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.currentTarget.value
      // Empty input maps to NaN — kept in draft so validate() flags it; the
      // user sees the inline error and Save stays disabled.
      const n = raw === '' ? Number.NaN : Number(raw)
      set(key, n)
    }

  const agentHealth = healthQ.data?.agents

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (dirty && !hasErrors && !saveMut.isPending) saveMut.mutate(draft)
      }}
      className="px-8 py-10 mx-auto max-w-2xl space-y-10"
    >
      <header>
        <div className="text-caps tracking-caps text-ink-muted uppercase mb-2">Settings</div>
        <h1 className="text-display text-ink-primary">Runtime</h1>
        <p className="mt-3 text-body text-ink-secondary">
          Stored at{' '}
          <code className="font-mono text-code text-ink-primary bg-sunken px-1 py-0.5 rounded-sm">
            {cfgQ.data.file}
          </code>
          . Most changes apply immediately; <code className="font-mono text-code">port</code> and{' '}
          <code className="font-mono text-code">maxConcurrentReviews</code> require restarting the
          daemon.
        </p>
      </header>

      <section className="space-y-6">
        <Field
          label="Default agent"
          htmlFor="cfg-defaultAgent"
          hint="Used when a new review session does not pick one explicitly. Missing agents stay selectable so you can install them later."
          trail={
            agentHealth
              ? AGENT_KINDS.map((k) =>
                  agentHealth[k].found ? (
                    <Tag key={k} tone="success">
                      {k} found
                    </Tag>
                  ) : (
                    <Tag key={k} tone="danger">
                      {k} missing
                    </Tag>
                  ),
                )
              : null
          }
        >
          <Select
            id="cfg-defaultAgent"
            value={draft.defaultAgent}
            onChange={(e) =>
              set('defaultAgent', e.currentTarget.value as AppConfig['defaultAgent'])
            }
          >
            {AGENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Stall minutes"
          htmlFor="cfg-stallMinutes"
          hint="Watchdog kills an agent run with no stdout for this many minutes."
          {...(errors.stallMinutes ? { error: errors.stallMinutes } : {})}
        >
          <NumberInput
            id="cfg-stallMinutes"
            min={1}
            max={60}
            step={1}
            value={Number.isFinite(draft.stallMinutes) ? draft.stallMinutes : ''}
            onChange={numericChange('stallMinutes')}
            tone={errors.stallMinutes ? 'error' : 'default'}
          />
        </Field>

        <Field
          label="Per-PR GC days"
          htmlFor="cfg-perPRGCDays"
          hint="Garbage-collect per-PR workdirs after this many days. 0 disables GC."
          {...(errors.perPRGCDays ? { error: errors.perPRGCDays } : {})}
        >
          <NumberInput
            id="cfg-perPRGCDays"
            min={0}
            max={365}
            step={1}
            value={Number.isFinite(draft.perPRGCDays) ? draft.perPRGCDays : ''}
            onChange={numericChange('perPRGCDays')}
            tone={errors.perPRGCDays ? 'error' : 'default'}
          />
        </Field>

        <Field
          label="Max concurrent reviews"
          htmlFor="cfg-maxConcurrentReviews"
          hint="How many agent processes may run in parallel."
          trail={<Tag tone="warning">restart required</Tag>}
          {...(errors.maxConcurrentReviews ? { error: errors.maxConcurrentReviews } : {})}
        >
          <NumberInput
            id="cfg-maxConcurrentReviews"
            min={1}
            max={16}
            step={1}
            value={Number.isFinite(draft.maxConcurrentReviews) ? draft.maxConcurrentReviews : ''}
            onChange={numericChange('maxConcurrentReviews')}
            tone={errors.maxConcurrentReviews ? 'error' : 'default'}
          />
        </Field>

        <Field
          label="Port"
          htmlFor="cfg-port"
          hint="0 lets the OS pick. Otherwise a free port between 1 and 65535."
          trail={<Tag tone="warning">restart required</Tag>}
          {...(errors.port ? { error: errors.port } : {})}
        >
          <NumberInput
            id="cfg-port"
            min={0}
            max={65535}
            step={1}
            value={Number.isFinite(draft.port) ? draft.port : ''}
            onChange={numericChange('port')}
            tone={errors.port ? 'error' : 'default'}
          />
        </Field>
      </section>

      <div className="flex items-center gap-3 pt-4 border-t border-rule">
        <Button
          type="submit"
          variant="ink"
          size="sm"
          disabled={!dirty || hasErrors || saveMut.isPending}
        >
          {saveMut.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!dirty || saveMut.isPending}
          onClick={() => setDraft({ ...cfgQ.data.config })}
        >
          Discard
        </Button>
        {savedFlash ? <Tag tone="success">saved</Tag> : null}
        {saveMut.isError ? (
          <span className="text-meta text-severity-must">
            {saveMut.error instanceof ApiError ? saveMut.error.message : 'Save failed'}
          </span>
        ) : null}
      </div>
    </form>
  )
}
