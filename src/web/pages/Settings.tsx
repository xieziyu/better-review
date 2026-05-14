import { AGENT_KINDS, LANGUAGES, type AppConfig, type Language } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { Button, Field, NumberInput, Select, Tag } from '@/components/ui'
import { ApiError, api, queryKeys } from '@/lib/api'

interface FieldErrors {
  port?: string
  maxConcurrentReviews?: string
  stallMinutes?: string
  perPRGCDays?: string
}

function validate(
  draft: AppConfig | null,
  message: (min: number, max: number) => string,
): FieldErrors {
  const errors: FieldErrors = {}
  if (!draft) return errors
  if (!Number.isInteger(draft.port) || draft.port < 0 || draft.port > 65535) {
    errors.port = message(0, 65535)
  }
  if (
    !Number.isInteger(draft.maxConcurrentReviews) ||
    draft.maxConcurrentReviews < 1 ||
    draft.maxConcurrentReviews > 16
  ) {
    errors.maxConcurrentReviews = message(1, 16)
  }
  if (!Number.isInteger(draft.stallMinutes) || draft.stallMinutes < 1 || draft.stallMinutes > 60) {
    errors.stallMinutes = message(1, 60)
  }
  if (!Number.isInteger(draft.perPRGCDays) || draft.perPRGCDays < 0 || draft.perPRGCDays > 365) {
    errors.perPRGCDays = message(0, 365)
  }
  return errors
}

function isDirty(server: AppConfig, draft: AppConfig): boolean {
  return (
    server.port !== draft.port ||
    server.maxConcurrentReviews !== draft.maxConcurrentReviews ||
    server.stallMinutes !== draft.stallMinutes ||
    server.defaultAgent !== draft.defaultAgent ||
    server.perPRGCDays !== draft.perPRGCDays ||
    server.language !== draft.language
  )
}

export function Settings() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const cfgQ = useQuery({ queryKey: queryKeys.config, queryFn: api.getConfig })
  const healthQ = useQuery({ queryKey: queryKeys.health, queryFn: api.health })

  const [draft, setDraft] = useState<AppConfig | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    if (cfgQ.data && draft === null) setDraft({ ...cfgQ.data.config })
  }, [cfgQ.data, draft])

  // Keep the form's `language` in lockstep with the server config so the
  // top-bar LanguageSwitcher (which writes through the same query cache) is
  // reflected immediately in this page's Select. Other fields stay local-only
  // so unsaved numeric edits aren't clobbered.
  const serverLanguage = cfgQ.data?.config.language
  useEffect(() => {
    if (!serverLanguage) return
    setDraft((prev) => {
      if (!prev || prev.language === serverLanguage) return prev
      return { ...prev, language: serverLanguage }
    })
  }, [serverLanguage])

  const dirty = useMemo(() => {
    if (!cfgQ.data || !draft) return false
    return isDirty(cfgQ.data.config, draft)
  }, [cfgQ.data, draft])

  const validationMessage = useMemo(
    () => (min: number, max: number) => t('settings.validation.intBetween', { min, max }),
    [t],
  )
  const errors = useMemo(() => validate(draft, validationMessage), [draft, validationMessage])
  const hasErrors = Object.values(errors).some(Boolean)

  const saveMut = useMutation({
    mutationFn: (next: AppConfig) => api.putConfig(next),
    onSuccess: ({ config }) => {
      qc.setQueryData(queryKeys.config, { config, file: cfgQ.data?.file ?? '' })
      void qc.invalidateQueries({ queryKey: queryKeys.health })
      void qc.invalidateQueries({ queryKey: queryKeys.promptsBase })
      setDraft({ ...config })
      setSavedFlash(true)
      window.setTimeout(() => setSavedFlash(false), 2000)
    },
  })

  if (!cfgQ.data || !draft) {
    return (
      <div
        className="px-8 py-10 mx-auto max-w-2xl space-y-6"
        aria-label={t('settings.loadingAriaLabel')}
      >
        <div className="text-caps tracking-caps text-ink-muted uppercase">{t('app.loading')}</div>
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
        <div className="text-caps tracking-caps text-ink-muted uppercase mb-2">
          {t('settings.eyebrow')}
        </div>
        <h1 className="text-display text-ink-primary">{t('settings.title')}</h1>
        <p className="mt-3 text-body text-ink-secondary">
          {t('settings.storedAt')}{' '}
          <code className="font-mono text-code text-ink-primary bg-sunken px-1 py-0.5 rounded-sm">
            {cfgQ.data.file}
          </code>
          .{' '}
          <Trans
            i18nKey="settings.intro"
            components={[
              <code key="port" className="font-mono text-code" />,
              <code key="mcr" className="font-mono text-code" />,
            ]}
          />
        </p>
      </header>

      <section className="space-y-6">
        <Field
          label={t('settings.language.label')}
          htmlFor="cfg-language"
          hint={t('settings.language.hint')}
        >
          <Select
            id="cfg-language"
            value={draft.language}
            onChange={(e) => set('language', e.currentTarget.value as Language)}
          >
            {LANGUAGES.map((lng) => (
              <option key={lng} value={lng}>
                {t(`settings.language.options.${lng}`)}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={t('settings.defaultAgent.label')}
          htmlFor="cfg-defaultAgent"
          hint={t('settings.defaultAgent.hint')}
          trail={
            agentHealth
              ? AGENT_KINDS.map((k) =>
                  agentHealth[k].found ? (
                    <Tag key={k} tone="success">
                      {t('settings.defaultAgent.found', { kind: k })}
                    </Tag>
                  ) : (
                    <Tag key={k} tone="danger">
                      {t('settings.defaultAgent.missing', { kind: k })}
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
          label={t('settings.stallMinutes.label')}
          htmlFor="cfg-stallMinutes"
          hint={t('settings.stallMinutes.hint')}
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
          label={t('settings.perPRGCDays.label')}
          htmlFor="cfg-perPRGCDays"
          hint={t('settings.perPRGCDays.hint')}
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
          label={t('settings.maxConcurrentReviews.label')}
          htmlFor="cfg-maxConcurrentReviews"
          hint={t('settings.maxConcurrentReviews.hint')}
          trail={<Tag tone="warning">{t('settings.restartRequired')}</Tag>}
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
          label={t('settings.port.label')}
          htmlFor="cfg-port"
          hint={t('settings.port.hint')}
          trail={<Tag tone="warning">{t('settings.restartRequired')}</Tag>}
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
          variant="primary"
          size="sm"
          disabled={!dirty || hasErrors || saveMut.isPending}
        >
          {saveMut.isPending ? t('common.saving') : t('common.save')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!dirty || saveMut.isPending}
          onClick={() => setDraft({ ...cfgQ.data.config })}
        >
          {t('common.discard')}
        </Button>
        {savedFlash ? <Tag tone="success">{t('common.saved')}</Tag> : null}
        {saveMut.isError ? (
          <span className="text-meta text-severity-must">
            {saveMut.error instanceof ApiError ? saveMut.error.message : t('common.saveFailed')}
          </span>
        ) : null}
      </div>
    </form>
  )
}
