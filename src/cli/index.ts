#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Command } from 'commander'
import open from 'open'

import { resolvePaths } from '../server/paths'
import { ensureDaemon, readServerJson, type ServerInfo } from './daemon-launcher'

const here = dirname(fileURLToPath(import.meta.url))
const daemonScript = join(here, '..', 'server', 'index.js')

const program = new Command()
program
  .name('better-review')
  .description('Local PR review helper')
  .argument('[pr]', 'PR target (number, owner/repo#N, or URL)')
  .option('--stop', 'stop running daemon')
  .option('--status', 'show daemon status')
  .action(async (pr: string | undefined, opts: { stop?: boolean; status?: boolean }) => {
    const paths = resolvePaths()
    if (opts.stop) {
      const info = readServerJson(paths.home)
      if (!info) {
        process.stdout.write('daemon not running\n')
        return
      }
      try {
        process.kill(info.pid, 'SIGTERM')
      } catch {
        rmSync(paths.serverJson, { force: true })
      }
      process.stdout.write('stop signal sent\n')
      return
    }
    if (opts.status) {
      const info = readServerJson(paths.home)
      if (!info) {
        process.stdout.write('daemon not running\n')
        return
      }
      process.stdout.write(
        `pid=${info.pid} port=${info.port} startedAt=${new Date(info.startedAt).toISOString()}\n`,
      )
      return
    }
    const info = await ensureDaemon({
      home: paths.home,
      spawnFn: spawnDetached(paths.home),
    })
    if (pr) {
      try {
        await fetch(`http://127.0.0.1:${info.port}/api/sessions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prInput: pr }),
        })
      } catch {
        /* ignore — UI will show error */
      }
    }
    const url = pr
      ? `http://127.0.0.1:${info.port}/?pr=${encodeURIComponent(pr)}`
      : `http://127.0.0.1:${info.port}/`
    await open(url)
  })

function spawnDetached(home: string): () => Promise<ServerInfo> {
  return async () => {
    const child = spawn(process.execPath, [daemonScript], {
      detached: true,
      stdio: 'ignore',
      cwd: process.cwd(),
    })
    child.unref()
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 100))
      const info = readServerJson(home)
      if (info) return info
    }
    throw new Error('daemon did not start in time')
  }
}

program.parseAsync().catch((e: unknown) => {
  process.stderr.write(`error: ${(e as Error).message}\n`)
  process.exit(1)
})
