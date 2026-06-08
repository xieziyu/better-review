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
  source: { kind: 'github-pr', owner: 'acme', repo: 'web', number: 42 },
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
  reviewSummary: null,
  excludedFiles: [],
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

  it('shows each session status label', () => {
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

  it('renders PR, local-branch, and vbranch sessions in one flat list', () => {
    const pr = mkSession({ id: 'p', number: 7, title: 'pr-title' })
    const local = mkSession({
      id: 'l',
      title: 'local-title',
      source: { kind: 'local-branch', repoPath: '/u/me/foo', head: 'feat', base: 'main' },
      owner: '',
      repo: '',
      number: 0,
    })
    const vbranch = mkSession({
      id: 'v',
      title: 'vbranch-title',
      source: {
        kind: 'gitbutler-vbranch',
        repoPath: '/u/me/bar',
        vbranchName: 'feat-vb',
        base: 'sha',
      },
      owner: '',
      repo: '',
      number: 0,
    })
    render(withClient(<Sidebar />, { sessions: [pr, local, vbranch] }))
    // No PR/Local structural sections any more — all three live in one stream.
    expect(screen.queryByText(/Pull requests/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Local repos/i)).not.toBeInTheDocument()
    expect(screen.getByText('pr-title')).toBeInTheDocument()
    expect(screen.getByText('local-title')).toBeInTheDocument()
    expect(screen.getByText('vbranch-title')).toBeInTheDocument()
  })

  it('orders sessions by most-recent activity, newest first', () => {
    const older = mkSession({ id: 'o', number: 1, title: 'older one', updatedAt: 1000 })
    const newer = mkSession({ id: 'n', number: 2, title: 'newer one', updatedAt: 5000 })
    // Pass in stale-first order to prove the component sorts, not the input.
    render(withClient(<Sidebar />, { sessions: [older, newer] }))
    const newerEl = screen.getByText('newer one')
    const olderEl = screen.getByText('older one')
    expect(newerEl.compareDocumentPosition(olderEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('groups sessions under a recency bucket header', () => {
    const today = mkSession({ id: 't', number: 1, title: 'fresh', updatedAt: Date.now() })
    render(withClient(<Sidebar />, { sessions: [today] }))
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('fresh')).toBeInTheDocument()
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

describe('Sidebar collapse', () => {
  it('toggles to a rail and back via the divider chevron', async () => {
    const user = userEvent.setup()
    render(
      withClient(<Sidebar />, { sessions: [mkSession({ title: 'visible only when expanded' })] }),
    )
    expect(screen.getByText('visible only when expanded')).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' })
    await user.click(toggle)
    expect(screen.queryByText('visible only when expanded')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /new review/i })).toHaveAttribute('href', '/')
    expect(window.localStorage.getItem('better-review:sidebar-collapsed:v1')).toBe('1')
    const expandToggle = screen.getByRole('button', { name: 'Expand sidebar' })
    await user.click(expandToggle)
    expect(screen.getByText('visible only when expanded')).toBeInTheDocument()
    expect(window.localStorage.getItem('better-review:sidebar-collapsed:v1')).toBe('0')
  })

  it('restores collapsed state from localStorage on mount', () => {
    window.localStorage.setItem('better-review:sidebar-collapsed:v1', '1')
    render(withClient(<Sidebar />, { sessions: [mkSession({ title: 'should be hidden' })] }))
    expect(screen.queryByText('should be hidden')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
  })

  it('rail search button expands the sidebar and focuses the search input', async () => {
    window.localStorage.setItem('better-review:sidebar-collapsed:v1', '1')
    const user = userEvent.setup()
    render(withClient(<Sidebar />, { sessions: [mkSession()] }))
    const searchButton = screen.getByRole('button', { name: /expand sidebar and search/i })
    await user.click(searchButton)
    const input = screen.getByRole('textbox', { name: /search sessions/i })
    expect(input).toHaveFocus()
  })

  it('renders the running badge in the rail only when at least one session is running', () => {
    window.localStorage.setItem('better-review:sidebar-collapsed:v1', '1')
    const { unmount } = render(
      withClient(<Sidebar />, {
        sessions: [
          mkSession({ id: 'a', status: 'ready' }),
          mkSession({ id: 'b', status: 'submitted' }),
        ],
      }),
    )
    expect(screen.queryByLabelText(/running:/i)).not.toBeInTheDocument()
    unmount()
    render(
      withClient(<Sidebar />, {
        sessions: [
          mkSession({ id: 'a', status: 'running' }),
          mkSession({ id: 'b', status: 'running' }),
          mkSession({ id: 'c', status: 'ready' }),
        ],
      }),
    )
    expect(screen.getByLabelText(/running: 2/i)).toBeInTheDocument()
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
