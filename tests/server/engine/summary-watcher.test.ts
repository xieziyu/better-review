import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect } from 'vitest'

import type { SummaryParseResult } from '../../../src/server/engine/summary-parser'
import { watchSummary } from '../../../src/server/engine/summary-watcher'
import type { ReviewSummaryFromAgent } from '../../../src/shared/summary-schema'

// Poll until `cond` is true or the deadline passes — avoids a fixed sleep that
// is racy on a loaded machine (chokidar's awaitWriteFinish adds latency).
async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!cond() && Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 25))
  }
}

describe('watchSummary', () => {
  it('invokes onParsed when valid JSON appears', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'br-sum-watch-'))
    const file = join(dir, 'summary.json')
    const seen: ReviewSummaryFromAgent[] = []
    const close = await watchSummary(file, (r: SummaryParseResult) => {
      if (r.ok) seen.push(r.data)
    })
    writeFileSync(file, JSON.stringify({ overview: 'a summary', manualReview: [] }))
    await waitFor(() => seen.length >= 1)
    await close()
    expect(seen.length).toBeGreaterThanOrEqual(1)
    expect(seen[0]!.overview).toBe('a summary')
  })

  it('invokes onParsed with error result when JSON is invalid', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'br-sum-watch-'))
    const file = join(dir, 'summary.json')
    const errs: string[] = []
    const close = await watchSummary(file, (r: SummaryParseResult) => {
      if (!r.ok) errs.push(r.error)
    })
    writeFileSync(file, 'BROKEN')
    await waitFor(() => errs.length >= 1)
    await close()
    expect(errs.length).toBeGreaterThanOrEqual(1)
  })
})
