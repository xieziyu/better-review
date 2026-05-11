import type { SourceKind } from '../../shared/types'

export interface PriorReplyForPrompt {
  author: string
  body: string
  isAuthor: boolean
}

export interface PriorInlineForPrompt {
  file: string | null
  line: number | null
  startLine: number | null
  body: string
  replies: PriorReplyForPrompt[]
}

export interface PriorReviewVars {
  lastReviewedSha: string
  forcePushed: boolean
  reviewBody: string
  inlineComments: PriorInlineForPrompt[]
  issueComments: PriorReplyForPrompt[]
}

export interface PromptVars {
  rules: string
  prMeta: string
  diff: string
  findingsPath: string
  schemaJson: string
  // Source context the agent will read alongside the diff. `kind` selects
  // which `{{#SOURCE:<kind>}}…{{/SOURCE}}` block survives rendering; the
  // matching values flow into `{{SOURCE_PATH}}`, `{{SOURCE_KIND}}`, and
  // `{{HEAD_SHA}}` placeholders.
  sourceKind?: SourceKind
  sourcePath?: string
  headSha?: string
  // Per-session free-form notes (PRD excerpts, judgment guidance, etc.).
  // Empty / whitespace-only is treated as none and the entire
  // `{{#EXTRA_NOTES}}…{{/EXTRA_NOTES}}` block (including header) is removed.
  extraNotes?: string
  // Rerun context: when present, the `{{#PRIOR_REVIEW}}` block survives
  // and is filled with the prior review body + inline + issue comments.
  // When absent, the entire block is stripped → byte-identical output to
  // a first-ever review.
  priorReview?: PriorReviewVars
}

// Markers wrap kind-specific content. We strip whole blocks whose suffix
// doesn't match the active source kind, and strip just the marker tags from
// the block that does. Markers are expected to occupy their own lines (we
// also eat the trailing newline along with the marker so the surrounding
// markdown re-knits cleanly).
const SOURCE_BLOCK_OPEN_RE = /\{\{#SOURCE:([a-z]+)\}\}\n?/g
const SOURCE_BLOCK_CLOSE_RE = /\{\{\/SOURCE\}\}\n?/g
const SOURCE_BLOCK_FULL_RE = /\{\{#SOURCE:([a-z]+)\}\}[\s\S]*?\{\{\/SOURCE\}\}\n?/g

function applySourceBlocks(template: string, kind: SourceKind | undefined): string {
  const active: SourceKind = kind ?? 'none'
  // Strip blocks whose `kind` doesn't match the active source. `none` always
  // strips both worktree and snapshot blocks (no inner content survives).
  let out = template.replace(SOURCE_BLOCK_FULL_RE, (full, blockKind: string) =>
    blockKind === active ? full : '',
  )
  // Inside the surviving block, drop the marker tags so only the inner
  // content reaches the agent.
  out = out.replace(SOURCE_BLOCK_OPEN_RE, '').replace(SOURCE_BLOCK_CLOSE_RE, '')
  return out
}

const EXTRA_NOTES_BLOCK_RE = /\{\{#EXTRA_NOTES\}\}\n?([\s\S]*?)\{\{\/EXTRA_NOTES\}\}\n?/g

function applyExtraNotes(template: string, notes: string | undefined): string {
  const trimmed = notes?.trim() ?? ''
  if (trimmed.length === 0) {
    return template.replace(EXTRA_NOTES_BLOCK_RE, '')
  }
  return template.replace(EXTRA_NOTES_BLOCK_RE, (_full, inner: string) =>
    inner.replaceAll('{{EXTRA_NOTES_BODY}}', trimmed),
  )
}

const PRIOR_REVIEW_BLOCK_RE = /\{\{#PRIOR_REVIEW\}\}\n?([\s\S]*?)\{\{\/PRIOR_REVIEW\}\}\n?/g
const PRIOR_FORCE_BLOCK_RE = /\{\{#FORCE_PUSHED\}\}\n?([\s\S]*?)\{\{\/FORCE_PUSHED\}\}\n?/g
const PRIOR_NOT_FORCE_BLOCK_RE = /\{\{\^FORCE_PUSHED\}\}\n?([\s\S]*?)\{\{\/FORCE_PUSHED\}\}\n?/g

function formatPriorInline(items: PriorInlineForPrompt[]): string {
  if (items.length === 0) return '_(No inline comments were posted in the prior review.)_'
  const out: string[] = []
  items.forEach((c, idx) => {
    const loc =
      c.file === null
        ? '(no specific location)'
        : c.line === null
          ? c.file
          : c.startLine && c.startLine < c.line
            ? `${c.file}:${c.startLine}-${c.line}`
            : `${c.file}:${c.line}`
    const firstBody = c.body.trim()
    out.push(`#${idx + 1} · \`${loc}\``)
    out.push('')
    out.push(
      firstBody
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n'),
    )
    if (c.replies.length > 0) {
      out.push('')
      out.push('Replies:')
      for (const r of c.replies) {
        const tag = r.isAuthor ? `**@${r.author} (author)**` : `@${r.author}`
        const indented = r.body
          .trim()
          .split('\n')
          .map((l) => `    ${l}`)
          .join('\n')
        out.push(`- ${tag}:`)
        out.push(indented)
      }
    }
    out.push('')
  })
  return out.join('\n').trimEnd()
}

function formatIssueComments(items: PriorReplyForPrompt[]): string {
  if (items.length === 0) return '_(No comments in the PR conversation thread.)_'
  return items
    .map((c) => {
      const tag = c.isAuthor ? `**@${c.author} (author)**` : `@${c.author}`
      const body = c.body
        .trim()
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n')
      return `- ${tag}:\n${body}`
    })
    .join('\n')
}

function applyPriorReview(template: string, prior: PriorReviewVars | undefined): string {
  if (!prior) {
    return template.replace(PRIOR_REVIEW_BLOCK_RE, '')
  }
  const forceVisible = prior.forcePushed
  return template.replace(PRIOR_REVIEW_BLOCK_RE, (_full, inner: string) => {
    let body = inner
    body = body.replace(PRIOR_FORCE_BLOCK_RE, (_f, b: string) => (forceVisible ? b : ''))
    body = body.replace(PRIOR_NOT_FORCE_BLOCK_RE, (_f, b: string) => (forceVisible ? '' : b))
    body = body
      .replaceAll('{{LAST_REVIEWED_SHA}}', prior.lastReviewedSha || '(unknown)')
      .replaceAll(
        '{{PRIOR_REVIEW_BODY}}',
        prior.reviewBody.trim().length > 0
          ? prior.reviewBody.trim()
          : '_(The prior review summary was empty.)_',
      )
      .replaceAll('{{PRIOR_REVIEW_INLINE}}', formatPriorInline(prior.inlineComments))
      .replaceAll('{{PRIOR_REVIEW_ISSUE}}', formatIssueComments(prior.issueComments))
    return body
  })
}

export function renderPrompt(framework: string, vars: PromptVars): string {
  return applyPriorReview(
    applyExtraNotes(applySourceBlocks(framework, vars.sourceKind), vars.extraNotes),
    vars.priorReview,
  )
    .replaceAll('{{RULES}}', vars.rules)
    .replaceAll('{{PR_META}}', vars.prMeta)
    .replaceAll('{{DIFF}}', vars.diff)
    .replaceAll('{{FINDINGS_PATH}}', vars.findingsPath)
    .replaceAll('{{SCHEMA}}', vars.schemaJson)
    .replaceAll('{{SOURCE_KIND}}', vars.sourceKind ?? 'none')
    .replaceAll('{{SOURCE_PATH}}', vars.sourcePath ?? '')
    .replaceAll('{{HEAD_SHA}}', vars.headSha ?? '')
}
