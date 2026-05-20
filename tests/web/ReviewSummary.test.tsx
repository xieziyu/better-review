import type { Finding, PRSession, ReviewSummaryFromAgent } from '@shared/types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/CodeBlock', () => ({
  CodeBlock: ({ code }: { code: string }) => <pre>{code}</pre>,
}))

import { ReviewSummary } from '@/components/ReviewSummary'

// One per-file diff section, mirroring `gh pr diff` output.
function modifyBlock(path: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    'index 1111111..2222222 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,2 +1,2 @@',
    ' context',
    '-old',
    '+new',
    '',
  ].join('\n')
}

const DIFF = modifyBlock('src/a.ts') + modifyBlock('pnpm-lock.yaml')

function makeSession(over: Partial<PRSession> = {}): PRSession {
  return {
    id: 's1',
    owner: 'o',
    repo: 'r',
    number: 1,
    title: 'pr',
    author: null,
    url: null,
    baseRef: null,
    headRef: null,
    status: 'ready',
    agent: 'codex',
    createdAt: 0,
    updatedAt: 0,
    workdir: '',
    localRepoPath: null,
    sourceKind: null,
    sourceRefName: null,
    promptUsed: '',
    extraPrompt: null,
    headSha: null,
    reviewSummary: null,
    excludedFiles: [{ path: 'pnpm-lock.yaml', glob: 'pnpm-lock.yaml' }],
    error: null,
    ...over,
  }
}

const mustFinding: Finding = {
  id: 'R1',
  dbId: 'd1',
  sessionId: 's1',
  ord: 1,
  severity: 'must',
  category: 'C',
  file: 'src/a.ts',
  line: 1,
  title: 'a bug',
  body: 'b',
  selected: true,
  edited: false,
  archived: false,
  createdAt: 0,
  source: 'agent',
}

const summary: ReviewSummaryFromAgent = {
  overview: 'This PR **rewrites** the parser.',
  manualReview: [{ file: 'src/a.ts', reason: 'verify the parser edge cases' }],
}

describe('ReviewSummary', () => {
  it('renders the stat strip with file, finding and excluded counts', () => {
    render(
      <ReviewSummary
        session={makeSession()}
        findings={[mustFinding]}
        unifiedDiff={DIFF}
        onJumpToFile={() => {}}
      />,
    )
    expect(screen.getByText('Files changed')).toBeInTheDocument()
    expect(screen.getByText('Review coverage')).toBeInTheDocument()
    // pnpm-lock.yaml shows up as a "Not reviewed" coverage row.
    expect(screen.getAllByText('Not reviewed').length).toBeGreaterThan(0)
  })

  it('renders the agent overview markdown when a summary is present', () => {
    render(
      <ReviewSummary
        session={makeSession({ reviewSummary: summary })}
        findings={[mustFinding]}
        unifiedDiff={DIFF}
        onJumpToFile={() => {}}
      />,
    )
    expect(screen.getByText('rewrites')).toBeInTheDocument()
    expect(screen.getByText(/Overview written by codex/)).toBeInTheDocument()
    expect(screen.getByText('verify the parser edge cases')).toBeInTheDocument()
  })

  it('shows the pending placeholder while running without a summary', () => {
    render(
      <ReviewSummary
        session={makeSession({ status: 'running', reviewSummary: null })}
        findings={[]}
        unifiedDiff={DIFF}
        onJumpToFile={() => {}}
      />,
    )
    expect(screen.getByText(/still running/i)).toBeInTheDocument()
  })

  it('lists a must-carrying file in the attention section even without an agent note', () => {
    render(
      <ReviewSummary
        session={makeSession({ reviewSummary: null })}
        findings={[mustFinding]}
        unifiedDiff={DIFF}
        onJumpToFile={() => {}}
      />,
    )
    expect(screen.getByText(/must-severity finding/)).toBeInTheDocument()
  })

  it('jumps to a file when a summary row is clicked', () => {
    const onJump = vi.fn()
    render(
      <ReviewSummary
        session={makeSession({ reviewSummary: summary })}
        findings={[mustFinding]}
        unifiedDiff={DIFF}
        onJumpToFile={onJump}
      />,
    )
    // The attention row for src/a.ts is the button wrapping the agent reason.
    const button = screen.getByText('verify the parser edge cases').closest('button')
    expect(button).not.toBeNull()
    button!.click()
    expect(onJump).toHaveBeenCalledWith('src/a.ts')
  })
})
