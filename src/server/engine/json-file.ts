// Shared machinery for the agent-output files (`findings.json`,
// `summary.json`): parse-with-zod-schema and watch-file-reparse-on-change.
// The domain modules (findings-parser/-watcher, summary-parser/-watcher)
// are thin bindings of these generics to their schema.

import { readFileSync } from 'node:fs'

import chokidar from 'chokidar'
import type { ZodType, ZodTypeDef } from 'zod'

export type JsonParseResult<T> = { ok: true; data: T } | { ok: false; error: string }

export function parseJsonWithSchema<T>(
  schema: ZodType<T, ZodTypeDef, unknown>,
  raw: string,
): JsonParseResult<T> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return { ok: false, error: `JSON parse error: ${(e as Error).message}` }
  }
  const result = schema.safeParse(parsed)
  if (!result.success) {
    const first = result.error.issues[0]
    return {
      ok: false,
      error: `${first?.path.join('.') ?? '$'}: ${first?.message ?? 'invalid'}`,
    }
  }
  return { ok: true, data: result.data }
}

// Watch `file` and report every (re)parse to `onParsed`. The agent may write
// the file incrementally, so `awaitWriteFinish` debounces until the contents
// stabilize. Returns an async closer.
//
// Generic over the whole result shape (not just `JsonParseResult<T>`) so
// callers can return richer success payloads (e.g. the findings parser's
// `{ ok: true; data; skipped }`); the only requirement is a `{ ok: false;
// error }` failure branch, which this helper also produces on read errors.
export async function watchParsedJson<R extends { ok: false; error: string } | { ok: true }>(
  file: string,
  parse: (raw: string) => R,
  onParsed: (r: R) => void,
): Promise<() => Promise<void>> {
  const watcher = chokidar.watch(file, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  })
  const handle = () => {
    try {
      const raw = readFileSync(file, 'utf8')
      onParsed(parse(raw))
    } catch (e) {
      onParsed({ ok: false, error: `read error: ${(e as Error).message}` } as R)
    }
  }
  watcher.on('add', handle)
  watcher.on('change', handle)
  await new Promise<void>((res) => watcher.on('ready', () => res()))
  return async () => {
    await watcher.close()
  }
}
