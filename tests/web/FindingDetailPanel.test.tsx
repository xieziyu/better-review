import type { Finding, PRSession } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

// Replace CodeBlock with a transparent passthrough so tests don't pull Shiki's
// WASM under jsdom. The mock exposes the resolved props via data-* attributes
// so we can assert language plumbing.
vi.mock('@/components/CodeBlock', () => ({
  CodeBlock: ({
    code,
    lang,
    fallbackFile,
  }: {
    code: string
    lang?: string | null
    fallbackFile?: string | null
  }) => (
    <pre data-testid="codeblock" data-lang={lang ?? ''} data-fallback-file={fallbackFile ?? ''}>
      <code>{code}</code>
    </pre>
  ),
}))

import { FindingDetailPanel } from '@/components/FindingDetailPanel'
import { SelectionProvider } from '@/lib/selection'

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
  source: { kind: 'github-pr', owner: 'acme', repo: 'web', number: 42 },
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
  line: 42,
  title: 'Verify JWT signature',
  body: 'The helper accepts a token and decodes without verifying.',
  suggestion: 'jwt.verify(token, secret)',
  selected: true,
  edited: false,
  archived: false,
  createdAt: 0,
  source: 'agent',
  submittedAt: null,
  submittedCommentId: null,
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

  it('renders the include toggle, Edit, and Discard CTAs', () => {
    render(
      withProviders(<FindingDetailPanel finding={finding} session={session} unifiedDiff={null} />),
    )
    const toggle = screen.getByRole('button', { name: /unselect finding R1/i })
    expect(toggle).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(toggle).toHaveTextContent(/Included/i)
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /discard/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /submit review/i })).not.toBeInTheDocument()
  })

  it('shows "Include in review" label when the finding is not selected', () => {
    render(
      withProviders(
        <FindingDetailPanel
          finding={{ ...finding, selected: false }}
          session={session}
          unifiedDiff={null}
        />,
      ),
    )
    const toggle = screen.getByRole('button', { name: /select finding R1/i })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle).toHaveTextContent(/Include in review/i)
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

  it('PATCHes /api/findings/:id/select when the include toggle is clicked', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ...finding, selected: false }),
    })
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    render(
      withProviders(<FindingDetailPanel finding={finding} session={session} unifiedDiff={null} />),
    )
    await user.click(screen.getByRole('button', { name: /unselect finding R1/i }))
    const calls = fetchSpy.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const last = calls[calls.length - 1]!
    expect(String(last[0])).toContain('/api/findings/d1/select')
    const init = last[1] as RequestInit
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ selected: false })
  })

  it('shows "No suggestion provided." when the finding has no suggestion', () => {
    render(
      withProviders(
        <FindingDetailPanel
          finding={{ ...finding, suggestion: undefined }}
          session={session}
          unifiedDiff={null}
        />,
      ),
    )
    expect(screen.getByText(/no suggestion provided/i)).toBeInTheDocument()
  })

  it('passes the explicit fence language to CodeBlock for body code blocks', () => {
    render(
      withProviders(
        <FindingDetailPanel
          finding={{
            ...finding,
            body: 'See snippet:\n\n```python\nprint("ok")\n```',
          }}
          session={session}
          unifiedDiff={null}
        />,
      ),
    )
    const blocks = screen.getAllByTestId('codeblock')
    const bodyBlock = blocks.find((el) => el.textContent?.includes('print("ok")'))
    expect(bodyBlock).toBeDefined()
    expect(bodyBlock).toHaveAttribute('data-lang', 'python')
    expect(bodyBlock).toHaveAttribute('data-fallback-file', 'src/x.ts')
  })

  it('falls back to inferring language from finding.file when a fence has no language', () => {
    render(
      withProviders(
        <FindingDetailPanel
          finding={{
            ...finding,
            body: 'See snippet:\n\n```\nconst x = 1\n```',
          }}
          session={session}
          unifiedDiff={null}
        />,
      ),
    )
    const blocks = screen.getAllByTestId('codeblock')
    const bodyBlock = blocks.find((el) => el.textContent?.includes('const x = 1'))
    expect(bodyBlock).toBeDefined()
    // No explicit fence language → CodeBlock receives null; CodeBlock itself
    // will fall back to inferLangFromFile(fallbackFile) at runtime.
    expect(bodyBlock).toHaveAttribute('data-lang', '')
    expect(bodyBlock).toHaveAttribute('data-fallback-file', 'src/x.ts')
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
