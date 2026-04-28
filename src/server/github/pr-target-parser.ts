export interface PRTarget {
  owner: string
  repo: string
  number: number
}

export interface ParseOpts {
  defaultOwner?: string
  defaultRepo?: string
}

const URL_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/
const SHORT_RE = /^([^/]+)\/([^/#]+)#(\d+)$/
const NUM_RE = /^(\d+)$/

export function parsePRTarget(input: string, opts: ParseOpts = {}): PRTarget {
  const trimmed = input.trim()
  let m = URL_RE.exec(trimmed)
  if (m) return { owner: m[1]!, repo: m[2]!, number: Number(m[3]) }
  m = SHORT_RE.exec(trimmed)
  if (m) return { owner: m[1]!, repo: m[2]!, number: Number(m[3]) }
  m = NUM_RE.exec(trimmed)
  if (m) {
    if (!opts.defaultOwner || !opts.defaultRepo) {
      throw new Error(
        'Bare PR number requires default owner/repo (run inside a git repo or use owner/repo#N).',
      )
    }
    return { owner: opts.defaultOwner, repo: opts.defaultRepo, number: Number(m[1]) }
  }
  throw new Error(`Cannot parse PR target: ${input}`)
}
