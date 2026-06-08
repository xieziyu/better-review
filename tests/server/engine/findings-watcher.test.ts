import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect } from 'vitest'

import type { ParseResult } from '../../../src/server/engine/findings-parser'
import { watchFindings } from '../../../src/server/engine/findings-watcher'
import type { FindingFromAgent } from '../../../src/shared/findings-schema'

// chokidar's detection latency (plus the 100ms awaitWriteFinish window) is
// non-deterministic under full-suite load, so poll for the callback instead of
// sleeping a fixed amount and hoping the event already fired.
async function waitUntil(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!pred()) {
    if (Date.now() > deadline) return
    await new Promise((res) => setTimeout(res, 20))
  }
}

describe('watchFindings', () => {
  it('invokes onParsed when valid JSON appears', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'br-watch-'))
    const file = join(dir, 'findings.json')
    const seen: FindingFromAgent[][] = []
    const close = await watchFindings(file, (r: ParseResult) => {
      if (r.ok) seen.push(r.data)
    })
    writeFileSync(
      file,
      JSON.stringify([
        {
          id: 'R1',
          severity: 'must',
          category: 'x',
          file: null,
          line: null,
          title: 't',
          body: 'b',
        },
      ]),
    )
    await waitUntil(() => seen.length >= 1)
    await close()
    expect(seen.length).toBeGreaterThanOrEqual(1)
    expect(seen[0]![0]!.id).toBe('R1')
  })

  it('invokes onParsed with error result when JSON is invalid', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'br-watch-'))
    const file = join(dir, 'findings.json')
    const errs: string[] = []
    const close = await watchFindings(file, (r: ParseResult) => {
      if (!r.ok) errs.push(r.error)
    })
    writeFileSync(file, 'BROKEN')
    await waitUntil(() => errs.length >= 1)
    await close()
    expect(errs.length).toBeGreaterThanOrEqual(1)
  })
})
