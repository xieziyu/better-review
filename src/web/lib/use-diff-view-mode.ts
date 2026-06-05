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

  // Last server-confirmed diffViewMode — the baseline a failed toggle rolls back
  // to. This must NOT be a prior optimistic cache snapshot: two toggles that both
  // fail (split then unified) would otherwise leave the UI on the un-persisted
  // `split` from the first toggle's snapshot while disk still holds `unified`.
  // Seed it from the server value only while no toggle is in flight — once a
  // mutation fires, the query cache is optimistic and no longer authoritative;
  // from then on onSuccess advances this baseline from the server's response.
  const confirmedMode = useRef<DiffViewMode | undefined>(undefined)
  if (latestRequest.current === 0 && data) {
    confirmedMode.current = data.config.diffViewMode
  }

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
    onMutate: async ({ mode: next }: MutationVars) => {
      // Cancel any config GET already in flight first. On cold start the toggle
      // can be clicked while the initial `/api/config` GET is still reading the
      // OLD value off disk; without this it could resolve last and overwrite the
      // value this PATCH just persisted — leaving the UI on a stale layout until
      // the next refetch. cancelQueries makes React Query discard that GET's
      // result so onSuccess's write wins.
      await qc.cancelQueries({ queryKey: queryKeys.config })
      qc.setQueryData<ConfigQueryData>(queryKeys.config, (curr) =>
        curr ? { ...curr, config: { ...curr.config, diffViewMode: next } } : curr,
      )
    },
    onError: (_err, vars) => {
      // A stale request must not roll back over a newer selection.
      if (vars.id !== latestRequest.current) return
      const baseline = confirmedMode.current
      if (baseline === undefined) {
        // Cold start: the toggle fired before the initial config GET resolved,
        // and onMutate cancelled that GET. With no server-confirmed baseline to
        // roll back to and the PATCH now failed, the cache is still empty — the
        // UI would sit on the local default while disk holds the other value
        // until some incidental refetch. Refetch the server truth so it recovers
        // immediately instead.
        void qc.invalidateQueries({ queryKey: queryKeys.config })
        return
      }
      // Roll back to the last server-confirmed value — not a prior optimistic
      // snapshot — and only our own field, never the whole snapshot, which could
      // revert a field another control changed while this request was in flight.
      qc.setQueryData<ConfigQueryData>(queryKeys.config, (curr) =>
        curr ? { ...curr, config: { ...curr.config, diffViewMode: baseline } } : curr,
      )
    },
    onSuccess: ({ config }, vars) => {
      // Every settled PATCH — even a superseded one — reports the server's true
      // value, so always advance the rollback baseline. (Writes are serialized by
      // scope, so the latest request's response lands last and wins here.)
      confirmedMode.current = config.diffViewMode
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
    onSettled: (_data, _error, vars: MutationVars) => {
      // Once the newest toggle settles there's nothing left in flight, so clear
      // the "request pending" marker. This re-arms the baseline re-seed above
      // (gated on `latestRequest.current === 0`): a later config refetch — window
      // refocus, cross-tab save, manual refetch — can then refresh `confirmedMode`
      // to the server's current value instead of leaving a failed toggle to roll
      // back to a stale baseline. A superseded request leaves the marker alone.
      if (vars.id === latestRequest.current) {
        latestRequest.current = 0
      }
    },
  })

  const setMode = useCallback(
    (next: DiffViewMode) => {
      // Short-circuit only against the *known* server value, and only while no
      // toggle is pending. `mode` falls back to the local default before the
      // config query resolves, so comparing to it would silently drop a click
      // that matches the default while the persisted value is the other mode.
      // The `latestRequest.current === 0` gate matters too: with a toggle in
      // flight, `data` still holds the pre-toggle server value (the optimistic
      // write is async and hasn't re-rendered this closure yet), so without the
      // gate a fast split→unified would treat the second click as a no-op and
      // drop the reviewer's final selection while the first PATCH still lands.
      if (latestRequest.current === 0 && data?.config.diffViewMode === next) return
      const id = (latestRequest.current += 1)
      mutation.mutate({ mode: next, id })
    },
    [data?.config.diffViewMode, mutation],
  )

  return { mode, setMode }
}
