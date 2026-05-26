import { createHash } from 'node:crypto'

import { serializeSource, type SessionSource } from '../../shared/source'

// Short, stable identifier derived from the canonical serialization.
// Used as the value for `pr_sessions.source_hash` so we can enforce an
// active-session dedup constraint that works across all source kinds.
// 16 hex chars (64 bits) is well past the birthday-collision threshold
// for any reasonable per-user session count.
export function sourceHash(source: SessionSource): string {
  return createHash('sha256').update(serializeSource(source)).digest('hex').slice(0, 16)
}
