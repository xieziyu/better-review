import type { Finding, PRSession } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import { FindingList } from '@/components/FindingList'

function withClient(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
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
  promptUsed: '',
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
  ...overrides,
})

describe('FindingList', () => {
  it('renders an empty state when there are no findings', () => {
    render(withClient(<FindingList findings={[]} session={session} unifiedDiff={null} />))
    expect(screen.getByText(/No findings/i)).toBeInTheDocument()
  })

  it('groups findings by file with the file path as a heading', () => {
    render(
      withClient(
        <FindingList
          findings={[
            mk({ id: 'R1', dbId: 'd1', file: 'src/a.ts', line: 1 }),
            mk({ id: 'R2', dbId: 'd2', file: 'src/b.ts', line: 2 }),
          ]}
          session={session}
          unifiedDiff={null}
        />,
      ),
    )
    expect(screen.getByRole('heading', { name: /src\/a\.ts/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /src\/b\.ts/ })).toBeInTheDocument()
  })

  it('renders file=null findings in a separate PR-wide section at the bottom', () => {
    render(
      withClient(
        <FindingList
          findings={[
            mk({ id: 'R1', dbId: 'd1', file: 'src/a.ts', line: 1 }),
            mk({ id: 'R2', dbId: 'd2', file: null, line: null, title: 'Whole-PR finding' }),
          ]}
          session={session}
          unifiedDiff={null}
        />,
      ),
    )
    const headings = screen.getAllByRole('heading')
    const headingTexts = headings.map((h) => h.textContent ?? '')
    const fileIdx = headingTexts.findIndex((t) => t.includes('src/a.ts'))
    const wideIdx = headingTexts.findIndex((t) => /PR-wide/i.test(t))
    expect(fileIdx).toBeGreaterThanOrEqual(0)
    expect(wideIdx).toBeGreaterThan(fileIdx)
    expect(screen.getByText(/Whole-PR finding/)).toBeInTheDocument()
  })

  it('orders findings within a file by severity (must, should, nit)', () => {
    render(
      withClient(
        <FindingList
          findings={[
            mk({ id: 'R1', dbId: 'd1', severity: 'nit', title: 'nit-title' }),
            mk({ id: 'R2', dbId: 'd2', severity: 'must', title: 'must-title' }),
            mk({ id: 'R3', dbId: 'd3', severity: 'should', title: 'should-title' }),
          ]}
          session={session}
          unifiedDiff={null}
        />,
      ),
    )
    const must = screen.getByText('must-title')
    const should = screen.getByText('should-title')
    const nit = screen.getByText('nit-title')
    const all = Array.from(document.body.querySelectorAll('h3'))
    const order = all.map((h) => h.textContent)
    const idxMust = order.indexOf('must-title')
    const idxShould = order.indexOf('should-title')
    const idxNit = order.indexOf('nit-title')
    expect(idxMust).toBeLessThan(idxShould)
    expect(idxShould).toBeLessThan(idxNit)
    expect(must).toBeInTheDocument()
    expect(should).toBeInTheDocument()
    expect(nit).toBeInTheDocument()
  })
})
