import {
  reviewSummaryFromAgentSchema,
  type ReviewSummaryFromAgent,
} from '../../shared/summary-schema'

export type SummaryParseResult =
  | { ok: true; data: ReviewSummaryFromAgent }
  | { ok: false; error: string }

/**
 * Parse + validate the agent's `summary.json`. Unlike findings (an array that
 * is appended to and deduped), the summary is a single object — the watcher
 * just takes the latest valid parse, so there is no dedupe here.
 */
export function parseSummary(raw: string): SummaryParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return { ok: false, error: `JSON parse error: ${(e as Error).message}` }
  }
  const result = reviewSummaryFromAgentSchema.safeParse(parsed)
  if (!result.success) {
    const first = result.error.issues[0]
    return {
      ok: false,
      error: `${first?.path.join('.') ?? '$'}: ${first?.message ?? 'invalid'}`,
    }
  }
  return { ok: true, data: result.data }
}
