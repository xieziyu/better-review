import {
  reviewSummaryFromAgentSchema,
  type ReviewSummaryFromAgent,
} from '../../shared/summary-schema'
import { parseJsonWithSchema, type JsonParseResult } from './json-file'

export type SummaryParseResult = JsonParseResult<ReviewSummaryFromAgent>

/**
 * Parse + validate the agent's `summary.json`. Unlike findings (an array that
 * is appended to and deduped), the summary is a single object — the watcher
 * just takes the latest valid parse, so there is no dedupe here.
 */
export function parseSummary(raw: string): SummaryParseResult {
  return parseJsonWithSchema(reviewSummaryFromAgentSchema, raw)
}
