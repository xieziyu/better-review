import type { Finding, PRSession } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, it, expect, vi } from 'vitest'

import { PRDetail } from '@/pages/PRDetail'

function withRoute(
  ui: React.ReactNode,
  initial?: { session?: PRSession; findings?: Finding[]; diff?: string | null },
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  if (initial?.session) {
    qc.setQueryData(['session', initial.session.id], {
      session: initial.session,
      findings: initial.findings ?? [],
    })
    qc.setQueryData(['session', initial.session.id, 'diff'], initial.diff ?? null)
  }
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/pr/${initial?.session?.id ?? 'x'}`]}>
        <Routes>
          <Route path="/pr/:id" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const session: PRSession = {
  id: 's1',
  owner: 'acme',
  repo: 'web',
  number: 42,
  title: 'feat(auth): add JWT refresh token support',
  author: 'alice',
  url: 'https://github.com/acme/web/pull/42',
  baseRef: 'main',
  headRef: 'feature/x',
  status: 'ready',
  agent: 'claude',
  createdAt: 0,
  updatedAt: Date.now(),
  workdir: '',
  promptUsed: '',
  error: null,
}

const finding: Finding = {
  id: 'R1',
  dbId: 'd1',
  sessionId: 's1',
  ord: 1,
  severity: 'must',
  category: 'Type Safety',
  file: 'src/x.ts',
  line: 1,
  title: 'Test finding',
  body: 'body',
  selected: true,
  edited: false,
  archived: false,
  createdAt: 0,
}

describe('PRDetail', () => {
  it('renders header with PR title and metadata', () => {
    render(withRoute(<PRDetail />, { session, findings: [finding] }))
    expect(screen.getByRole('heading', { name: /feat\(auth\)/ })).toBeInTheDocument()
    expect(screen.getByText(/acme\/web#42/)).toBeInTheDocument()
    expect(screen.getByText(/@alice/)).toBeInTheDocument()
  })

  it('shows submit button disabled with selection count', () => {
    render(withRoute(<PRDetail />, { session, findings: [{ ...finding, selected: false }] }))
    const submit = screen.getByRole('button', { name: /Submit/i })
    expect(submit).toBeDisabled()
  })

  it('shows submit button enabled when selections exist', () => {
    render(withRoute(<PRDetail />, { session, findings: [finding] }))
    expect(screen.getByRole('button', { name: /Submit/i })).not.toBeDisabled()
  })

  it('renders session error banner when present', () => {
    render(
      withRoute(<PRDetail />, {
        session: { ...session, status: 'failed', error: 'claude crashed' },
        findings: [],
      }),
    )
    expect(screen.getByText(/claude crashed/)).toBeInTheDocument()
  })

  it('shows passive submitted line when status=submitted', () => {
    render(
      withRoute(<PRDetail />, {
        session: { ...session, status: 'submitted' },
        findings: [finding],
      }),
    )
    expect(screen.getByText(/Submitted to GitHub/i)).toBeInTheDocument()
  })

  describe('delete', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('renders a Delete session button', () => {
      render(withRoute(<PRDetail />, { session, findings: [finding] }))
      expect(screen.getByRole('button', { name: /Delete session/i })).toBeInTheDocument()
    })

    it('issues DELETE /api/sessions/:id when confirmed', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(
        new Response(null, { status: 204 }),
      )
      render(withRoute(<PRDetail />, { session, findings: [finding] }))
      fireEvent.click(screen.getByRole('button', { name: /Delete session/i }))
      await vi.waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          '/api/sessions/s1',
          expect.objectContaining({ method: 'DELETE' }),
        )
      })
    })

    it('skips delete when confirm is dismissed', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false)
      const fetchSpy = vi.spyOn(window, 'fetch')
      render(withRoute(<PRDetail />, { session, findings: [finding] }))
      fetchSpy.mockClear()
      fireEvent.click(screen.getByRole('button', { name: /Delete session/i }))
      const deleteCalls = fetchSpy.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
      )
      expect(deleteCalls).toHaveLength(0)
    })
  })
})
