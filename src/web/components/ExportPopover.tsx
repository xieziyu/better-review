import {
  buildExportFilename,
  type ExportInput,
  renderFindingsJson,
  renderFindingsMarkdown,
} from '@shared/export-renderer'
import { sortByPriority } from '@shared/findings-sort'
import type { Finding, PRSession } from '@shared/types'
import { Check, ChevronDown, Copy, Download } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui'
import { copyTextToClipboard, downloadTextFile } from '@/lib/export-clipboard'
import { cn } from '@/lib/utils'

type Format = 'md' | 'json'
type Scope = 'selected' | 'all'

interface Props {
  session: PRSession
  // All non-archived findings. The popover derives the selected subset and
  // the totals from this list; it does not refetch.
  findings: Finding[]
  // 1-based round number for the current session, computed once by PRDetail
  // so the export header agrees with the toolbar's "Round N" tag.
  roundNumber: number
}

const STORAGE_PREFIX = 'better-review:export-prefs:'

interface Prefs {
  scope: Scope
  format: Format
}

const DEFAULT_PREFS: Prefs = { scope: 'selected', format: 'md' }

function loadPrefs(sessionId: string): Prefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + sessionId)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<Prefs>
    return {
      scope: parsed.scope === 'all' ? 'all' : 'selected',
      format: parsed.format === 'json' ? 'json' : 'md',
    }
  } catch {
    return DEFAULT_PREFS
  }
}

function savePrefs(sessionId: string, prefs: Prefs): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_PREFIX + sessionId, JSON.stringify(prefs))
  } catch {
    // Quota or disabled storage — ignore. Worst case: prefs don't persist.
  }
}

export function ExportPopover({ session, findings, roundNumber }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs(session.id))
  const [copied, setCopied] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Re-load prefs when navigating between sessions; the popover is mounted
  // for the lifetime of PRDetail so the session id can change beneath it.
  useEffect(() => {
    setPrefs(loadPrefs(session.id))
    setCopied(false)
    setOpen(false)
  }, [session.id])

  // Persist whenever scope/format changes.
  useEffect(() => {
    savePrefs(session.id, prefs)
  }, [prefs, session.id])

  // Clear "copied" state if the user changes what would be copied; keeps
  // the confirmation honest about which content was on the clipboard.
  const resetCopiedSoon = useCallback(() => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
  }, [])
  useEffect(() => {
    setCopied(false)
    if (copiedTimer.current) {
      clearTimeout(copiedTimer.current)
      copiedTimer.current = null
    }
  }, [prefs])
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    },
    [],
  )

  const selectedCount = useMemo(() => findings.filter((f) => f.selected).length, [findings])
  const totalCount = findings.length

  // Force scope=all when nothing is selected. The popover never offers an
  // empty export — the user gets a meaningful artifact regardless.
  const effectiveScope: Scope = selectedCount === 0 ? 'all' : prefs.scope

  const displayedFindings = useMemo(() => {
    const subset = effectiveScope === 'selected' ? findings.filter((f) => f.selected) : findings
    return [...subset].sort(sortByPriority)
  }, [findings, effectiveScope])

  const severityCounts = useMemo(() => {
    const c = { must: 0, should: 0, nit: 0 }
    for (const f of displayedFindings) c[f.severity]++
    return c
  }, [displayedFindings])

  const filename = useMemo(
    () => buildExportFilename(session.number, effectiveScope, prefs.format),
    [session.number, effectiveScope, prefs.format],
  )

  const buildInput = useCallback((): ExportInput => {
    return {
      pr: {
        owner: session.owner,
        repo: session.repo,
        number: session.number,
        title: session.title,
        url: session.url,
      },
      session: {
        roundNumber,
        agent: session.agent,
        exportedAt: new Date().toISOString(),
      },
      totalFindings: totalCount,
      scope: effectiveScope,
      findings: displayedFindings,
    }
  }, [session, roundNumber, totalCount, effectiveScope, displayedFindings])

  const renderText = useCallback(
    (input: ExportInput): { text: string; mime: string } => {
      return prefs.format === 'md'
        ? { text: renderFindingsMarkdown(input), mime: 'text/markdown' }
        : { text: renderFindingsJson(input), mime: 'application/json' }
    },
    [prefs.format],
  )

  const onCopy = async () => {
    resetCopiedSoon()
    const { text } = renderText(buildInput())
    try {
      await copyTextToClipboard(text)
      setCopied(true)
      copiedTimer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      // Stay silent in the UI for the rare failure; an inline error here
      // would crowd the popover and the user can still try Download.
      setCopied(false)
    }
  }

  const onDownload = () => {
    const { text, mime } = renderText(buildInput())
    downloadTextFile(filename, mime, text)
  }

  // ⌘E / Ctrl+E toggles the popover. Stay narrow on modifiers so we
  // don't collide with browser shortcuts like ⌘⇧E.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.shiftKey || e.altKey) return
      if (e.key !== 'e' && e.key !== 'E') return
      // Don't fire while the user is typing in a field.
      const tgt = e.target as HTMLElement | null
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) {
        return
      }
      e.preventDefault()
      setOpen((o) => !o)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Click-outside + Esc close the popover.
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

  const exportCount = displayedFindings.length

  return (
    <div ref={wrapRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={t('prdetail.export.triggerTitle')}
      >
        <Download size={12} aria-hidden="true" />
        {t('prdetail.export.trigger')}
        <ChevronDown size={12} aria-hidden="true" className="text-ink-muted" />
      </Button>
      {open ? (
        <div
          role="dialog"
          aria-label={t('prdetail.export.dialogAria')}
          className="absolute right-0 top-[calc(100%+8px)] z-30 w-80 rounded-lg border border-rule bg-main shadow-[0_8px_30px_-12px_color-mix(in_oklch,var(--ink-primary)_30%,transparent)]"
        >
          <section className="px-4 py-3.5">
            <p className="mb-2 text-caps tracking-caps uppercase text-ink-muted">
              {t('prdetail.export.scopeLabel')}
            </p>
            <div className="flex gap-1 rounded-md border border-rule bg-sunken p-0.5">
              <ScopeButton
                pressed={effectiveScope === 'selected'}
                disabled={selectedCount === 0}
                onClick={() => setPrefs((p) => ({ ...p, scope: 'selected' }))}
              >
                {t('prdetail.export.scopeSelected', { count: selectedCount })}
              </ScopeButton>
              <ScopeButton
                pressed={effectiveScope === 'all'}
                onClick={() => setPrefs((p) => ({ ...p, scope: 'all' }))}
              >
                {t('prdetail.export.scopeAll', { count: totalCount })}
              </ScopeButton>
            </div>
            <div className="mt-2 flex justify-between text-meta text-ink-muted tabular-nums">
              <SeverityPill kind="must" count={severityCounts.must} />
              <SeverityPill kind="should" count={severityCounts.should} />
              <SeverityPill kind="nit" count={severityCounts.nit} />
            </div>
          </section>
          <section className="border-t border-rule px-4 py-3.5">
            <p className="mb-2 text-caps tracking-caps uppercase text-ink-muted">
              {t('prdetail.export.formatLabel')}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <FormatCard
                pressed={prefs.format === 'md'}
                name={t('prdetail.export.formatMarkdown')}
                desc={t('prdetail.export.formatMarkdownDesc')}
                onClick={() => setPrefs((p) => ({ ...p, format: 'md' }))}
              />
              <FormatCard
                pressed={prefs.format === 'json'}
                name={t('prdetail.export.formatJson')}
                desc={t('prdetail.export.formatJsonDesc')}
                onClick={() => setPrefs((p) => ({ ...p, format: 'json' }))}
              />
            </div>
          </section>
          <section className="border-t border-rule px-4 py-3.5">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="ghost"
                size="md"
                onClick={onCopy}
                disabled={exportCount === 0}
              >
                {copied ? (
                  <>
                    <Check size={13} aria-hidden="true" className="text-accent-ready" />
                    {t('prdetail.export.copied')}
                  </>
                ) : (
                  <>
                    <Copy size={13} aria-hidden="true" />
                    {t('prdetail.export.copy')}
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={onDownload}
                disabled={exportCount === 0}
              >
                <Download size={13} aria-hidden="true" />
                {t('prdetail.export.download')}
              </Button>
            </div>
          </section>
          <div className="flex items-center justify-between gap-2 border-t border-rule bg-sunken px-4 py-2 text-[11px] text-ink-muted">
            <span className="truncate font-mono">{filename}</span>
            <span className="shrink-0">
              <kbd className="rounded-sm border border-rule bg-main px-1 py-[1px] font-mono text-[10px] text-ink-secondary">
                ⌘E
              </kbd>{' '}
              {t('prdetail.export.shortcutHint')}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ScopeButton({
  pressed,
  disabled,
  onClick,
  children,
}: {
  pressed: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex-1 rounded px-2 py-1 text-meta font-semibold transition-colors duration-180 ease-out-quart',
        pressed
          ? 'bg-main text-ink-primary shadow-[0_1px_2px_color-mix(in_oklch,var(--ink-primary)_8%,transparent)]'
          : 'text-ink-secondary hover:text-ink-primary',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      {children}
    </button>
  )
}

function FormatCard({
  pressed,
  name,
  desc,
  onClick,
}: {
  pressed: boolean
  name: string
  desc: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={name}
      onClick={onClick}
      className={cn(
        'rounded-md border px-2.5 py-2 text-left transition-[border-color,background-color] duration-180 ease-out-quart',
        pressed
          ? 'border-brand bg-[color:color-mix(in_oklch,var(--brand)_8%,transparent)]'
          : 'border-rule hover:border-ink-muted',
      )}
    >
      <div className="text-body font-semibold text-ink-primary">{name}</div>
      <div className="mt-0.5 text-[11px] leading-[15px] text-ink-muted">{desc}</div>
    </button>
  )
}

const SEVERITY_DOT_CLASS: Record<'must' | 'should' | 'nit', string> = {
  must: 'bg-severity-must',
  should: 'bg-severity-should',
  nit: 'bg-severity-nit',
}

function SeverityPill({ kind, count }: { kind: 'must' | 'should' | 'nit'; count: number }) {
  const { t } = useTranslation()
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn('inline-block size-1.5 rounded-full', SEVERITY_DOT_CLASS[kind])} />
      {t(`prdetail.export.severityCount.${kind}`, { count })}
    </span>
  )
}
