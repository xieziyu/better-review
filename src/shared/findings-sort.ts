import type { Severity } from './findings-schema'
import type { Finding } from './types'

// Display order for severity badges: highest priority first. Kept in
// sync with the visual order shown in FindingList and the order the
// export renderer groups findings by.
export const SEVERITY_ORDER: Record<Severity, number> = { must: 0, should: 1, nit: 2 }

// Comparator used by both FindingList and the export renderer so the two
// surfaces stay aligned: severity → filename (locale-aware) → ord.
export function sortByPriority(a: Finding, b: Finding): number {
  const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  if (sevDiff !== 0) return sevDiff
  const fileA = a.file ?? ''
  const fileB = b.file ?? ''
  if (fileA !== fileB) return fileA.localeCompare(fileB)
  return a.ord - b.ord
}
