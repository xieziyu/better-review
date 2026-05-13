import type { PRSession } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach } from 'vitest'

import { Sidebar, matchesSearch } from '@/components/Sidebar'

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
  extraPrompt: null,
  headSha: null,
  error: null,
  ...overrides,
})

beforeEach(() => {
  window.localStorage.clear()
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

  it('filters sessions by search query (title)', async () => {
    const user = userEvent.setup()
    render(
      withClient(<Sidebar />, {
        sessions: [
          mkSession({ id: 'a', number: 1, title: 'feat: add login' }),
          mkSession({ id: 'b', number: 2, title: 'fix: signup crash' }),
        ],
      }),
    )
    const search = screen.getByRole('textbox', { name: /search sessions/i })
    await user.type(search, 'signup')
    expect(screen.queryByText('feat: add login')).not.toBeInTheDocument()
    expect(screen.getByText('fix: signup crash')).toBeInTheDocument()
  })

  it('filters sessions by PR number (bare digits)', async () => {
    const user = userEvent.setup()
    render(
      withClient(<Sidebar />, {
        sessions: [
          mkSession({ id: 'a', number: 100, title: 'one' }),
          mkSession({ id: 'b', number: 412, title: 'two' }),
        ],
      }),
    )
    const search = screen.getByRole('textbox', { name: /search sessions/i })
    await user.type(search, '412')
    expect(screen.queryByText('one')).not.toBeInTheDocument()
    expect(screen.getByText('two')).toBeInTheDocument()
  })

  it('toggling a status chip hides that group', async () => {
    const user = userEvent.setup()
    render(
      withClient(<Sidebar />, {
        sessions: [
          mkSession({ id: 'a', number: 1, status: 'running', title: 'live one' }),
          mkSession({ id: 'b', number: 2, status: 'ready', title: 'done one' }),
        ],
      }),
    )
    expect(screen.getByText('live one')).toBeInTheDocument()
    const activeChip = screen.getByRole('button', { name: /active/i, pressed: true })
    await user.click(activeChip)
    expect(screen.queryByText('live one')).not.toBeInTheDocument()
    expect(screen.getByText('done one')).toBeInTheDocument()
  })

  it('shows the no-match empty state when filter excludes everything', async () => {
    const user = userEvent.setup()
    render(
      withClient(<Sidebar />, {
        sessions: [mkSession({ id: 'a', number: 1, title: 'only one' })],
      }),
    )
    const search = screen.getByRole('textbox', { name: /search sessions/i })
    await user.type(search, 'zzz-nothing-matches')
    expect(screen.getByText(/nothing matches the current filter/i)).toBeInTheDocument()
  })
})

describe('matchesSearch', () => {
  const s = (overrides: Partial<PRSession>): PRSession => mkSession(overrides)

  it('returns true for an empty query', () => {
    expect(matchesSearch(s({}), '')).toBe(true)
    expect(matchesSearch(s({}), '   ')).toBe(true)
  })

  it('matches PR number with and without leading #', () => {
    const session = s({ number: 412 })
    expect(matchesSearch(session, '412')).toBe(true)
    expect(matchesSearch(session, '#412')).toBe(true)
    expect(matchesSearch(session, '41')).toBe(true)
    expect(matchesSearch(session, '99')).toBe(false)
  })

  it('matches title, owner/repo, and author case-insensitively', () => {
    const session = s({
      owner: 'Acme',
      repo: 'Web',
      title: 'Feat: redesign Sidebar',
      author: 'Alice',
    })
    expect(matchesSearch(session, 'sidebar')).toBe(true)
    expect(matchesSearch(session, 'acme/web')).toBe(true)
    expect(matchesSearch(session, 'ACME/WEB#42')).toBe(true)
    expect(matchesSearch(session, 'alice')).toBe(true)
    expect(matchesSearch(session, 'bob')).toBe(false)
  })
})
