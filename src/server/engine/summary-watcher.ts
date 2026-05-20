import { readFileSync } from 'node:fs'

import chokidar from 'chokidar'

import { parseSummary, type SummaryParseResult } from './summary-parser'

/**
 * Watch `<workdir>/summary.json` and report each parse to `onParsed`. Mirrors
 * `watchFindings`; the agent typically writes this file once near the end of
 * the run, so callers just keep the latest successful parse.
 */
export async function watchSummary(
  file: string,
  onParsed: (r: SummaryParseResult) => void,
): Promise<() => Promise<void>> {
  const watcher = chokidar.watch(file, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  })
  const handle = () => {
    try {
      const raw = readFileSync(file, 'utf8')
      onParsed(parseSummary(raw))
    } catch (e) {
      onParsed({ ok: false, error: `read error: ${(e as Error).message}` })
    }
  }
  watcher.on('add', handle)
  watcher.on('change', handle)
  await new Promise<void>((res) => watcher.on('ready', () => res()))
  return async () => {
    await watcher.close()
  }
}
