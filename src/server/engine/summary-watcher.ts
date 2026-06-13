import { watchParsedJson } from './json-file'
import { parseSummary, type SummaryParseResult } from './summary-parser'

/**
 * Watch `<workdir>/summary.json` and report each parse to `onParsed`. Mirrors
 * `watchFindings`; the agent typically writes this file once near the end of
 * the run, so callers just keep the latest successful parse.
 */
export function watchSummary(
  file: string,
  onParsed: (r: SummaryParseResult) => void,
): Promise<() => Promise<void>> {
  return watchParsedJson(file, parseSummary, onParsed)
}
