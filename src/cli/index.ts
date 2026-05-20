#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Command } from 'commander'
import { execa } from 'execa'
import open from 'open'

import { resolvePaths, type Paths } from '../server/paths'
import { getAppVersion, getPackageRoot } from '../server/version'
import { ensureDaemon, readServerJson, type ServerInfo } from './daemon-launcher'
import {
  detectPackageManager,
  installSpec,
  isPackageManager,
  PACKAGE_MANAGERS,
  PKG_NAME,
  type PackageManager,
} from './update'

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
  const cliVersion = getAppVersion()
  const info = readServerJson(paths.home)
  if (!info) {
    process.stdout.write(`daemon not running (cli v${cliVersion})\n`)
    return
  }
  const daemonVersion = info.version ?? 'unknown'
  process.stdout.write(
    `daemon  pid=${info.pid} port=${info.port} version=${daemonVersion} startedAt=${new Date(info.startedAt).toISOString()}\n`,
  )
  process.stdout.write(`cli     version=${cliVersion}\n`)
  if (daemonVersion !== cliVersion) {
    const detail =
      daemonVersion === 'unknown' ? 'daemon version is unknown' : 'daemon and CLI versions differ'
    process.stdout.write(`note: ${detail} — run \`better-review restart\`\n`)
  }
}

async function cmdUpdate(opts: { pm?: string }): Promise<void> {
  if (opts.pm !== undefined && !isPackageManager(opts.pm)) {
    throw new Error(
      `unknown package manager '${opts.pm}' (expected: ${PACKAGE_MANAGERS.join(', ')})`,
    )
  }
  const pkgRoot = getPackageRoot()
  if (existsSync(join(pkgRoot, '.git'))) {
    throw new Error('running from a source checkout — use `git pull` to update instead')
  }

  const current = getAppVersion()
  process.stdout.write(`current version: v${current}\n`)

  let latest: string
  try {
    const res = await execa('npm', ['view', PKG_NAME, 'version'])
    latest = res.stdout.trim()
  } catch (e) {
    throw new Error(`failed to query the latest version: ${(e as Error).message}`, { cause: e })
  }
  if (!latest) throw new Error(`npm returned an empty version for ${PKG_NAME}`)
  if (current === latest) {
    process.stdout.write(`already up to date (v${current})\n`)
    return
  }

  const pm: PackageManager =
    (opts.pm as PackageManager | undefined) ?? detectPackageManager(pkgRoot)
  process.stdout.write(`updating v${current} → v${latest} via ${pm}…\n`)
  const { cmd, args } = installSpec(pm)
  try {
    await execa(cmd, args, { stdio: 'inherit' })
  } catch (e) {
    throw new Error(`install failed: ${(e as Error).message}`, { cause: e })
  }

  // Restart the daemon so the freshly installed code takes effect. This
  // process resolved its daemon-script path from the OLD install location at
  // startup; for pnpm/yarn/bun that location moves to a new versioned store
  // directory on upgrade, so spawning from the cached path would relaunch the
  // stale daemon (or fail). Re-exec the CLI by name instead — PATH always
  // resolves `better-review` to the version that was just installed.
  const wasRunning = readServerJson(resolvePaths().home) !== null
  if (!wasRunning) {
    process.stdout.write(`updated to v${latest}\n`)
    return
  }
  process.stdout.write(`updated to v${latest}; restarting daemon…\n`)
  try {
    await execa('better-review', ['restart'], { stdio: 'inherit' })
  } catch {
    process.stdout.write(
      `daemon not restarted automatically — run \`better-review restart\` to use v${latest}\n`,
    )
  }
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
  .version(getAppVersion(), '-v, --version', 'show version')
  .argument('[pr]', 'PR target (GitHub PR URL)')
  .action(async (pr: string | undefined) => {
    await cmdStart(pr)
  })

program.command('stop').description('stop running daemon').action(cmdStop)
program.command('status').description('show daemon status').action(cmdStatus)
program.command('restart').description('stop and start daemon').action(cmdRestart)
program
  .command('update')
  .description('upgrade better-review to the latest published version')
  .option('--pm <manager>', 'package manager: npm | pnpm | yarn | bun')
  .action((opts: { pm?: string }) => cmdUpdate(opts))

program.parseAsync().catch((e: unknown) => {
  process.stderr.write(`error: ${(e as Error).message}\n`)
  process.exit(1)
})
