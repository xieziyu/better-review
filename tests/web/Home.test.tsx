import type { PRSession } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { Home } from '@/pages/Home'

function withClient(ui: React.ReactNode, sessions: PRSession[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['sessions'], sessions)
  qc.setQueryData(['health'], {
    ok: true,
    defaultAgent: 'claude',
    agents: {
      claude: { found: true, path: '/usr/bin/claude' },
      codex: { found: true, path: '/usr/bin/codex' },
    },
  })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

const session: PRSession = {
  id: 's1',
  owner: 'acme',
  repo: 'api',
  number: 7,
  title: 'fix(auth): tighten JWT verification',
  author: 'alice',
  url: null,
  baseRef: null,
  headRef: null,
  status: 'ready',
  createdAt: 0,
  updatedAt: Date.now(),
  agent: 'claude',
  workdir: '',
  promptUsed: '',
  error: null,
}

describe('Home', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  it('renders the welcome hero with input and start button', () => {
    render(withClient(<Home />))
    expect(screen.getByRole('heading', { name: /Review GitHub PRs/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/PR target/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Start review/i })).toBeInTheDocument()
  })

  it('shows recent session card when sessions exist', () => {
    render(withClient(<Home />, [session]))
    expect(screen.getByText(/fix\(auth\): tighten JWT verification/)).toBeInTheDocument()
    expect(screen.getByText(/acme\/api/)).toBeInTheDocument()
  })

  it('disables submit button when input is blank', () => {
    render(withClient(<Home />))
    const btn = screen.getByRole('button', { name: /Start review/i })
    expect(btn).toBeDisabled()
  })

  it('enables submit once input is non-empty', () => {
    render(withClient(<Home />))
    const btn = screen.getByRole('button', { name: /Start review/i })
    const input = screen.getByLabelText(/PR target/i)
    fireEvent.change(input, { target: { value: '123' } })
    expect(btn).not.toBeDisabled()
  })

  it('marks the default agent with parenthesized copy', () => {
    render(withClient(<Home />))
    expect(screen.getByRole('button', { name: /claude \(default\)/i })).toBeInTheDocument()
  })
})
