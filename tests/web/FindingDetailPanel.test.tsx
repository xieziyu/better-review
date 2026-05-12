import type { Finding, PRSession } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { FindingDetailPanel } from '@/components/FindingDetailPanel'
import { SelectionProvider, useSubmitDrawer } from '@/lib/selection'

function withProviders(ui: React.ReactNode) {
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
  number: 42,
  title: 'feat: x',
  author: 'alice',
  url: 'https://github.com/acme/web/pull/42',
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
  line: 42,
  title: 'Verify JWT signature',
  body: 'The helper accepts a token and decodes without verifying.',
  suggestion: 'jwt.verify(token, secret)',
  selected: true,
  edited: false,
  archived: false,
  createdAt: 0,
}

describe('FindingDetailPanel', () => {
  it('renders the finding title, severity, body, and suggestion in read mode', () => {
    render(
      withProviders(<FindingDetailPanel finding={finding} session={session} unifiedDiff={null} />),
    )
    expect(
      screen.getByRole('heading', { level: 2, name: /Verify JWT signature/ }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/severity: must/i)).toBeInTheDocument()
    expect(screen.getByText(/decodes without verifying/)).toBeInTheDocument()
    expect(screen.getByText(/jwt\.verify/)).toBeInTheDocument()
  })

  it('renders Edit, Discard, and Submit CTAs at the bottom', () => {
    render(
      withProviders(<FindingDetailPanel finding={finding} session={session} unifiedDiff={null} />),
    )
    expect(screen.getByRole('button', { name: /submit review/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /discard/i })).toBeInTheDocument()
  })

  it('switches to edit mode when Edit is clicked', async () => {
    const user = userEvent.setup()
    render(
      withProviders(<FindingDetailPanel finding={finding} session={session} unifiedDiff={null} />),
    )
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    expect(screen.getByRole('textbox', { name: /Title/i })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Body/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Save$/i })).toBeInTheDocument()
  })

  it('clicking Submit opens the submit drawer through context', async () => {
    const user = userEvent.setup()
    function Probe() {
      const drawer = useSubmitDrawer()
      return <div data-testid="drawer-state">{drawer.isOpen ? 'open' : 'closed'}</div>
    }
    render(
      withProviders(
        <>
          <FindingDetailPanel finding={finding} session={session} unifiedDiff={null} />
          <Probe />
        </>,
      ),
    )
    expect(screen.getByTestId('drawer-state').textContent).toBe('closed')
    await user.click(screen.getByRole('button', { name: /submit review/i }))
    expect(screen.getByTestId('drawer-state').textContent).toBe('open')
  })

  it('shows "No suggestion provided." when the finding has no suggestion', () => {
    render(
      withProviders(
        <FindingDetailPanel
          finding={{ ...finding, suggestion: null }}
          session={session}
          unifiedDiff={null}
        />,
      ),
    )
    expect(screen.getByText(/no suggestion provided/i)).toBeInTheDocument()
  })

  it('PATCHes /api/findings/:id when Save is clicked', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ...finding, title: 'Updated title' }),
    })
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    render(
      withProviders(<FindingDetailPanel finding={finding} session={session} unifiedDiff={null} />),
    )
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    const titleInput = screen.getByRole('textbox', { name: /Title/i })
    await user.clear(titleInput)
    await user.type(titleInput, 'Updated title')
    await user.click(screen.getByRole('button', { name: /^Save$/i }))
    const calls = fetchSpy.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const last = calls[calls.length - 1]!
    expect(String(last[0])).toContain('/api/findings/d1')
    expect((last[1] as RequestInit).method).toBe('PATCH')
  })
})
