import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
  utimesSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, beforeEach } from 'vitest'

import { prepareCodexHome, stripProjectSections } from '../../../src/server/engine/agent/codex-home'

describe('stripProjectSections', () => {
  it('removes every [projects."..."] block while preserving the rest', () => {
    const input = `model = "gpt-5.5"
model_reasoning_effort = "medium"

[projects."/Users/me/repo"]
trust_level = "trusted"

[projects."/private/tmp/x"]
trust_level = "trusted"

[mcp_servers.foo]
url = "https://example.com"

[projects."/tail"]
trust_level = "trusted"
`
    const out = stripProjectSections(input)
    expect(out).not.toContain('[projects.')
    expect(out).not.toContain('trust_level')
    expect(out).toContain('model = "gpt-5.5"')
    expect(out).toContain('[mcp_servers.foo]')
    expect(out).toContain('url = "https://example.com"')
  })

  it('returns input unchanged when no project sections present', () => {
    const input = `model = "gpt-5.5"

[mcp_servers.foo]
url = "https://example.com"
`
    expect(stripProjectSections(input)).toBe(input)
  })

  it('handles empty input', () => {
    expect(stripProjectSections('')).toBe('')
  })
})

describe('prepareCodexHome', () => {
  let userCodexHome: string
  let codexHome: string
  beforeEach(() => {
    userCodexHome = mkdtempSync(join(tmpdir(), 'br-user-codex-'))
    codexHome = join(mkdtempSync(join(tmpdir(), 'br-codex-home-')), 'codex-home')
  })

  it('creates the destination directory and seeds config.toml without [projects.*]', () => {
    writeFileSync(
      join(userCodexHome, 'config.toml'),
      `model = "gpt-5.5"

[projects."/Users/me/repo"]
trust_level = "trusted"
`,
    )
    prepareCodexHome({ codexHome, userCodexHome })
    expect(existsSync(codexHome)).toBe(true)
    const dest = readFileSync(join(codexHome, 'config.toml'), 'utf8')
    expect(dest).toContain('model = "gpt-5.5"')
    expect(dest).not.toContain('[projects.')
  })

  it('symlinks auth.json when the user has file-based credentials', () => {
    writeFileSync(join(userCodexHome, 'auth.json'), '{"token":"x"}')
    prepareCodexHome({ codexHome, userCodexHome })
    const dest = join(codexHome, 'auth.json')
    expect(lstatSync(dest).isSymbolicLink()).toBe(true)
    expect(readlinkSync(dest)).toBe(join(userCodexHome, 'auth.json'))
  })

  it('skips auth symlink when user has no auth.json (keychain users)', () => {
    prepareCodexHome({ codexHome, userCodexHome })
    expect(existsSync(join(codexHome, 'auth.json'))).toBe(false)
  })

  it('does not overwrite codex-managed trust entries on idempotent reruns', () => {
    writeFileSync(join(userCodexHome, 'config.toml'), 'model = "gpt-5.5"\n')
    prepareCodexHome({ codexHome, userCodexHome })
    // Simulate codex appending trust entries to its CODEX_HOME config.
    const destConfig = join(codexHome, 'config.toml')
    const seeded = readFileSync(destConfig, 'utf8')
    const withTrust = seeded + '\n[projects."/some/path"]\ntrust_level = "trusted"\n'
    writeFileSync(destConfig, withTrust)
    prepareCodexHome({ codexHome, userCodexHome })
    expect(readFileSync(destConfig, 'utf8')).toBe(withTrust)
  })

  it('resyncs when the user config.toml mtime changes', () => {
    const userConfigPath = join(userCodexHome, 'config.toml')
    writeFileSync(userConfigPath, 'model = "gpt-5.5"\n')
    prepareCodexHome({ codexHome, userCodexHome })

    // User edits their config, then codex would later have written a trust
    // entry into our destination. We expect resync to drop the trust entry
    // (added in destination) AND pick up the new user setting.
    const destConfig = join(codexHome, 'config.toml')
    writeFileSync(
      destConfig,
      readFileSync(destConfig, 'utf8') + '\n[projects."/x"]\ntrust_level = "trusted"\n',
    )
    writeFileSync(userConfigPath, 'model = "gpt-5.5"\nmodel_reasoning_effort = "high"\n')
    // Force mtime to be observably newer.
    const future = new Date(Date.now() + 5_000)
    utimesSync(userConfigPath, future, future)

    prepareCodexHome({ codexHome, userCodexHome })
    const dest = readFileSync(destConfig, 'utf8')
    expect(dest).toContain('model_reasoning_effort = "high"')
    expect(dest).not.toContain('[projects.')
  })

  it('creates an empty config.toml when the user has none', () => {
    prepareCodexHome({ codexHome, userCodexHome })
    expect(existsSync(join(codexHome, 'config.toml'))).toBe(true)
    expect(readFileSync(join(codexHome, 'config.toml'), 'utf8')).toBe('')
  })

  it('repairs a stale auth symlink pointing elsewhere', () => {
    writeFileSync(join(userCodexHome, 'auth.json'), '{}')
    mkdirSync(codexHome, { recursive: true })
    symlinkSync('/nonexistent/path', join(codexHome, 'auth.json'))
    prepareCodexHome({ codexHome, userCodexHome })
    expect(readlinkSync(join(codexHome, 'auth.json'))).toBe(join(userCodexHome, 'auth.json'))
  })
})
