import type { PRSession } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
  localRepoPath: null,
  sourceKind: null,
  sourceRefName: null,
  promptUsed: '',
  extraPrompt: null,
  headSha: null,
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

  it('hides the extra-context textarea by default and reveals it on click', () => {
    render(withClient(<Home />))
    expect(screen.queryByRole('textbox', { name: /^Extra context$/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Add extra context/i }))
    expect(screen.getByRole('textbox', { name: /^Extra context$/i })).toBeInTheDocument()
  })

  it('sends extraPrompt in the createSession payload when filled', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/api/recent-repos')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 })
      }
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
      if (u === '/api/sessions' && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'new1' }), { status: 201 })
      }
      if (u === '/api/sessions') {
        return new Response('[]', { status: 200 })
      }
      return new Response('{}', { status: 200 })
    })
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
    render(withClient(<Home />))
    fireEvent.change(screen.getByLabelText(/PR target/i), {
      target: { value: 'https://github.com/o/r/pull/1' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Add extra context/i }))
    fireEvent.change(screen.getByRole('textbox', { name: /^Extra context$/i }), {
      target: { value: 'see PRD section 4' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Start review/i }))
    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([u, init]) =>
          String(u) === '/api/sessions' && (init as RequestInit | undefined)?.method === 'POST',
      )
      expect(postCall).toBeDefined()
    })
    const postCall = fetchMock.mock.calls.find(
      ([u, init]) =>
        String(u) === '/api/sessions' && (init as RequestInit | undefined)?.method === 'POST',
    )
    const body = JSON.parse(((postCall![1] as RequestInit).body as string) ?? '{}') as {
      extraPrompt?: string
    }
    expect(body.extraPrompt).toBe('see PRD section 4')
  })
})
