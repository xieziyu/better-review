import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, beforeEach } from 'vitest'

import { startDaemon } from '../../src/server/index'

describe('daemon lifecycle', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'br-d-'))
  })

  it('starts, writes server.json, shuts down cleanly', async () => {
    const h = await startDaemon({ home })
    expect(existsSync(join(home, 'server.json'))).toBe(true)
    expect(h.port).toBeGreaterThan(0)
    const meta = JSON.parse(readFileSync(join(home, 'server.json'), 'utf8'))
    expect(meta.pid).toBe(process.pid)
    expect(meta.port).toBe(h.port)
    await h.shutdown()
    expect(existsSync(join(home, 'server.json'))).toBe(false)
  })

  it('ignores stale server.json on next start (overwrites)', async () => {
    writeFileSync(join(home, 'server.json'), JSON.stringify({ pid: 999999, port: 1, startedAt: 0 }))
    const h = await startDaemon({ home })
    expect(h.port).toBeGreaterThan(0)
    const meta = JSON.parse(readFileSync(join(home, 'server.json'), 'utf8'))
    expect(meta.pid).toBe(process.pid)
    await h.shutdown()
  })

  it('serves /api/health from running daemon', async () => {
    const h = await startDaemon({ home })
    try {
      const res = await fetch(`http://127.0.0.1:${h.port}/api/health`)
      expect(res.status).toBe(200)
      const j = await res.json()
      expect(j.daemon.port).toBe(h.port)
      expect(j.daemon.pid).toBe(process.pid)
    } finally {
      await h.shutdown()
    }
  })
})
