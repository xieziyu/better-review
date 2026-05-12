import type { Finding, PRSession, SSEEvent } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, it, expect, vi } from 'vitest'

import { SelectionProvider } from '@/lib/selection'
import { PRDetail } from '@/pages/PRDetail'

function withRoute(
  ui: React.ReactNode,
  initial?: {
    session?: PRSession
    findings?: Finding[]
    diff?: string | null
  },
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
      <SelectionProvider>
        <MemoryRouter initialEntries={[`/pr/${initial?.session?.id ?? 'x'}`]}>
          <Routes>
            <Route path="/pr/:id" element={ui} />
          </Routes>
        </MemoryRouter>
      </SelectionProvider>
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
  localRepoPath: null,
  sourceKind: null,
  sourceRefName: null,
  promptUsed: '',
  extraPrompt: null,
  headSha: null,
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
    expect(screen.getByLabelText('acme/web#42')).toBeInTheDocument()
    expect(screen.getByText(/@alice/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open pr on github/i })).toHaveAttribute(
      'href',
      session.url,
    )
    expect(screen.queryByText(/^agent:/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/ran with/i)).not.toBeInTheDocument()
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

  it('renders the local repo path chip when the session has one', () => {
    render(
      withRoute(<PRDetail />, {
        session: { ...session, localRepoPath: '/Users/me/code/web' },
        findings: [finding],
      }),
    )
    expect(screen.getByLabelText(/Local repo: \/Users\/me\/code\/web/)).toBeInTheDocument()
    expect(screen.getByText('/Users/me/code/web')).toBeInTheDocument()
  })

  it('omits the local repo chip when the session has none', () => {
    render(withRoute(<PRDetail />, { session, findings: [finding] }))
    expect(screen.queryByLabelText(/Local repo:/)).not.toBeInTheDocument()
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
      globalThis.EventSource = original
      live = null
    })

    it('renders agent-output chunks streamed over SSE into the transcript drawer', () => {
      install()
      // The transcript drawer is collapsed by default; open it before mount so
      // the drawer body (and its <log> region) is in the DOM for this test.
      window.localStorage.setItem('better-review:transcript-drawer:open:v1', '1')
      const running: PRSession = { ...session, status: 'running' }
      render(
        withRoute(<PRDetail />, {
          session: running,
          findings: [],
        }),
      )

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
      window.localStorage.removeItem('better-review:transcript-drawer:open:v1')
    })

    it('shows RunStrip while running with elapsed clock and transcript toggle', () => {
      const running: PRSession = { ...session, status: 'running' }
      render(withRoute(<PRDetail />, { session: running, findings: [] }))
      const strip = screen.getByRole('status', { name: /Review run progress/i })
      expect(strip).toBeInTheDocument()
      expect(within(strip).getByText('Reviewing')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Toggle transcript drawer/i })).toBeInTheDocument()
    })

    it('does not render RunStrip once the session has settled', () => {
      render(withRoute(<PRDetail />, { session, findings: [finding] }))
      expect(screen.queryByRole('status', { name: /Review run progress/i })).not.toBeInTheDocument()
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
      const user = userEvent.setup()
      const fetchSpy = vi
        .spyOn(window, 'fetch')
        .mockResolvedValue(new Response(null, { status: 204 }))
      render(withRoute(<PRDetail />, { session, findings: [finding] }))
      await user.click(screen.getByRole('button', { name: /Delete session/i }))
      const dialog = screen.getByRole('dialog', { name: /Delete this session/i })
      await user.click(within(dialog).getByRole('button', { name: /^Delete$/i }))
      await vi.waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          '/api/sessions/s1',
          expect.objectContaining({ method: 'DELETE' }),
        )
      })
    })

    it('shows the existing extraPrompt as a collapsible panel when the session has one', () => {
      render(
        withRoute(<PRDetail />, {
          session: { ...session, extraPrompt: 'see PRD section 4 — focus on async path' },
          findings: [finding],
        }),
      )
      expect(screen.getByRole('button', { name: /Toggle extra context/i })).toBeInTheDocument()
      expect(screen.getByText(/see PRD section 4/i)).toBeInTheDocument()
    })

    it('hides the extra-context affordance label when the session has none', () => {
      render(withRoute(<PRDetail />, { session, findings: [finding] }))
      expect(
        screen.getByRole('button', { name: /Add extra context for rerun/i }),
      ).toBeInTheDocument()
    })

    it('sends the edited extraPrompt on rerun', async () => {
      const user = userEvent.setup()
      const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(async (url, init) => {
        void init
        const u = String(url)
        if (u === '/api/health') {
          return new Response(
            JSON.stringify({
              ok: true,
              defaultAgent: 'claude',
              agents: {
                claude: { found: true, path: '/usr/bin/claude' },
                codex: { found: true, path: '/usr/bin/codex' },
              },
              gh: { found: true, authed: true },
              fs: { folderPicker: { supported: false } },
              daemon: { pid: 1, port: 1, startedAt: 0 },
            }),
            { status: 200 },
          )
        }
        if (u === '/api/sessions/s1/rerun') {
          return new Response(JSON.stringify({ id: 'fresh-1' }), { status: 202 })
        }
        if (u === '/api/sessions/s1') {
          return new Response(
            JSON.stringify({
              session: { ...session, extraPrompt: 'old context' },
              findings: [finding],
            }),
            { status: 200 },
          )
        }
        if (u === '/api/sessions/fresh-1') {
          return new Response(
            JSON.stringify({ session: { ...session, id: 'fresh-1' }, findings: [] }),
            { status: 200 },
          )
        }
        if (u.endsWith('/diff')) {
          return new Response(JSON.stringify({ diff: null }), { status: 200 })
        }
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      })
      render(
        withRoute(<PRDetail />, {
          session: { ...session, extraPrompt: 'old context' },
          findings: [finding],
        }),
      )
      await user.click(screen.getByRole('button', { name: /Edit extra context for rerun/i }))
      const ta = screen.getByRole('textbox', { name: /^Extra context$/i })
      await user.clear(ta)
      await user.type(ta, 'new context')
      await user.click(screen.getByRole('button', { name: /^save$/i }))
      await user.click(screen.getByRole('button', { name: /^Rerun$/i }))
      await vi.waitFor(() => {
        const rerunCall = fetchSpy.mock.calls.find(
          ([u, callInit]) =>
            String(u) === '/api/sessions/s1/rerun' &&
            (callInit as RequestInit | undefined)?.method === 'POST',
        )
        expect(rerunCall).toBeDefined()
        const callInit = rerunCall![1] as RequestInit
        const body = JSON.parse(callInit.body as string) as { extraPrompt?: string }
        expect(body.extraPrompt).toBe('new context')
      })
    })

    it('skips delete when confirmation is dismissed', async () => {
      const user = userEvent.setup()
      const fetchSpy = vi.spyOn(window, 'fetch')
      render(withRoute(<PRDetail />, { session, findings: [finding] }))
      fetchSpy.mockClear()
      await user.click(screen.getByRole('button', { name: /Delete session/i }))
      const dialog = screen.getByRole('dialog', { name: /Delete this session/i })
      await user.click(within(dialog).getByRole('button', { name: /^Cancel$/i }))
      const deleteCalls = fetchSpy.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
      )
      expect(deleteCalls).toHaveLength(0)
    })
  })
})
