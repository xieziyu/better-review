export const PKG_NAME = '@xieziyu/better-review'

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

export const PACKAGE_MANAGERS: readonly PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun']

/**
 * Guess which package manager installed the CLI by inspecting the install
 * path. Global installs leave distinctive markers (`.pnpm`, `.bun`, `yarn`);
 * anything else is assumed to be npm.
 */
export function detectPackageManager(pkgRoot: string): PackageManager {
  const p = pkgRoot.replace(/\\/g, '/')
  if (/\/\.bun\//.test(p)) return 'bun'
  if (/\.pnpm|\/pnpm\//.test(p)) return 'pnpm'
  if (/\/\.yarn\/|\/yarn\//.test(p)) return 'yarn'
  return 'npm'
}

/** Build the "reinstall the latest published version globally" invocation. */
export function installSpec(pm: PackageManager): { cmd: string; args: string[] } {
  const tgt = `${PKG_NAME}@latest`
  switch (pm) {
    case 'pnpm':
      return { cmd: 'pnpm', args: ['add', '-g', tgt] }
    case 'yarn':
      return { cmd: 'yarn', args: ['global', 'add', tgt] }
    case 'bun':
      return { cmd: 'bun', args: ['add', '-g', tgt] }
    default:
      return { cmd: 'npm', args: ['install', '-g', tgt] }
  }
}

export function isPackageManager(value: string): value is PackageManager {
  return (PACKAGE_MANAGERS as readonly string[]).includes(value)
}
