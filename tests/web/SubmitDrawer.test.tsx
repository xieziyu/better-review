import type { Finding, PRSession } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'

import { SubmitDrawer } from '@/components/SubmitDrawer'

function withClient(
  ui: React.ReactNode,
  sessionId: string,
  data: { session: PRSession; findings: Finding[]; diff?: string | null },
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const { diff, ...sessionData } = data
  qc.setQueryData(['session', sessionId], sessionData)
  if (diff !== undefined) qc.setQueryData(['session', sessionId, 'diff'], diff)
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

const session: PRSession = {
  id: 's1',
  owner: 'acme',
  repo: 'web',
  number: 42,
  title: 'x',
  author: 'alice',
  url: 'https://github.com/acme/web/pull/42',
  baseRef: null,
  headRef: null,
  status: 'ready',
  agent: 'claude',
  createdAt: 0,
  updatedAt: 0,
  workdir: '',
  promptUsed: '',
  error: null,
}

const mk = (overrides: Partial<Finding>): Finding => ({
  id: 'R1',
  dbId: 'd1',
  sessionId: 's1',
  ord: 1,
  severity: 'must',
  category: 'C',
  file: 'src/x.ts',
  line: 10,
  title: 'title',
  body: 'body',
  selected: true,
  edited: false,
  archived: false,
  createdAt: 0,
  ...overrides,
})

describe('SubmitDrawer', () => {
  it('renders prepare step with event, body, and selected count', () => {
    const findings = [
      mk({ id: 'R1', dbId: 'd1', selected: true }),
      mk({ id: 'R2', dbId: 'd2', selected: false }),
      mk({ id: 'R3', dbId: 'd3', selected: true }),
    ]
    render(
      withClient(<SubmitDrawer sessionId="s1" onClose={() => {}} />, 's1', { session, findings }),
    )
    expect(screen.getByTestId('selection-summary')).toHaveTextContent(
      /2 findings selected of 3 total/i,
    )
    expect(screen.getByRole('radio', { name: /COMMENT/i })).toBeChecked()
    expect(screen.getByLabelText(/Review body/i)).toBeInTheDocument()
  })

  it('calls onClose when the backdrop is clicked', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      withClient(<SubmitDrawer sessionId="s1" onClose={onClose} />, 's1', {
        session,
        findings: [mk({})],
      }),
    )
    await user.click(screen.getByRole('button', { name: /Cancel/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('prefills body with PR-wide findings as a list', () => {
    render(
      withClient(<SubmitDrawer sessionId="s1" onClose={() => {}} />, 's1', {
        session,
        findings: [
          mk({ id: 'R1', dbId: 'd1', file: 'src/x.ts', line: 1 }),
          mk({
            id: 'R2',
            dbId: 'd2',
            file: null,
            line: null,
            title: 'Wider architectural concern',
            body: 'Consider splitting...',
          }),
        ],
      }),
    )
    const body = screen.getByLabelText(/Review body/i) as HTMLTextAreaElement
    expect(body.value).toMatch(/Wider architectural concern/)
    expect(body.value).toContain('🔴 **[must]**')
  })

  it('keeps selected inline comments visible while editing submit options', () => {
    render(
      withClient(<SubmitDrawer sessionId="s1" onClose={() => {}} />, 's1', {
        session,
        findings: [mk({ id: 'R1', dbId: 'd1', severity: 'should', title: 'inline title' })],
      }),
    )

    const inline = screen.getByTestId('inline-list')
    expect(inline).toHaveTextContent(/R1/)
    expect(inline).toHaveTextContent(/should/)
    expect(inline).toHaveTextContent(/Inline/)
    expect(inline).toHaveTextContent(/src\/x\.ts:10/)
    expect(inline).toHaveTextContent(/inline title/)
    expect(screen.getByLabelText(/Review body/i)).toBeInTheDocument()
  })

  it("groups findings whose line is outside the diff under 'moved to body'", () => {
    const diff = [
      'diff --git a/src/x.ts b/src/x.ts',
      '--- a/src/x.ts',
      '+++ b/src/x.ts',
      '@@ -1,2 +1,3 @@',
      ' a',
      '+b',
      ' c',
      '',
    ].join('\n')
    const findings = [
      mk({ id: 'R1', dbId: 'd1', file: 'src/x.ts', line: 2 }), // in diff
      mk({ id: 'R2', dbId: 'd2', file: 'src/x.ts', line: 999 }), // outside diff
    ]
    render(
      withClient(<SubmitDrawer sessionId="s1" onClose={() => {}} />, 's1', {
        session,
        findings,
        diff,
      }),
    )
    const moved = screen.getByTestId('moved-to-body-list')
    expect(moved).toHaveTextContent(/R2/)
    expect(moved).toHaveTextContent(/Body/)
    expect(moved).not.toHaveTextContent(/\bR1\b/)

    const inline = screen.getByTestId('inline-list')
    expect(inline).toHaveTextContent(/R1/)
    expect(inline).toHaveTextContent(/Inline/)
  })

  it('renders PR-wide findings as body preview cards', () => {
    render(
      withClient(<SubmitDrawer sessionId="s1" onClose={() => {}} />, 's1', {
        session,
        findings: [
          mk({
            id: 'R1',
            dbId: 'd1',
            file: null,
            line: null,
            title: 'Architecture note',
            category: 'Design',
          }),
        ],
      }),
    )

    const prWide = screen.getByTestId('pr-wide-list')
    expect(prWide).toHaveTextContent(/R1/)
    expect(prWide).toHaveTextContent(/Body/)
    expect(prWide).toHaveTextContent(/whole PR/)
    expect(prWide).toHaveTextContent(/Architecture note/)
    expect(prWide).toHaveTextContent(/Design/)
  })

  it('defaults to COMMENT event', async () => {
    render(
      withClient(<SubmitDrawer sessionId="s1" onClose={() => {}} />, 's1', {
        session,
        findings: [mk({})],
      }),
    )
    const radio = screen.getByRole('radio', { name: /COMMENT/i })
    expect(radio).toBeChecked()
  })

  it('goes from prepare directly to confirm without JSON preview', async () => {
    const user = userEvent.setup()
    render(
      withClient(<SubmitDrawer sessionId="s1" onClose={() => {}} />, 's1', {
        session,
        findings: [mk({})],
      }),
    )

    await user.click(screen.getByRole('button', { name: /Next/i }))

    expect(screen.getByText(/This will post immediately/i).parentElement).toHaveTextContent(
      /COMMENT on acme\/web#42/i,
    )
    expect(screen.getByRole('button', { name: /Submit/i })).toBeInTheDocument()
    expect(screen.queryByText(/Copy JSON/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/\/reviews/i)).not.toBeInTheDocument()
  })
})
