import type { BundledLanguage } from 'shiki/bundle/full'

export type ShikiLang = BundledLanguage | 'plaintext'

// Bare-basename matches (no extension). Add lowercase keys; we lowercase before lookup.
const BASENAME_MAP: Record<string, ShikiLang> = {
  dockerfile: 'docker',
  makefile: 'make',
}

// Extension → Shiki bundled language id. Keys are lowercase, no leading dot.
const EXT_MAP: Record<string, ShikiLang> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'jsonc',
  json5: 'json5',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  php: 'php',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'fish',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  html: 'html',
  htm: 'html',
  vue: 'vue',
  svelte: 'svelte',
  md: 'markdown',
  mdx: 'mdx',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  ini: 'ini',
  conf: 'ini',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  proto: 'proto',
  lua: 'lua',
  pl: 'perl',
  r: 'r',
  scala: 'scala',
  groovy: 'groovy',
  dart: 'dart',
  elm: 'elm',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  clj: 'clojure',
  cljs: 'clojure',
  hs: 'haskell',
  ml: 'ocaml',
  fs: 'fsharp',
  vim: 'viml',
  zig: 'zig',
  nix: 'nix',
  diff: 'diff',
  patch: 'diff',
}

/**
 * Infer a Shiki language id from a finding's source-file path.
 * Returns `'plaintext'` for null/empty/unknown.
 *
 * Matches by:
 *   1. bare basename (e.g. `Dockerfile`, `Makefile`) — case-insensitive
 *   2. lowercased final extension after the last `.`
 */
export function inferLangFromFile(file: string | null | undefined): ShikiLang {
  if (!file) return 'plaintext'
  const basename = file.split('/').pop() ?? file
  const lower = basename.toLowerCase()

  const byBasename = BASENAME_MAP[lower]
  if (byBasename) return byBasename

  const dot = lower.lastIndexOf('.')
  if (dot < 0 || dot === lower.length - 1) return 'plaintext'
  const ext = lower.slice(dot + 1)
  return EXT_MAP[ext] ?? 'plaintext'
}
