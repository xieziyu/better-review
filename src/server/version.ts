import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// `dist/server/version.js` and `src/server/version.ts` both sit two levels
// below the package root, so `../../package.json` resolves in dev and after
// an npm install alike.
const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

let cachedVersion: string | undefined

export function getPackageRoot(): string {
  return pkgRoot
}

export function getAppVersion(): string {
  if (cachedVersion) return cachedVersion
  try {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
      version?: unknown
    }
    cachedVersion = typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    cachedVersion = '0.0.0'
  }
  return cachedVersion
}
