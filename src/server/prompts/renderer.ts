import type { SourceKind } from '../../shared/types'

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

export function renderPrompt(framework: string, vars: PromptVars): string {
  return applyExtraNotes(applySourceBlocks(framework, vars.sourceKind), vars.extraNotes)
    .replaceAll('{{RULES}}', vars.rules)
    .replaceAll('{{PR_META}}', vars.prMeta)
    .replaceAll('{{DIFF}}', vars.diff)
    .replaceAll('{{FINDINGS_PATH}}', vars.findingsPath)
    .replaceAll('{{SCHEMA}}', vars.schemaJson)
    .replaceAll('{{SOURCE_KIND}}', vars.sourceKind ?? 'none')
    .replaceAll('{{SOURCE_PATH}}', vars.sourcePath ?? '')
    .replaceAll('{{HEAD_SHA}}', vars.headSha ?? '')
}
