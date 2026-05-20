import { describe, it, expect } from 'vitest'

import { detectPackageManager, installSpec, isPackageManager, PKG_NAME } from '../../src/cli/update'

describe('detectPackageManager', () => {
  it('detects pnpm global installs', () => {
    expect(
      detectPackageManager('/Users/x/Library/pnpm/global/5/node_modules/@xieziyu/better-review'),
    ).toBe('pnpm')
    expect(
      detectPackageManager('/root/.local/share/pnpm/global/5/node_modules/@xieziyu/better-review'),
    ).toBe('pnpm')
  })

  it('detects bun global installs', () => {
    expect(
      detectPackageManager('/Users/x/.bun/install/global/node_modules/@xieziyu/better-review'),
    ).toBe('bun')
  })

  it('detects yarn global installs', () => {
    expect(detectPackageManager('/Users/x/.yarn/global/node_modules/@xieziyu/better-review')).toBe(
      'yarn',
    )
  })

  it('falls back to npm for a plain global prefix', () => {
    expect(detectPackageManager('/usr/local/lib/node_modules/@xieziyu/better-review')).toBe('npm')
  })

  it('normalizes Windows-style separators', () => {
    expect(
      detectPackageManager(
        'C:\\Users\\x\\.bun\\install\\global\\node_modules\\@xieziyu\\better-review',
      ),
    ).toBe('bun')
  })
})

describe('installSpec', () => {
  it('builds a global reinstall-latest invocation per manager', () => {
    const tgt = `${PKG_NAME}@latest`
    expect(installSpec('npm')).toEqual({ cmd: 'npm', args: ['install', '-g', tgt] })
    expect(installSpec('pnpm')).toEqual({ cmd: 'pnpm', args: ['add', '-g', tgt] })
    expect(installSpec('yarn')).toEqual({ cmd: 'yarn', args: ['global', 'add', tgt] })
    expect(installSpec('bun')).toEqual({ cmd: 'bun', args: ['add', '-g', tgt] })
  })
})

describe('isPackageManager', () => {
  it('accepts the four known managers and rejects anything else', () => {
    expect(isPackageManager('npm')).toBe(true)
    expect(isPackageManager('pnpm')).toBe(true)
    expect(isPackageManager('yarn')).toBe(true)
    expect(isPackageManager('bun')).toBe(true)
    expect(isPackageManager('cargo')).toBe(false)
    expect(isPackageManager('')).toBe(false)
  })
})
