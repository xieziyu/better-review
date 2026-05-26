import type { AgentKind } from './types'
import type { Finding } from './types'

// Public input contract for the renderer. The caller (the SPA) has already
// resolved which findings to include and what scope label they represent;
// the renderer only formats. Keeping the surface narrow means changes to
// the Finding shape don't ripple into header / filename concerns.

// One of these per session kind. All three carry a `title` (PR title or the
// commit/vbranch subject) and a display-only `url` that's null for local
// sources. The renderer keys off `kind` for headings and filenames.
export type ExportSourceMeta =
  | {
      kind: 'github-pr'
      owner: string
      repo: string
      number: number
      title: string | null
      url: string | null
    }
  | {
      kind: 'local-branch'
      repoPath: string
      branch: string
      title: string | null
    }
  | {
      kind: 'gitbutler-vbranch'
      repoPath: string
      vbranchName: string
      title: string | null
    }

export interface ExportInput {
  source: ExportSourceMeta
  session: {
    roundNumber: number
    agent: AgentKind
    // Caller-supplied ISO timestamp. Passed in (not Date.now() inside) so
    // the renderer stays pure and tests are deterministic.
    exportedAt: string
  }
  // Total non-archived findings on the session, used to render the
  // "<n> selected of <total>" line. May exceed findings.length when
  // scope === 'selected'.
  totalFindings: number
  scope: 'selected' | 'all'
  // Already filtered + sorted by sortByPriority. The renderer trusts the
  // order it receives and only splits file-scoped vs PR-wide.
  findings: Finding[]
}

const SEVERITY_EMOJI = { must: '🔴', should: '🟡', nit: '🔵' } as const

function repoBasename(repoPath: string): string {
  return repoPath.replace(/\/+$/, '').split('/').pop() ?? repoPath
}

// Headline for the markdown / json title and the rendered header. Mirrors
// the in-app `sessionDisplayLabel` so exports read the same as the UI.
function sourceHeadline(source: ExportSourceMeta): string {
  if (source.kind === 'github-pr') return `${source.owner}/${source.repo}#${source.number}`
  if (source.kind === 'local-branch') return `${repoBasename(source.repoPath)} · ${source.branch}`
  return `${repoBasename(source.repoPath)} · ${source.vbranchName}`
}

export function renderFindingsMarkdown(input: ExportInput): string {
  const { source, session, scope, totalFindings, findings } = input
  const out: string[] = []

  out.push(`# Findings · ${sourceHeadline(source)}`)
  out.push('')
  if (source.kind === 'github-pr') {
    if (source.title) out.push(`- **PR:** ${source.title}`)
    if (source.url) out.push(`- **URL:** ${source.url}`)
  } else if (source.kind === 'local-branch') {
    if (source.title) out.push(`- **Branch:** ${source.title}`)
    out.push(`- **Repo:** ${source.repoPath}`)
  } else {
    if (source.title) out.push(`- **VBranch:** ${source.title}`)
    out.push(`- **Repo:** ${source.repoPath}`)
  }
  const scopeLine =
    scope === 'selected'
      ? `${findings.length} selected of ${totalFindings} (round ${session.roundNumber})`
      : `${findings.length} of ${totalFindings} findings (round ${session.roundNumber})`
  out.push(`- **Scope:** ${scopeLine}`)
  out.push(`- **Agent:** ${session.agent} · ${session.exportedAt}`)
  out.push('')
  out.push('---')

  const fileScoped: Finding[] = []
  const prWide: Finding[] = []
  for (const f of findings) {
    if (f.file === null) prWide.push(f)
    else fileScoped.push(f)
  }

  // Group file-scoped findings under one `## <file>` section each, in the
  // order they arrive. Caller is expected to have sorted by file already.
  let currentFile: string | null = null
  for (const f of fileScoped) {
    if (f.file !== currentFile) {
      out.push('')
      out.push(`## ${f.file}`)
      currentFile = f.file
    }
    out.push('')
    out.push(...renderFindingBlock(f, { lineLabel: lineLabelFor(f) }))
  }

  if (prWide.length > 0) {
    out.push('')
    // PR-wide for GitHub PRs; "whole review" for local sources so the
    // heading isn't misleading when there's no PR involved.
    out.push(source.kind === 'github-pr' ? '## Whole PR' : '## Whole review')
    for (const f of prWide) {
      out.push('')
      out.push(...renderFindingBlock(f, { lineLabel: null }))
    }
  }

  // Ensure trailing newline so the document concatenates cleanly when
  // piped through other tools.
  out.push('')
  return out.join('\n')
}

function lineLabelFor(f: Finding): string {
  if (f.line == null) return ''
  if (f.startLine !== undefined && f.startLine !== f.line) {
    // En dash (U+2013) for ranges; each endpoint gets its own `L` prefix
    // so the range reads cleanly when grepped alongside single-line
    // `L42` references.
    return `L${f.startLine}–L${f.line}`
  }
  return `L${f.line}`
}

function renderFindingBlock(f: Finding, opts: { lineLabel: string | null }): string[] {
  const lines: string[] = []
  const emoji = SEVERITY_EMOJI[f.severity]
  // Heading composes severity + (line) + category. Line is omitted for
  // PR-wide findings; category always renders.
  const headingBits = [`${emoji} ${f.severity}`]
  if (opts.lineLabel) headingBits.push(opts.lineLabel)
  headingBits.push(f.category)
  lines.push(`### ${headingBits.join(' · ')}`)
  lines.push('')
  lines.push(`**${f.title}**`)
  lines.push('')
  lines.push(f.body)
  if (f.suggestion !== undefined && f.suggestion.length > 0) {
    lines.push('')
    // GitHub uses ```suggestion fences. If the suggestion text itself
    // contains a triple-backtick we'd close the fence early; widen the
    // fence in that case (rare but cheap to guard).
    const fence = f.suggestion.includes('```') ? '````' : '```'
    lines.push(`${fence}suggestion`)
    lines.push(f.suggestion)
    lines.push(`${fence}`)
  }
  return lines
}

// JSON export. Strips every internal-only field — dbId, sessionId, ord,
// selected, edited, archived, createdAt, and the agent-generated `id` —
// because none of them are meaningful to a downstream consumer. Returns
// pretty-printed text with a trailing newline.
export function renderFindingsJson(input: ExportInput): string {
  const { source, session, scope, totalFindings, findings } = input
  const payload = {
    schemaVersion: 2,
    source,
    session: {
      roundNumber: session.roundNumber,
      agent: session.agent,
    },
    exportedAt: session.exportedAt,
    scope,
    totalFindings,
    findings: findings.map((f) => ({
      severity: f.severity,
      category: f.category,
      file: f.file,
      line: f.line,
      // Normalize: emit `null` (not undefined) so consumers see a
      // consistent shape regardless of whether the field was present.
      startLine: f.startLine ?? null,
      title: f.title,
      body: f.body,
      suggestion: f.suggestion ?? null,
    })),
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}

// Sanitize an arbitrary branch / vbranch name for filename use. Maps any
// non `[A-Za-z0-9._-]` run to a single `-` so paths/slashes don't escape
// the download directory and the filename stays portable across OSes.
function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
}

// Filename pattern used for downloads. Kept deterministic so tests and
// the popover footer hint agree.
//
//   github-pr        → findings-pr-<n>-<scope>.<ext>
//   local-branch     → findings-<basename>-<branch>-<scope>.<ext>
//   gitbutler-vbranch→ findings-<basename>-vb-<vbranchName>-<scope>.<ext>
export function buildExportFilename(
  source: ExportSourceMeta,
  scope: ExportInput['scope'],
  ext: 'md' | 'json',
): string {
  if (source.kind === 'github-pr') {
    if (!Number.isInteger(source.number) || source.number <= 0) {
      throw new Error(
        `buildExportFilename: github-pr source must carry a positive integer number, got ${source.number}`,
      )
    }
    return `findings-pr-${source.number}-${scope}.${ext}`
  }
  const base = sanitize(repoBasename(source.repoPath)) || 'repo'
  if (source.kind === 'local-branch') {
    const branch = sanitize(source.branch) || 'head'
    return `findings-${base}-${branch}-${scope}.${ext}`
  }
  const vb = sanitize(source.vbranchName) || 'vbranch'
  return `findings-${base}-vb-${vb}-${scope}.${ext}`
}
