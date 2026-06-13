import type { Finding, PRSession } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/CodeBlock', () => ({
  CodeBlock: ({ code, children }: { code?: string; children?: React.ReactNode }) => (
    <pre data-testid="codeblock">{code ?? children}</pre>
  ),
}))

import { InlineFindingCard } from '@/components/files-changed/InlineFindingCard'

const session: PRSession = {
  id: 's1',
  owner: 'o',
  source: { kind: 'github-pr', owner: 'o', repo: 'r', number: 1 },
  repo: 'r',
  number: 1,
  title: null,
  author: null,
  url: null,
  baseRef: null,
  headRef: null,
  status: 'ready',
  agent: 'claude',
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
  excludedFiles: [],
  error: null,
}

const mkFinding = (over: Partial<Finding> = {}): Finding => ({
  id: 'R1',
  dbId: 'd1',
  sessionId: 's1',
  ord: 1,
  severity: 'must',
  category: 'Correctness',
  file: 'src/foo.ts',
  line: 10,
  title: 'a manual finding',
  body: 'some body text',
  selected: true,
  edited: false,
  archived: false,
  createdAt: 0,
  source: 'manual',
  submittedAt: null,
  submittedCommentId: null,
  ...over,
})

function withClient(node: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>
}

describe('InlineFindingCard', () => {
  it('renders collapsed by default with severity + category + title', () => {
    render(
      withClient(
        <InlineFindingCard
          finding={mkFinding()}
          session={session}
          expanded={false}
          onToggle={() => {}}
        />,
      ),
    )
    expect(screen.getByText('a manual finding')).toBeInTheDocument()
    expect(screen.getByText('Correctness')).toBeInTheDocument()
    expect(screen.queryByText(/Include in review/i)).not.toBeInTheDocument()
  })

  it('shows body, include checkbox, and source label when expanded', () => {
    render(
      withClient(
        <InlineFindingCard
          finding={mkFinding()}
          session={session}
          expanded={true}
          onToggle={() => {}}
        />,
      ),
    )
    expect(screen.getByText('some body text')).toBeInTheDocument()
    expect(screen.getByLabelText(/include in review/i)).toBeChecked()
    expect(screen.getByText(/^You$/)).toBeInTheDocument()
  })

  it('toggles expansion when the header is clicked', async () => {
    const onToggle = vi.fn()
    render(
      withClient(
        <InlineFindingCard
          finding={mkFinding()}
          session={session}
          expanded={false}
          onToggle={onToggle}
        />,
      ),
    )
    await userEvent.click(screen.getByText('a manual finding'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
