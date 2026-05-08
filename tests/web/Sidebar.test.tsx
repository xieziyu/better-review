import type { PRSession } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'

import { Sidebar } from '@/components/Sidebar'

function withClient(ui: React.ReactNode, initial?: { sessions?: PRSession[] }): React.ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (initial?.sessions) qc.setQueryData(['sessions'], initial.sessions)
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

const mkSession = (overrides: Partial<PRSession> = {}): PRSession => ({
  id: 's1',
  owner: 'acme',
  repo: 'web',
  number: 42,
  title: 'feat: add login',
  author: 'alice',
  url: 'https://github.com/acme/web/pull/42',
  baseRef: 'main',
  headRef: 'feature/login',
  status: 'ready',
  agent: 'claude',
  createdAt: 0,
  updatedAt: 0,
  workdir: '/tmp/x',
  localRepoPath: null,
  sourceKind: null,
  sourceRefName: null,
  promptUsed: '',
  error: null,
  ...overrides,
})

describe('Sidebar', () => {
  it('renders a quick link back to the home / new-review page', () => {
    render(withClient(<Sidebar />, { sessions: [] }))
    const link = screen.getByRole('link', { name: /new review/i })
    expect(link).toHaveAttribute('href', '/')
  })

  it('renders a session entry with repo#num and title', () => {
    render(withClient(<Sidebar />, { sessions: [mkSession()] }))
    expect(screen.getByText(/acme\/web#42/)).toBeInTheDocument()
    expect(screen.getByText(/feat: add login/)).toBeInTheDocument()
  })

  it('groups sessions by status', () => {
    render(
      withClient(<Sidebar />, {
        sessions: [
          mkSession({ id: 'a', number: 1, status: 'running' }),
          mkSession({ id: 'b', number: 2, status: 'ready' }),
          mkSession({ id: 'c', number: 3, status: 'failed' }),
        ],
      }),
    )
    expect(screen.getByText(/Running/)).toBeInTheDocument()
    expect(screen.getByText(/Ready/)).toBeInTheDocument()
    expect(screen.getByText(/Failed/)).toBeInTheDocument()
  })
})
