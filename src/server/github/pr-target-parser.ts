export interface PRTarget {
  owner: string
  repo: string
  number: number
}

const URL_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/

export function parsePRTarget(input: string): PRTarget {
  const m = URL_RE.exec(input.trim())
  if (!m) {
    throw new Error(
      'PR target must be a GitHub PR URL like https://github.com/<owner>/<repo>/pull/<n>',
    )
  }
  return { owner: m[1]!, repo: m[2]!, number: Number(m[3]) }
}
