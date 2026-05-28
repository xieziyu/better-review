import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui'

interface Props {
  file: string
  start: number
  end: number
  rangeValid: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Compact one-line bar shown while the user is selecting a line range, before
 * the full AddFindingForm expands. Keeps the diff from being pushed down so
 * shift-clicking another + remains within reach. */
export function PendingSelectionBar({ file, start, end, rangeValid, onConfirm, onCancel }: Props) {
  const { t } = useTranslation()
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    confirmRef.current?.focus()
  }, [])

  const isRange = start < end
  const loc = isRange ? `${start}-${end}` : `${start}`

  return (
    <div
      className="flex items-center gap-3 mx-2 my-1 px-3 py-1.5 bg-raised border border-rule rounded-md"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
    >
      <span className="font-mono text-meta text-ink-secondary">
        {file}:{loc}
      </span>
      <span className="text-meta text-ink-muted">{t('filesChanged.pendingSelection.hint')}</span>
      {!rangeValid ? (
        <span className="text-meta text-[color:var(--severity-must)]">
          {t('filesChanged.addFinding.rangeInvalid')}
        </span>
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          ref={confirmRef}
          variant="primary"
          size="sm"
          onClick={onConfirm}
          disabled={!rangeValid}
        >
          {t('filesChanged.pendingSelection.confirm')}
        </Button>
      </div>
    </div>
  )
}
