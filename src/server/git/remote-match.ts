// Matching a local clone to a GitHub PR's owner/repo via its git remotes.
// Shared by worktree prep (which needs a fetch remote name) and the
// recent-repos route (which auto-fills the local-repo field when the user
// pastes a PR URL but has only ever reviewed that directory as a local
// branch — so the session history carries no owner/repo to match on).

import { execa } from 'execa'

// `git remote -v` output line: "<name>\t<url> (fetch|push)". We only care
// about a fetch URL that points at the PR's owner/repo on github.com — over
// SSH or HTTPS, with or without the trailing `.git`. PRs from forks still
// resolve through the parent repo's `pull/<N>/head` ref, so when `localRepo`
// is a clone of either the parent repo OR the forker's repo we'll still find
// a usable remote — we look for the **PR target's** owner/repo specifically.
export function findGithubRemote(remotesText: string, owner: string, repo: string): string | null {
  const wantPath = `${owner}/${repo}`
  for (const raw of remotesText.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)
    if (!m || m[3] !== 'fetch') continue
    const name = m[1]!
    const url = m[2]!
    // Match github.com:owner/repo(.git)? or github.com/owner/repo(.git)?
    const re = new RegExp(`github\\.com[:/]+${owner}/${repo}(\\.git)?$`, 'i')
    if (re.test(url) || url.toLowerCase().includes(`/${wantPath.toLowerCase()}`)) {
      return name
    }
  }
  return null
}

// Whether the git clone at `repoPath` has a fetch remote pointing at
// github.com/<owner>/<repo>. Never throws — a non-repo, missing path, or
// failed git invocation just resolves to false.
export async function repoMatchesGithubRepo(
  repoPath: string,
  owner: string,
  repo: string,
): Promise<boolean> {
  if (!owner || !repo) return false
  const remotes = await execa('git', ['-C', repoPath, 'remote', '-v'], { reject: false })
  if (remotes.exitCode !== 0) return false
  return findGithubRemote(String(remotes.stdout), owner, repo) !== null
}
