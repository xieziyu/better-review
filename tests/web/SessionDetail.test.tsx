import type { Finding, PRSession, SSEEvent } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, it, expect, vi } from 'vitest'

import { SelectionProvider } from '@/lib/selection'
import { SessionDetail } from '@/pages/SessionDetail'

function withRoute(
  ui: React.ReactNode,
  initial?: {
    session?: PRSession
    findings?: Finding[]
    diff?: string | null
    // Seed for the global ['sessions'] query so SessionDetail can compute
    // round-number and orphan-archived state without a real fetch.
    allSessions?: PRSession[]
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
  if (initial?.allSessions !== undefined) {
    qc.setQueryData(['sessions'], initial.allSessions)
  }
  return (
    <QueryClientProvider client={qc}>
      <SelectionProvider>
        <MemoryRouter initialEntries={[`/session/${initial?.session?.id ?? 'x'}`]}>
          <Routes>
            <Route path="/session/:id" element={ui} />
          </Routes>
        </MemoryRouter>
      </SelectionProvider>
    </QueryClientProvider>
  )
}

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="prompt-location">{`${loc.pathname}${loc.search}`}</div>
}

const session: PRSession = {
  id: 's1',
  source: { kind: 'github-pr', owner: 'acme', repo: 'web', number: 42 },
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
  category: 'Type Safety',
  file: 'src/x.ts',
  line: 1,
  title: 'Test finding',
  body: 'body',
  selected: true,
  edited: false,
  archived: false,
  createdAt: 0,
  source: 'agent',
  submittedAt: null,
  submittedCommentId: null,
}

describe('SessionDetail', () => {
  it('renders header with PR title and metadata', () => {
    render(withRoute(<SessionDetail />, { session, findings: [finding] }))
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
    render(withRoute(<SessionDetail />, { session, findings: [{ ...finding, selected: false }] }))
    const submit = screen.getByRole('button', { name: /Submit/i })
    expect(submit).toBeDisabled()
  })

  it('shows submit button enabled when selections exist', () => {
    render(withRoute(<SessionDetail />, { session, findings: [finding] }))
    expect(screen.getByRole('button', { name: /Submit/i })).not.toBeDisabled()
  })

  it('renders the local repo path chip when the session has one', () => {
    render(
      withRoute(<SessionDetail />, {
        session: { ...session, localRepoPath: '/Users/me/code/web' },
        findings: [finding],
      }),
    )
    expect(screen.getByLabelText(/Local repo: \/Users\/me\/code\/web/)).toBeInTheDocument()
    expect(screen.getByText('/Users/me/code/web')).toBeInTheDocument()
  })

  it('omits the local repo chip when the session has none', () => {
    render(withRoute(<SessionDetail />, { session, findings: [finding] }))
    expect(screen.queryByLabelText(/Local repo:/)).not.toBeInTheDocument()
  })

  // Renders the prompt-editor destination so navigation is observable as text.
  function renderWithPromptProbe(s: PRSession) {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    qc.setQueryData(['session', s.id], { session: s, findings: [] })
    qc.setQueryData(['session', s.id, 'diff'], null)
    return render(
      <QueryClientProvider client={qc}>
        <SelectionProvider>
          <MemoryRouter initialEntries={[`/session/${s.id}`]}>
            <Routes>
              <Route path="/session/:id" element={<SessionDetail />} />
              <Route path="/prompt" element={<LocationProbe />} />
            </Routes>
          </MemoryRouter>
        </SelectionProvider>
      </QueryClientProvider>,
    )
  }

  it('Prompt rules button jumps to the prompt editor carrying the repo', async () => {
    const user = userEvent.setup()
    renderWithPromptProbe({ ...session, localRepoPath: '/Users/me/code/web' })
    await user.click(screen.getByRole('button', { name: /^prompt$/i }))
    expect(screen.getByTestId('prompt-location')).toHaveTextContent(
      `/prompt?repo=${encodeURIComponent('/Users/me/code/web')}`,
    )
  })

  it('Prompt rules button jumps without a repo param when none is pinned', async () => {
    const user = userEvent.setup()
    renderWithPromptProbe(session)
    await user.click(screen.getByRole('button', { name: /^prompt$/i }))
    expect(screen.getByTestId('prompt-location')).toHaveTextContent(/^\/prompt$/)
  })

  it('renders session error banner when present', () => {
    render(
      withRoute(<SessionDetail />, {
        session: { ...session, status: 'failed', error: 'claude crashed' },
        findings: [],
      }),
    )
    expect(screen.getByText(/claude crashed/)).toBeInTheDocument()
  })

  describe('failed recovery', () => {
    const failed: PRSession = { ...session, status: 'failed', error: 'agent stalled' }

    it('renders the recovery card with Retry and Rerun in the findings tab', () => {
      render(withRoute(<SessionDetail />, { session: failed, findings: [] }))
      expect(screen.getByText('Run did not finish')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^Retry$/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^Rerun$/i })).toBeInTheDocument()
    })

    it('keeps Retry out of the top action bar (single Retry affordance)', () => {
      render(withRoute(<SessionDetail />, { session: failed, findings: [] }))
      expect(screen.getAllByRole('button', { name: /^Retry$/i })).toHaveLength(1)
    })

    it('POSTs /api/sessions/:id/retry when Retry is clicked', async () => {
      const user = userEvent.setup()
      const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(async (url, init) => {
        void init
        const u = String(url)
        if (u === '/api/sessions/s1/retry') {
          return new Response(JSON.stringify({ id: 's1' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        // The retry mutation invalidates the session-detail query, forcing a
        // refetch — answer it with a valid payload so the page can re-render.
        if (u === '/api/sessions/s1') {
          return new Response(JSON.stringify({ session: failed, findings: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        if (u === '/api/health') {
          return new Response(
            JSON.stringify({
              ok: true,
              defaultAgent: 'claude',
              agents: {
                codex: { found: true },
                claude: { found: true },
                pi: { found: true },
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      })
      render(withRoute(<SessionDetail />, { session: failed, findings: [] }))
      await user.click(screen.getByRole('button', { name: /^Retry$/i }))
      await vi.waitFor(() => {
        const retryCall = fetchSpy.mock.calls.find(
          ([u, callInit]) =>
            String(u) === '/api/sessions/s1/retry' &&
            (callInit as RequestInit | undefined)?.method === 'POST',
        )
        expect(retryCall).toBeDefined()
      })
    })

    it('still surfaces the recovery card when the failed run produced findings', () => {
      render(withRoute(<SessionDetail />, { session: failed, findings: [finding] }))
      expect(screen.getByText('Run did not finish')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^Retry$/i })).toBeInTheDocument()
      expect(screen.getByText('Test finding')).toBeInTheDocument()
    })
  })

  it('shows passive submitted line when status=submitted', () => {
    render(
      withRoute(<SessionDetail />, {
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
        withRoute(<SessionDetail />, {
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
      render(withRoute(<SessionDetail />, { session: running, findings: [] }))
      const strip = screen.getByRole('status', { name: /Review run progress/i })
      expect(strip).toBeInTheDocument()
      expect(within(strip).getByText('Reviewing')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Toggle transcript drawer/i })).toBeInTheDocument()
    })

    it('renders RunStrip in Review mode once the agent finishes', () => {
      // Default fixture session is status:'ready' — agent done, awaiting submit.
      render(withRoute(<SessionDetail />, { session, findings: [finding] }))
      const strip = screen.getByRole('status', { name: /Review run progress/i })
      expect(within(strip).getByText('Review')).toBeInTheDocument()
    })

    it('hides RunStrip once the session has terminally settled', () => {
      const submitted: PRSession = { ...session, status: 'submitted' }
      render(withRoute(<SessionDetail />, { session: submitted, findings: [finding] }))
      expect(screen.queryByRole('status', { name: /Review run progress/i })).not.toBeInTheDocument()
    })
  })

  describe('delete', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('renders a Delete session button', () => {
      render(withRoute(<SessionDetail />, { session, findings: [finding] }))
      expect(screen.getByRole('button', { name: /Delete session/i })).toBeInTheDocument()
    })

    it('issues DELETE /api/sessions/:id when confirmed', async () => {
      const user = userEvent.setup()
      const fetchSpy = vi
        .spyOn(window, 'fetch')
        .mockResolvedValue(new Response(null, { status: 204 }))
      render(withRoute(<SessionDetail />, { session, findings: [finding] }))
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
        withRoute(<SessionDetail />, {
          session: { ...session, extraPrompt: 'see PRD section 4 — focus on async path' },
          findings: [finding],
        }),
      )
      expect(screen.getByRole('button', { name: /Toggle extra context/i })).toBeInTheDocument()
      expect(screen.getByText(/see PRD section 4/i)).toBeInTheDocument()
    })

    it('hides the extra-context affordance label when the session has none', () => {
      render(withRoute(<SessionDetail />, { session, findings: [finding] }))
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
                pi: { found: true, path: '/usr/bin/pi' },
              },
              gh: { found: true, authed: true },
              fs: { folderPicker: { supported: false } },
              daemon: { pid: 1, port: 1, startedAt: 0, version: '0.0.0' },
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
        withRoute(<SessionDetail />, {
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
      render(withRoute(<SessionDetail />, { session, findings: [finding] }))
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

  describe('archived (historical) view', () => {
    const archivedSession: PRSession = { ...session, status: 'archived' }
    const archivedFinding: Finding = { ...finding, archived: true }

    it('renders historical findings even though all rows are archived', async () => {
      const user = userEvent.setup()
      render(
        withRoute(<SessionDetail />, { session: archivedSession, findings: [archivedFinding] }),
      )
      // Page lands on Files changed by default — switch to Findings to see
      // the list. The archived row would normally be filtered, but historical
      // sessions surface every entry.
      await user.click(screen.getByRole('tab', { name: /Findings/i }))
      expect(screen.getByText('Test finding')).toBeInTheDocument()
    })

    it('shows the historical banner', () => {
      render(
        withRoute(<SessionDetail />, { session: archivedSession, findings: [archivedFinding] }),
      )
      expect(screen.getByText(/Historical view/i)).toBeInTheDocument()
    })

    it('hides Submit and Rerun buttons', () => {
      render(
        withRoute(<SessionDetail />, { session: archivedSession, findings: [archivedFinding] }),
      )
      expect(screen.queryByRole('button', { name: /^Submit/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Rerun$/i })).not.toBeInTheDocument()
    })

    it('keeps the Delete session button available', () => {
      render(
        withRoute(<SessionDetail />, { session: archivedSession, findings: [archivedFinding] }),
      )
      expect(screen.getByRole('button', { name: /Delete session/i })).toBeInTheDocument()
    })

    it('hides the extra-context add affordance', () => {
      render(
        withRoute(<SessionDetail />, { session: archivedSession, findings: [archivedFinding] }),
      )
      expect(
        screen.queryByRole('button', { name: /Add extra context for rerun/i }),
      ).not.toBeInTheDocument()
    })

    describe('orphan archived (no live head for this PR)', () => {
      // allSessions contains only the archived row — no non-archived sibling.
      // This is the "previous rerun failed before inserting the replacement"
      // case the server allows recovering from.
      it('restores the Rerun button so the user can recover', () => {
        render(
          withRoute(<SessionDetail />, {
            session: archivedSession,
            findings: [archivedFinding],
            allSessions: [archivedSession],
          }),
        )
        expect(screen.getByRole('button', { name: /^Rerun$/i })).toBeInTheDocument()
      })

      it('shows the orphan banner instead of the historical-replacement banner', () => {
        render(
          withRoute(<SessionDetail />, {
            session: archivedSession,
            findings: [archivedFinding],
            allSessions: [archivedSession],
          }),
        )
        expect(screen.getByText(/no replacement run was created/i)).toBeInTheDocument()
        expect(screen.queryByText(/replaced by a newer run/i)).not.toBeInTheDocument()
      })

      it('still hides Submit even when Rerun is restored', () => {
        render(
          withRoute(<SessionDetail />, {
            session: archivedSession,
            findings: [archivedFinding],
            allSessions: [archivedSession],
          }),
        )
        expect(screen.queryByRole('button', { name: /^Submit/i })).not.toBeInTheDocument()
      })

      it('keeps Rerun hidden when a live head exists for the same PR', () => {
        const liveHead: PRSession = { ...session, id: 's2', status: 'ready' }
        render(
          withRoute(<SessionDetail />, {
            session: archivedSession,
            findings: [archivedFinding],
            allSessions: [archivedSession, liveHead],
          }),
        )
        expect(screen.queryByRole('button', { name: /^Rerun$/i })).not.toBeInTheDocument()
      })
    })
  })
})
