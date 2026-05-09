import type { Finding, PRSession } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'

import { FindingCard } from '@/components/FindingCard'

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
  workdir: '/tmp/x',
  localRepoPath: null,
  sourceKind: null,
  sourceRefName: null,
  promptUsed: '',
  extraPrompt: null,
  error: null,
}

const baseFinding: Finding = {
  id: 'R1',
  dbId: 'db-1',
  sessionId: 's1',
  ord: 1,
  severity: 'must',
  category: 'Type Safety',
  file: 'src/x.ts',
  line: 42,
  title: "Don't trust unsigned JWT",
  body: 'The verifyJWT helper accepts a token and decodes without verifying the signature.',
  suggestion: 'jwt.verify(token, secret)',
  selected: true,
  edited: false,
  archived: false,
  createdAt: 0,
}

describe('FindingCard', () => {
  it('renders title, severity, ordinal, file:line in read mode', () => {
    render(withClient(<FindingCard finding={baseFinding} session={session} unifiedDiff={null} />))
    expect(screen.getByText(/Don't trust unsigned JWT/)).toBeInTheDocument()
    expect(screen.getByText(/must/i)).toBeInTheDocument()
    expect(screen.getByText('R1')).toBeInTheDocument()
    expect(screen.getByLabelText('src/x.ts:42')).toBeInTheDocument()
  })

  it('keeps basename and line number as non-truncated suffixes for long file paths', () => {
    const longPath =
      'apps/ai-agent-service/src/domains/episode-collection-copywriting/episode-collection-copywriting-processor.service.ts'
    render(
      withClient(
        <FindingCard
          finding={{ ...baseFinding, file: longPath, line: 847 }}
          session={session}
          unifiedDiff={null}
        />,
      ),
    )
    const location = screen.getByLabelText(`${longPath}:847`)
    expect(location).toHaveAttribute('title', `${longPath}:847`)
    expect(location.children[1]).toHaveClass('shrink-0')
    expect(location.children[1]).toHaveTextContent(
      'episode-collection-copywriting-processor.service.ts',
    )
    expect(location.lastElementChild).toHaveClass('shrink-0')
    expect(location.lastElementChild).toHaveTextContent(':847')
  })

  it('does not show body editor in read mode', () => {
    render(withClient(<FindingCard finding={baseFinding} session={session} unifiedDiff={null} />))
    expect(screen.queryByRole('textbox', { name: /body/i })).toBeNull()
  })

  it('enters edit mode when pencil button is clicked', async () => {
    const user = userEvent.setup()
    render(withClient(<FindingCard finding={baseFinding} session={session} unifiedDiff={null} />))
    await user.click(screen.getByRole('button', { name: /Edit/i }))
    expect(screen.getByRole('textbox', { name: /Body/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save/i })).toBeInTheDocument()
  })

  it("enters edit mode on 'e' keypress when card focused", async () => {
    const user = userEvent.setup()
    render(withClient(<FindingCard finding={baseFinding} session={session} unifiedDiff={null} />))
    const card = screen.getByRole('article')
    card.focus()
    await user.keyboard('e')
    expect(screen.getByRole('textbox', { name: /Body/i })).toBeInTheDocument()
  })

  it('does NOT trigger edit on double-click', () => {
    render(withClient(<FindingCard finding={baseFinding} session={session} unifiedDiff={null} />))
    const body = screen.getByText(/verifyJWT helper/)
    fireEvent.doubleClick(body)
    expect(screen.queryByRole('textbox', { name: /Body/i })).toBeNull()
  })

  it('shows pencil-edited indicator when finding.edited is true', () => {
    const edited: Finding = { ...baseFinding, edited: true }
    render(withClient(<FindingCard finding={edited} session={session} unifiedDiff={null} />))
    expect(screen.getByLabelText(/Edited/i)).toBeInTheDocument()
  })

  it("shows '(whole PR)' when file is null", () => {
    const fileless: Finding = { ...baseFinding, file: null, line: null }
    render(withClient(<FindingCard finding={fileless} session={session} unifiedDiff={null} />))
    expect(screen.getByText(/whole PR/i)).toBeInTheDocument()
  })

  it('severity selector only appears in edit mode', async () => {
    const user = userEvent.setup()
    render(withClient(<FindingCard finding={baseFinding} session={session} unifiedDiff={null} />))
    expect(screen.queryByRole('radio', { name: /must/i })).toBeNull()
    await user.click(screen.getByRole('button', { name: /Edit/i }))
    expect(screen.getByRole('radio', { name: /must/i })).toBeInTheDocument()
  })

  it('calls fetch with PATCH on Save click', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ...baseFinding, title: 'Updated title' }),
    })
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    render(withClient(<FindingCard finding={baseFinding} session={session} unifiedDiff={null} />))
    await user.click(screen.getByRole('button', { name: /Edit/i }))
    const titleInput = screen.getByRole('textbox', { name: /Title/i })
    await user.clear(titleInput)
    await user.type(titleInput, 'Updated title')
    await user.click(screen.getByRole('button', { name: /Save/i }))
    const calls = fetchSpy.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const last = calls[calls.length - 1]!
    expect(String(last[0])).toContain('/api/findings/db-1')
    expect((last[1] as RequestInit).method).toBe('PATCH')
  })
})
