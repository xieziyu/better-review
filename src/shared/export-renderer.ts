import type { AgentKind } from './types'
import type { Finding } from './types'

// Public input contract for the renderer. The caller (the SPA) has already
// resolved which findings to include and what scope label they represent;
// the renderer only formats. Keeping the surface narrow means changes to
// the Finding shape don't ripple into header / filename concerns.
export interface ExportInput {
  pr: {
    owner: string
    repo: string
    number: number
    title: string | null
    url: string | null
  }
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

export function renderFindingsMarkdown(input: ExportInput): string {
  const { pr, session, scope, totalFindings, findings } = input
  const prCoord = `${pr.owner}/${pr.repo}#${pr.number}`
  const out: string[] = []

  out.push(`# Findings · ${prCoord}`)
  out.push('')
  if (pr.title) out.push(`- **PR:** ${pr.title}`)
  if (pr.url) out.push(`- **URL:** ${pr.url}`)
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
    out.push('## Whole PR')
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
  const { pr, session, scope, totalFindings, findings } = input
  const payload = {
    schemaVersion: 1,
    pr: {
      owner: pr.owner,
      repo: pr.repo,
      number: pr.number,
      title: pr.title,
      url: pr.url,
    },
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

// Filename pattern used for downloads. Kept deterministic so tests and
// the popover footer hint agree.
export function buildExportFilename(
  prNumber: number,
  scope: ExportInput['scope'],
  ext: 'md' | 'json',
): string {
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error(`buildExportFilename: prNumber must be a positive integer, got ${prNumber}`)
  }
  return `findings-pr-${prNumber}-${scope}.${ext}`
}
