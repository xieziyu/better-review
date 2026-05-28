import type { Finding, ReviewEvent } from '../../shared/types'
import type { ReviewPayload, ReviewComment } from '../github/gh-client'
import { isLineInDiff, isLineRangeInDiff } from './diff-line-validator'

export interface BuildArgs {
  diff: string
  findings: Finding[]
  event: ReviewEvent
  userBody?: string
}

export interface BuildResult {
  payload: ReviewPayload
  droppedToBody: Finding[]
}

function severityTag(s: Finding['severity']): string {
  if (s === 'must') return '🔴 **[MUST]**'
  if (s === 'should') return '🟡 **[SHOULD]**'
  return '🔵 **[NIT]**'
}

function formatLineLoc(f: Finding): string {
  if (!f.line) return ''
  if (f.startLine && f.startLine < f.line) return `${f.startLine}-${f.line}`
  return String(f.line)
}

function renderFindingMarkdown(f: Finding): string {
  const tag = severityTag(f.severity)
  const lineLoc = formatLineLoc(f)
  const loc = f.file ? ` (${f.file}${lineLoc ? ':' + lineLoc : ''})` : ''
  const head = `### ${tag} ${f.title}${loc}`
  const sug = f.suggestion ? `\n\n\`\`\`suggestion\n${f.suggestion}\n\`\`\`` : ''
  return `${head}\n\n${f.body}${sug}`
}

export function renderInlineComment(f: Finding): string {
  const tag = severityTag(f.severity)
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
      bodyParts.push(renderFindingMarkdown(f))
      continue
    }
    if (!f.line) {
      // No line anchor → render into the review body. GitHub's
      // `POST /pulls/:n/reviews` endpoint does not accept `subject_type`
      // in its `comments[]` items (that field only exists on the
      // standalone `POST /pulls/:n/comments` endpoint), so file-level
      // findings cannot ride along the review payload as inline comments.
      bodyParts.push(renderFindingMarkdown(f))
      continue
    }
    const start = f.startLine && f.startLine < f.line ? f.startLine : null
    const rangeOk = start
      ? isLineRangeInDiff(args.diff, f.file, start, f.line)
      : isLineInDiff(args.diff, f.file, f.line)
    if (rangeOk) {
      const c: ReviewComment = {
        path: f.file,
        line: f.line,
        side: 'RIGHT',
        body: renderInlineComment(f),
      }
      if (start) {
        c.start_line = start
        c.start_side = 'RIGHT'
      }
      comments.push(c)
    } else {
      dropped.push(f)
      bodyParts.push(renderFindingMarkdown(f))
    }
  }
  return {
    payload: { event: args.event, body: bodyParts.join('\n\n---\n\n'), comments },
    droppedToBody: dropped,
  }
}
