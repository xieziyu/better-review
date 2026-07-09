import { isFindingRangeInDiff } from '../../shared/diff-lines'
import type { Finding, Language, ReviewEvent } from '../../shared/types'
import type { ReviewPayload, ReviewComment } from '../github/gh-client'

export interface BuildArgs {
  diff: string
  findings: Finding[]
  event: ReviewEvent
  language: Language
  userBody?: string
}

export interface BuildResult {
  payload: ReviewPayload
  droppedToBody: Finding[]
}

const SEVERITY_EMOJI: Record<Finding['severity'], string> = {
  must: '🔴',
  should: '🟡',
  nit: '🔵',
}

// Localized so the GitHub-facing severity tag matches the language the agent
// wrote the finding prose in. Keep in sync with the web `severity.*` i18n keys.
const SEVERITY_LABELS: Record<Language, Record<Finding['severity'], string>> = {
  en: { must: 'MUST', should: 'SHOULD', nit: 'NIT' },
  'zh-CN': { must: '必改', should: '建议', nit: '细节' },
}

function severityTag(s: Finding['severity'], lang: Language): string {
  return `${SEVERITY_EMOJI[s]} **[${SEVERITY_LABELS[lang][s]}]**`
}

function formatLineLoc(f: Finding): string {
  if (!f.line) return ''
  if (f.startLine && f.startLine < f.line) return `${f.startLine}-${f.line}`
  return String(f.line)
}

function renderFindingMarkdown(f: Finding, lang: Language): string {
  const tag = severityTag(f.severity, lang)
  const lineLoc = formatLineLoc(f)
  const loc = f.file ? ` (${f.file}${lineLoc ? ':' + lineLoc : ''})` : ''
  const head = `### ${tag} ${f.title}${loc}`
  const sug = f.suggestion ? `\n\n\`\`\`suggestion\n${f.suggestion}\n\`\`\`` : ''
  return `${head}\n\n${f.body}${sug}`
}

export function renderInlineComment(f: Finding, lang: Language): string {
  const tag = severityTag(f.severity, lang)
  const sug = f.suggestion ? `\n\n\`\`\`suggestion\n${f.suggestion}\n\`\`\`` : ''
  return `${tag} ${f.title}\n\n${f.body}${sug}`
}

export function buildSubmitPayload(args: BuildArgs): BuildResult {
  const comments: ReviewComment[] = []
  const dropped: Finding[] = []
  const bodyParts: string[] = []
  if (args.userBody) bodyParts.push(args.userBody)
  for (const f of args.findings) {
    if (!f.file) {
      bodyParts.push(renderFindingMarkdown(f, args.language))
      continue
    }
    if (!f.line) {
      // No line anchor → render into the review body. GitHub's
      // `POST /pulls/:n/reviews` endpoint does not accept `subject_type`
      // in its `comments[]` items (that field only exists on the
      // standalone `POST /pulls/:n/comments` endpoint), so file-level
      // findings cannot ride along the review payload as inline comments.
      bodyParts.push(renderFindingMarkdown(f, args.language))
      continue
    }
    const start = f.startLine && f.startLine < f.line ? f.startLine : null
    if (isFindingRangeInDiff(args.diff, f.file, f.line, f.startLine)) {
      const c: ReviewComment = {
        path: f.file,
        line: f.line,
        side: 'RIGHT',
        body: renderInlineComment(f, args.language),
      }
      if (start) {
        c.start_line = start
        c.start_side = 'RIGHT'
      }
      comments.push(c)
    } else {
      dropped.push(f)
      bodyParts.push(renderFindingMarkdown(f, args.language))
    }
  }
  return {
    payload: { event: args.event, body: bodyParts.join('\n\n---\n\n'), comments },
    droppedToBody: dropped,
  }
}
