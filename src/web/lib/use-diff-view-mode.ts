import type { AppConfig, DiffViewMode } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'

import { api, queryKeys } from './api'

export type { DiffViewMode } from '@shared/types'

const DEFAULT_MODE: DiffViewMode = 'unified'

export interface UseDiffViewModeResult {
  mode: DiffViewMode
  setMode: (mode: DiffViewMode) => void
}

type ConfigQueryData = { config: AppConfig; file: string }

interface MutationVars {
  mode: DiffViewMode
  id: number
}

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

  // Monotonic id of the most recent toggle. Rapid clicks fire overlapping PUTs;
  // only the newest one is allowed to write the cache, so a slower earlier
  // request can't resolve last and clobber the reviewer's final selection.
  const latestRequest = useRef(0)

  const mutation = useMutation({
    // Serialize writes to this preference: a scoped mutation runs only after the
    // previous one with the same id settles. Without this the two PUTs race on
    // the server too, and whichever lands on disk last wins — so a stale earlier
    // request could persist the wrong layout even though the cache looks right.
    scope: { id: 'diff-view-mode' },
    // Send only the field this control owns. The server merges it, so a
    // concurrent write from another control (e.g. the language switcher) can't
    // be clobbered — and we don't need the full config to be loaded first, so a
    // toggle clicked before the config query resolves still persists.
    mutationFn: ({ mode: next }: MutationVars) => api.patchConfig({ diffViewMode: next }),
    // Optimistically flip the cached config so the toggle responds instantly,
    // before the localhost round-trip resolves.
    onMutate: ({ mode: next }: MutationVars) => {
      const prev = qc.getQueryData<ConfigQueryData>(queryKeys.config)
      if (prev) {
        qc.setQueryData<ConfigQueryData>(queryKeys.config, {
          ...prev,
          config: { ...prev.config, diffViewMode: next },
        })
      }
      return { prev }
    },
    onError: (_err, vars, ctx) => {
      // A stale request must not roll back over a newer selection.
      if (vars.id !== latestRequest.current) return
      const prevMode = ctx?.prev?.config.diffViewMode
      if (prevMode === undefined) return
      // Roll back only our own field — never the whole snapshot, which could
      // revert a field another control changed while this request was in flight.
      qc.setQueryData<ConfigQueryData>(queryKeys.config, (curr) =>
        curr ? { ...curr, config: { ...curr.config, diffViewMode: prevMode } } : curr,
      )
    },
    onSuccess: ({ config }, vars) => {
      if (vars.id !== latestRequest.current) return
      // Write back only diffViewMode. The response is a full-config snapshot
      // from when the server processed this PATCH, so its other fields may be
      // stale relative to a concurrent write (e.g. the language switcher) that
      // already updated the cache — merging just our field avoids clobbering it.
      // When the cache is still empty (toggle clicked before the config query
      // resolved), seed it from the response so the choice is reflected.
      qc.setQueryData<ConfigQueryData>(queryKeys.config, (curr) =>
        curr
          ? { ...curr, config: { ...curr.config, diffViewMode: config.diffViewMode } }
          : { config, file: '' },
      )
    },
  })

  const setMode = useCallback(
    (next: DiffViewMode) => {
      // Short-circuit only against the *known* server value. `mode` falls back
      // to the local default before the config query resolves, so comparing to
      // it would silently drop a click that happens to match the default while
      // the persisted value is actually the other mode.
      if (data?.config.diffViewMode === next) return
      const id = (latestRequest.current += 1)
      mutation.mutate({ mode: next, id })
    },
    [data?.config.diffViewMode, mutation],
  )

  return { mode, setMode }
}
