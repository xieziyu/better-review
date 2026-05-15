import { describe, expect, it } from 'vitest'

import { inferLangFromFile } from '@/lib/lang-from-file'

describe('inferLangFromFile', () => {
  it('returns plaintext for null, undefined, and empty input', () => {
    expect(inferLangFromFile(null)).toBe('plaintext')
    expect(inferLangFromFile(undefined)).toBe('plaintext')
    expect(inferLangFromFile('')).toBe('plaintext')
  })

  it('maps common TypeScript / JavaScript extensions', () => {
    expect(inferLangFromFile('src/foo.ts')).toBe('typescript')
    expect(inferLangFromFile('src/foo.mts')).toBe('typescript')
    expect(inferLangFromFile('src/foo.tsx')).toBe('tsx')
    expect(inferLangFromFile('src/foo.js')).toBe('javascript')
    expect(inferLangFromFile('src/foo.jsx')).toBe('jsx')
  })

  it('handles deeply nested paths and only looks at the basename', () => {
    expect(inferLangFromFile('a/b/c/d/main.go')).toBe('go')
    expect(inferLangFromFile('./relative/path/file.rs')).toBe('rust')
  })

  it('is case-insensitive on extensions', () => {
    expect(inferLangFromFile('Main.JAVA')).toBe('java')
    expect(inferLangFromFile('Component.TSX')).toBe('tsx')
  })

  it('matches bare basenames like Dockerfile and Makefile', () => {
    expect(inferLangFromFile('Dockerfile')).toBe('docker')
    expect(inferLangFromFile('services/web/Dockerfile')).toBe('docker')
    expect(inferLangFromFile('Makefile')).toBe('make')
  })

  it('covers common backend languages', () => {
    expect(inferLangFromFile('main.py')).toBe('python')
    expect(inferLangFromFile('App.kt')).toBe('kotlin')
    expect(inferLangFromFile('lib.swift')).toBe('swift')
    expect(inferLangFromFile('app.rb')).toBe('ruby')
    expect(inferLangFromFile('Service.cs')).toBe('csharp')
    expect(inferLangFromFile('shader.cpp')).toBe('cpp')
  })

  it('covers config and markup formats', () => {
    expect(inferLangFromFile('config.yaml')).toBe('yaml')
    expect(inferLangFromFile('config.yml')).toBe('yaml')
    expect(inferLangFromFile('Cargo.toml')).toBe('toml')
    expect(inferLangFromFile('package.json')).toBe('json')
    expect(inferLangFromFile('schema.graphql')).toBe('graphql')
  })

  it('returns plaintext for unknown extensions', () => {
    expect(inferLangFromFile('README')).toBe('plaintext')
    expect(inferLangFromFile('LICENSE')).toBe('plaintext')
    expect(inferLangFromFile('a.unknownext')).toBe('plaintext')
  })

  it('returns plaintext for dotfiles without a real extension', () => {
    // ".gitignore" -> basename starts with a dot; we treat the part after the
    // last dot ("gitignore") as an extension and look it up; not in map → plaintext.
    expect(inferLangFromFile('.gitignore')).toBe('plaintext')
  })
})
