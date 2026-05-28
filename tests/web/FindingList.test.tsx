import type { Finding, PRSession } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import { FindingList } from '@/components/FindingList'
import { SelectionProvider } from '@/lib/selection'

function withClient(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <QueryClientProvider client={qc}>
      <SelectionProvider>{ui}</SelectionProvider>
    </QueryClientProvider>
  )
}

const session: PRSession = {
  id: 's1',
  owner: 'acme',
  repo: 'web',
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

const mk = (overrides: Partial<Finding>): Finding => ({
  id: 'R1',
  dbId: 'd1',
  sessionId: 's1',
  ord: 1,
  severity: 'should',
  category: 'C',
  file: 'src/a.ts',
  line: 10,
  title: 'Title',
  body: 'Body',
  selected: true,
  edited: false,
  archived: false,
  createdAt: 0,
  source: 'agent',
  submittedAt: null,
  submittedCommentId: null,
  ...overrides,
})

describe('FindingList', () => {
  it('renders an empty state when there are no findings', () => {
    render(withClient(<FindingList findings={[]} session={session} />))
    expect(screen.getByText(/No findings/i)).toBeInTheDocument()
  })

  it('shows file locations on each finding without separate file headings', () => {
    render(
      withClient(
        <FindingList
          findings={[
            mk({ id: 'R1', dbId: 'd1', file: 'src/a.ts', line: 1 }),
            mk({ id: 'R2', dbId: 'd2', file: 'src/b.ts', line: 2 }),
          ]}
          session={session}
        />,
      ),
    )
    expect(screen.getByLabelText('src/a.ts:1')).toBeInTheDocument()
    expect(screen.getByLabelText('src/b.ts:2')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /src\/a\.ts/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /src\/b\.ts/ })).not.toBeInTheDocument()
  })

  it('renders all file-scoped rows in a single divided list (no per-file groups)', () => {
    render(
      withClient(
        <FindingList
          findings={[
            mk({ id: 'R1', dbId: 'd1', file: 'src/a.ts', line: 1 }),
            mk({ id: 'R2', dbId: 'd2', file: 'src/b.ts', line: 2 }),
          ]}
          session={session}
        />,
      ),
    )
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.parentElement).toBe(rows[1]!.parentElement)
    expect(rows[0]!.parentElement).toHaveClass('divide-y')
  })

  it('separates PR-wide findings under their own divider after file-scoped rows', () => {
    render(
      withClient(
        <FindingList
          findings={[
            mk({ id: 'R1', dbId: 'd1', file: 'src/a.ts', line: 1, title: 'inline-finding' }),
            mk({
              id: 'R2',
              dbId: 'd2',
              file: null,
              line: null,
              title: 'whole-pr-finding',
            }),
          ]}
          session={session}
        />,
      ),
    )
    expect(screen.getByText(/PR-wide/i)).toBeInTheDocument()
    const titles = screen.getAllByRole('listitem').map((el) => el.textContent ?? '')
    const inlineIdx = titles.findIndex((tx) => tx.includes('inline-finding'))
    const wideIdx = titles.findIndex((tx) => tx.includes('whole-pr-finding'))
    expect(inlineIdx).toBeGreaterThanOrEqual(0)
    expect(wideIdx).toBeGreaterThan(inlineIdx)
  })

  it('sorts file-scoped findings by severity first, then file path, then ord', () => {
    render(
      withClient(
        <FindingList
          findings={[
            mk({ id: 'R1', dbId: 'd1', file: 'src/a.ts', severity: 'nit', title: 'a-nit' }),
            mk({ id: 'R2', dbId: 'd2', file: 'src/m.ts', severity: 'should', title: 'm-should' }),
            mk({ id: 'R3', dbId: 'd3', file: 'src/z.ts', severity: 'must', title: 'z-must' }),
            mk({ id: 'R4', dbId: 'd4', file: 'src/b.ts', severity: 'must', title: 'b-must' }),
          ]}
          session={session}
        />,
      ),
    )
    const rows = screen.getAllByRole('listitem').map((el) => el.textContent ?? '')
    const idxB = rows.findIndex((r) => r.includes('b-must'))
    const idxZ = rows.findIndex((r) => r.includes('z-must'))
    const idxM = rows.findIndex((r) => r.includes('m-should'))
    const idxA = rows.findIndex((r) => r.includes('a-nit'))
    expect(idxB).toBeLessThan(idxZ)
    expect(idxZ).toBeLessThan(idxM)
    expect(idxM).toBeLessThan(idxA)
  })
})
