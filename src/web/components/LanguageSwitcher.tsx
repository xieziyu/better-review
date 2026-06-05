import { LANGUAGES, type AppConfig, type Language } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Globe } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api, queryKeys } from '@/lib/api'
import { cn } from '@/lib/utils'

export function LanguageSwitcher() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: queryKeys.config, queryFn: api.getConfig })
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const change = useMutation({
    // Send only `language`; the server merges it so a concurrent write from
    // another control (e.g. the Files Changed layout toggle) isn't clobbered.
    mutationFn: (next: Language) => api.patchConfig({ language: next }),
    onSuccess: ({ config }) => {
      // Merge only `language` into the live cache. The response is a full
      // snapshot from this PATCH's merge point, so its other fields may trail a
      // concurrent write (e.g. the diff-layout toggle); writing them back would
      // clobber it.
      qc.setQueryData<{ config: AppConfig; file: string }>(queryKeys.config, (prev) =>
        prev
          ? { ...prev, config: { ...prev.config, language: config.language } }
          : { config, file: data?.file ?? '' },
      )
      void qc.invalidateQueries({ queryKey: queryKeys.health })
      void qc.invalidateQueries({ queryKey: queryKeys.promptsBase })
    },
  })

  const current = data?.config.language

  if (!data) return null

  const selectLang = (lng: Language) => {
    if (lng === current) {
      setOpen(false)
      return
    }
    setOpen(false)
    change.mutate(lng)
  }

  return (
    <div ref={wrapRef} className="relative inline-flex items-center">
      <button
        type="button"
        aria-label={t('app.languageSwitcher.buttonLabel')}
        title={t('app.languageSwitcher.buttonLabel')}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center justify-center size-7 rounded-md text-ink-secondary hover:bg-raised hover:text-ink-primary transition-colors duration-180 ease-out-quart focus:outline-none focus-visible:border focus-visible:border-brand"
      >
        <Globe size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={t('app.languageSwitcher.menuAriaLabel')}
          className="absolute left-[calc(100%+8px)] bottom-0 z-30 w-[10rem] rounded-md border border-rule bg-canvas py-1 text-left shadow-[0_8px_30px_-12px_color-mix(in_oklch,var(--ink-primary)_30%,transparent)]"
        >
          {LANGUAGES.map((lng) => {
            const selected = lng === current
            return (
              <button
                key={lng}
                role="menuitemradio"
                aria-checked={selected}
                type="button"
                onClick={() => selectLang(lng)}
                disabled={change.isPending}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-body transition-colors duration-180 ease-out-quart',
                  selected
                    ? 'text-ink-primary'
                    : 'text-ink-secondary hover:bg-raised hover:text-ink-primary',
                  change.isPending && 'cursor-progress opacity-60',
                )}
              >
                <span aria-hidden="true" className="inline-flex w-3 shrink-0 justify-center">
                  {selected ? <Check size={12} /> : null}
                </span>
                <span className="flex-1">{t(`settings.language.options.${lng}`)}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
