import { findingSchema, type FindingFromAgent } from '../../shared/findings-schema'

export type SkippedFinding = { index: number; error: string }

// `ok: false` is reserved for failures that invalidate the whole file (broken
// JSON, top-level not an array). A structurally valid array always yields
// `ok: true`: each element is validated independently, valid findings land in
// `data`, and malformed ones are collected in `skipped` rather than dropping
// the entire batch. This keeps one bad entry (e.g. an agent that wrote a field
// type we don't accept) from silently hiding every other finding.
export type ParseResult =
  | { ok: true; data: FindingFromAgent[]; skipped: SkippedFinding[] }
  | { ok: false; error: string }

export function parseFindings(raw: string): ParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return { ok: false, error: `JSON parse error: ${(e as Error).message}` }
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'expected a JSON array of findings' }
  }
  const data: FindingFromAgent[] = []
  const skipped: SkippedFinding[] = []
  parsed.forEach((entry, index) => {
    const result = findingSchema.safeParse(entry)
    if (result.success) {
      data.push(result.data)
    } else {
      const first = result.error.issues[0]
      skipped.push({
        index,
        error: `${first?.path.join('.') ?? '$'}: ${first?.message ?? 'invalid'}`,
      })
    }
  })
  return { ok: true, data, skipped }
}
