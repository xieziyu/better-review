import type { AppConfig, DiffViewMode } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import { api, queryKeys } from './api'

export type { DiffViewMode } from '@shared/types'

const DEFAULT_MODE: DiffViewMode = 'unified'

export interface UseDiffViewModeResult {
  mode: DiffViewMode
  setMode: (mode: DiffViewMode) => void
}

type ConfigQueryData = { config: AppConfig; file: string }

/**
 * Globally persisted unified/split preference for the Files Changed diff.
 *
 * Backed by the server-side `config.json` (not browser localStorage): the
 * daemon binds a fresh ephemeral port on each restart, which changes the
 * browser origin and would wipe per-origin localStorage. Persisting through
 * the config API keeps the reviewer's preferred layout across restarts and
 * across PRs, mirroring how `language` is stored.
 */
export function useDiffViewMode(): UseDiffViewModeResult {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: queryKeys.config, queryFn: api.getConfig })
  const mode = data?.config.diffViewMode ?? DEFAULT_MODE

  const mutation = useMutation({
    mutationFn: (next: DiffViewMode) => {
      const current = qc.getQueryData<ConfigQueryData>(queryKeys.config)
      if (!current) throw new Error('config not loaded')
      return api.putConfig({ ...current.config, diffViewMode: next })
    },
    // Optimistically flip the cached config so the toggle responds instantly,
    // before the localhost round-trip resolves.
    onMutate: (next: DiffViewMode) => {
      const prev = qc.getQueryData<ConfigQueryData>(queryKeys.config)
      if (prev) {
        qc.setQueryData<ConfigQueryData>(queryKeys.config, {
          ...prev,
          config: { ...prev.config, diffViewMode: next },
        })
      }
      return { prev }
    },
    onError: (_err, _next, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.config, ctx.prev)
    },
    onSuccess: ({ config }) => {
      const current = qc.getQueryData<ConfigQueryData>(queryKeys.config)
      qc.setQueryData<ConfigQueryData>(queryKeys.config, {
        config,
        file: current?.file ?? '',
      })
    },
  })

  const setMode = useCallback(
    (next: DiffViewMode) => {
      if (next === mode) return
      mutation.mutate(next)
    },
    [mode, mutation],
  )

  return { mode, setMode }
}
