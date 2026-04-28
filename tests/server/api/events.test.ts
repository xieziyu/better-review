import { describe, it, expect } from 'vitest'

import { createApp } from '../../../src/server/api/app'
import { makeTestDeps } from './_deps'

async function readChunk(res: Response, timeoutMs = 1000): Promise<string> {
  const reader = res.body!.getReader()
  const t = setTimeout(() => reader.cancel(), timeoutMs)
  const { value, done } = await reader.read()
  clearTimeout(t)
  if (done || !value) throw new Error('no data received')
  return new TextDecoder().decode(value)
}

describe('SSE', () => {
  it('GET /api/events streams emitted events', async () => {
    const d = makeTestDeps()
    const app = createApp(d)
    const res = await app.request('/api/events')
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    setTimeout(() => d.bus.emit({ type: 'done', sessionId: 's1' }), 20)
    const text = await readChunk(res)
    expect(text).toContain('data:')
    expect(text).toContain('"done"')
  })

  it('GET /api/sessions/:id/events streams session-scoped events', async () => {
    const d = makeTestDeps()
    const app = createApp(d)
    const res = await app.request('/api/sessions/s1/events')
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    setTimeout(() => {
      d.bus.emit({ type: 'done', sessionId: 'other' })
      d.bus.emit({ type: 'done', sessionId: 's1' })
    }, 20)
    const text = await readChunk(res)
    expect(text).toContain('"sessionId":"s1"')
    expect(text).not.toContain('"sessionId":"other"')
  })
})
