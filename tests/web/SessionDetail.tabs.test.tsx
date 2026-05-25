import type { Finding, PRSession } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

// Replace heavy children. The tabs test only cares about which subtree shows.
vi.mock('@/components/files-changed/FilesChangedView', () => ({
  FilesChangedView: () => <div data-testid="files-view">files-changed-view</div>,
}))
vi.mock('@/components/FindingsWorkspace', () => ({
  FindingsWorkspace: () => <div data-testid="findings-workspace">findings-workspace</div>,
}))
vi.mock('@/components/ReviewSummary', () => ({
  ReviewSummary: () => <div data-testid="review-summary">review-summary</div>,
}))
vi.mock('@/components/CodeBlock', () => ({
  CodeBlock: ({ code, children }: { code?: string; children?: React.ReactNode }) => (
    <pre>{code ?? children}</pre>
  ),
}))

import { SelectionProvider } from '@/lib/selection'
import { ToastProvider } from '@/lib/toast'
import { SessionDetail } from '@/pages/SessionDetail'

function withRoute(
  session: PRSession,
  findings: Finding[],
  diff: string | null = null,
): React.ReactElement {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  qc.setQueryData(['session', session.id], { session, findings })
  qc.setQueryData(['session', session.id, 'diff'], diff)
  return (
    <QueryClientProvider client={qc}>
      <SelectionProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={[`/session/${session.id}`]}>
            <Routes>
              <Route path="/session/:id" element={<SessionDetail />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </SelectionProvider>
    </QueryClientProvider>
  )
}

const session: PRSession = {
  id: 's1',
  source: { kind: 'github-pr', owner: 'o', repo: 'r', number: 1 },
  owner: 'o',
  repo: 'r',
  number: 1,
  title: 'pr',
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

const finding: Finding = {
  id: 'R1',
  dbId: 'd1',
  sessionId: 's1',
  ord: 1,
  severity: 'must',
  category: 'C',
  file: 'src/x.ts',
  line: 1,
  title: 'tab finding',
  body: 'b',
  selected: true,
  edited: false,
  archived: false,
  createdAt: 0,
  source: 'agent',
}

describe('PRDetail tabs', () => {
  it('defaults a ready session to the Summary tab', () => {
    render(withRoute(session, [finding], 'diff'))
    expect(screen.getByRole('tab', { name: /Summary/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('review-summary')).toBeInTheDocument()
    expect(screen.queryByTestId('files-view')).not.toBeInTheDocument()
  })

  it('defaults a running session to the Files changed tab', () => {
    render(withRoute({ ...session, status: 'running' }, [finding], 'diff'))
    expect(screen.getByRole('tab', { name: /Files changed/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByTestId('files-view')).toBeInTheDocument()
  })

  it('switches to the Findings tab and renders the workspace', () => {
    render(withRoute(session, [finding], 'diff'))
    fireEvent.click(screen.getByRole('tab', { name: /Findings/i }))
    expect(screen.getByTestId('findings-workspace')).toBeInTheDocument()
    expect(screen.queryByTestId('review-summary')).not.toBeInTheDocument()
  })

  it('switches to the Files changed tab and renders the files view', () => {
    render(withRoute(session, [finding], 'diff'))
    fireEvent.click(screen.getByRole('tab', { name: /Files changed/i }))
    expect(screen.getByTestId('files-view')).toBeInTheDocument()
  })

  it('shows zero count on the Findings tab when there are none', () => {
    render(withRoute(session, [], 'diff'))
    expect(screen.getByRole('tab', { name: /Findings/i })).toHaveTextContent('0')
  })
})
