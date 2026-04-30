#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdirSync, openSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Command } from 'commander'
import open from 'open'

import { resolvePaths, type Paths } from '../server/paths'
import { ensureDaemon, readServerJson, type ServerInfo } from './daemon-launcher'

const here = dirname(fileURLToPath(import.meta.url))
const daemonScript = join(here, '..', 'server', 'index.js')

async function cmdStart(pr: string | undefined): Promise<void> {
  const paths = resolvePaths()
  const info = await ensureDaemon({
    home: paths.home,
    spawnFn: spawnDetached(paths),
    errorHint: paths.daemonStderr,
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
}

async function cmdStop(): Promise<void> {
  const paths = resolvePaths()
  const info = readServerJson(paths.home)
  if (!info) {
    process.stdout.write('daemon not running\n')
    return
  }
  await stopDaemon(info, paths)
  process.stdout.write('stop signal sent\n')
}

function cmdStatus(): void {
  const paths = resolvePaths()
  const info = readServerJson(paths.home)
  if (!info) {
    process.stdout.write('daemon not running\n')
    return
  }
  process.stdout.write(
    `pid=${info.pid} port=${info.port} startedAt=${new Date(info.startedAt).toISOString()}\n`,
  )
}

async function cmdRestart(): Promise<void> {
  const paths = resolvePaths()
  const existing = readServerJson(paths.home)
  if (existing) {
    await stopDaemon(existing, paths)
    process.stdout.write('stopped existing daemon\n')
  }
  const fresh = await ensureDaemon({
    home: paths.home,
    spawnFn: spawnDetached(paths),
    errorHint: paths.daemonStderr,
  })
  const url = `http://127.0.0.1:${fresh.port}/`
  process.stdout.write(`daemon restarted (pid=${fresh.pid}): ${url}\n`)
  await open(url)
}

async function stopDaemon(info: ServerInfo, paths: Paths): Promise<void> {
  try {
    process.kill(info.pid, 'SIGTERM')
  } catch {
    rmSync(paths.serverJson, { force: true })
    return
  }
  if (await waitForExit(info.pid, 5_000)) {
    rmSync(paths.serverJson, { force: true })
    return
  }
  process.stderr.write(`daemon (pid=${info.pid}) ignored SIGTERM, escalating to SIGKILL\n`)
  try {
    process.kill(info.pid, 'SIGKILL')
  } catch {
    /* already gone */
  }
  if (!(await waitForExit(info.pid, 2_000))) {
    throw new Error(`daemon (pid=${info.pid}) survived SIGKILL`)
  }
  rmSync(paths.serverJson, { force: true })
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 100))
    if (!isAlive(pid)) return true
  }
  return false
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function spawnDetached(paths: { home: string; daemonStderr: string }): () => Promise<ServerInfo> {
  return async () => {
    mkdirSync(paths.home, { recursive: true })
    const stderrFd = openSync(paths.daemonStderr, 'w')
    const child = spawn(process.execPath, [daemonScript], {
      detached: true,
      stdio: ['ignore', 'ignore', stderrFd],
      cwd: process.cwd(),
    })
    child.unref()
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 100))
      const info = readServerJson(paths.home)
      if (info) return info
    }
    throw new Error(`daemon did not start in time (see ${paths.daemonStderr} for details)`)
  }
}

const program = new Command()
program
  .name('better-review')
  .description('Local PR review helper')
  .argument('[pr]', 'PR target (GitHub PR URL)')
  .action(async (pr: string | undefined) => {
    await cmdStart(pr)
  })

program.command('stop').description('stop running daemon').action(cmdStop)
program.command('status').description('show daemon status').action(cmdStatus)
program.command('restart').description('stop and start daemon').action(cmdRestart)

program.parseAsync().catch((e: unknown) => {
  process.stderr.write(`error: ${(e as Error).message}\n`)
  process.exit(1)
})
