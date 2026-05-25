import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { test, expect } from '@playwright/test'

let daemon: ChildProcess
let port = 0
let repoPath = ''

async function waitForServerJson(home: string, timeoutMs = 15_000): Promise<number> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const f = join(home, 'server.json')
    if (existsSync(f)) {
      try {
        const j = JSON.parse(readFileSync(f, 'utf8'))
        if (j.port) return j.port
      } catch {
        /* writing in progress */
      }
    }
    await new Promise((res) => setTimeout(res, 100))
  }
  throw new Error('daemon never wrote server.json')
}

// Build a minimal real git repo so LocalBranchFlow's `git diff <base>...<head>`
// has something concrete to produce. Two commits on `main`, one extra commit
// on `feat` — enough that the diff is non-empty and the auto-base resolver
// finds `origin/main`.
function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'br-localrepo-'))
  const sh = (args: string[]) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
    if (r.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
    }
  }
  sh(['init', '-q', '-b', 'main'])
  sh(['config', 'user.email', 'tester@example.com'])
  sh(['config', 'user.name', 'Tester'])
  spawnSync('node', ['-e', "require('node:fs').writeFileSync('a.ts','export const a = 1\\n')"], {
    cwd: dir,
  })
  sh(['add', 'a.ts'])
  sh(['commit', '-q', '-m', 'init'])
  // Fake an `origin` remote so autoBase finds origin/main without needing
  // network — we just point HEAD's refs into a local clone of `main`.
  sh(['update-ref', 'refs/remotes/origin/main', 'HEAD'])
  sh(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'])
  sh(['checkout', '-q', '-b', 'feat'])
  spawnSync(
    'node',
    ['-e', "require('node:fs').writeFileSync('a.ts','export const a = 1\\nexport const b = 2\\n')"],
    { cwd: dir },
  )
  sh(['commit', '-q', '-am', 'feat: add b'])
  return dir
}

test.beforeAll(async () => {
  const home = mkdtempSync(join(tmpdir(), 'br-e2e-local-'))
  const fakeBinDir = mkdtempSync(join(tmpdir(), 'br-bin-local-'))
  const fakeGh = resolve('tests/fixtures/fake-gh.sh')
  const fakeClaude = resolve('tests/fixtures/fake-claude.sh')
  copyFileSync(fakeGh, join(fakeBinDir, 'gh'))
  copyFileSync(fakeClaude, join(fakeBinDir, 'claude'))
  chmodSync(join(fakeBinDir, 'gh'), 0o755)
  chmodSync(join(fakeBinDir, 'claude'), 0o755)

  repoPath = makeTempRepo()

  const env = {
    ...process.env,
    BETTER_REVIEW_HOME: home,
    PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
  }
  daemon = spawn(process.execPath, ['dist/server/index.js'], { env, stdio: 'pipe' })
  daemon.stdout?.on('data', (d) => process.stdout.write(`[daemon] ${d}`))
  daemon.stderr?.on('data', (d) => process.stderr.write(`[daemon err] ${d}`))
  port = await waitForServerJson(home)
  // Pin claude as default so the local-branch session uses the fake CLI we
  // copied onto PATH instead of whatever the daemon would auto-pick.
  await writeFile(join(home, 'config.json'), JSON.stringify({ defaultAgent: 'claude' }))
})

test.afterAll(async () => {
  if (daemon && !daemon.killed) {
    daemon.kill('SIGTERM')
    await new Promise((res) => setTimeout(res, 200))
    if (!daemon.killed) daemon.kill('SIGKILL')
  }
})

test('local-branch session loads with the repo label and hides Submit', async ({ page }) => {
  const res = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prInput: repoPath,
      localBranchHead: 'feat',
      localBranchBase: 'main',
      agent: 'claude',
    }),
  })
  expect(res.status).toBe(201)
  const { id } = (await res.json()) as { id: string }
  expect(id).toBeTruthy()

  await page.goto(`http://127.0.0.1:${port}/session/${id}`)
  // The read-only badge is rendered as soon as the session row loads, so
  // assert that first — it also doubles as proof that the local-branch
  // header rendered without crashing the SPA.
  await expect(page.getByText(/Read-only review/i)).toBeVisible({ timeout: 30_000 })
  // The header label is `<basename> · <branch>` for local sessions — assert
  // both halves are present so we know the source-kind branch was taken.
  const basename = repoPath.split('/').pop()!
  await expect(page.locator('body')).toContainText(basename)
  await expect(page.locator('body')).toContainText('feat')
  // Local sessions are read-only — Submit must not render.
  await expect(page.getByRole('button', { name: /^Submit/ })).toHaveCount(0)
})
