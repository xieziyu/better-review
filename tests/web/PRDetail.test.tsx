import type { Finding, PRSession, SSEEvent } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
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

  describe('agent output streaming', () => {
    type Listener = (ev: MessageEvent) => void
    interface RecordingEventSource {
      url: string
      listeners: Map<string, Set<Listener>>
      addEventListener: (type: string, l: Listener) => void
      removeEventListener: (type: string, l: Listener) => void
      close: () => void
      dispatch: (ev: SSEEvent) => void
    }
    let live: RecordingEventSource | null = null
    const original = globalThis.EventSource

    function install() {
      class Recording {
        url: string
        listeners = new Map<string, Set<Listener>>()
        constructor(url: string) {
          this.url = url
          live = this as unknown as RecordingEventSource
        }
        addEventListener(type: string, l: Listener) {
          let set = this.listeners.get(type)
          if (!set) {
            set = new Set()
            this.listeners.set(type, set)
          }
          set.add(l)
        }
        removeEventListener(type: string, l: Listener) {
          this.listeners.get(type)?.delete(l)
        }
        close() {}
        dispatch(ev: SSEEvent) {
          const set = this.listeners.get(ev.type)
          if (!set) return
          const message = new MessageEvent(ev.type, { data: JSON.stringify(ev) })
          set.forEach((l) => l(message))
        }
      }
      // @ts-expect-error -- jsdom global override
      globalThis.EventSource = Recording
    }

    afterEach(() => {
      // @ts-expect-error -- restore
      globalThis.EventSource = original
      live = null
    })

    it('renders agent-output chunks streamed over SSE', () => {
      install()
      const running: PRSession = { ...session, status: 'running' }
      render(withRoute(<PRDetail />, { session: running, findings: [] }))

      expect(live).not.toBeNull()
      act(() => {
        live!.dispatch({
          type: 'agent-output',
          sessionId: running.id,
          chunk: 'system: init (model=claude-opus-4-7)',
          ts: Date.now(),
        })
        live!.dispatch({
          type: 'agent-output',
          sessionId: running.id,
          chunk: 'Reading the diff…',
          ts: Date.now(),
        })
      })

      expect(screen.getByRole('log')).toHaveTextContent('system: init (model=claude-opus-4-7)')
      expect(screen.getByRole('log')).toHaveTextContent('Reading the diff…')
    })
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
      const fetchSpy = vi
        .spyOn(window, 'fetch')
        .mockResolvedValue(new Response(null, { status: 204 }))
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
