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
  source: { kind: 'github-pr', owner: 'acme', repo: 'web', number: 42 },
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
  source: 'agent',
  submittedAt: null,
  submittedCommentId: null,
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

  it('leaves the review body empty and shows PR-wide findings as preview cards', () => {
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
    expect(body.value).toBe('')
    expect(screen.getByTestId('pr-wide-list')).toHaveTextContent(/Wider architectural concern/)
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
    expect(inline).toHaveTextContent(/should/i)
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
    expect(moved).not.toHaveTextContent(/\bR1\b/)

    const inline = screen.getByTestId('inline-list')
    expect(inline).toHaveTextContent(/R1/)
  })

  it("moves a multi-line finding to body when its startLine is outside the diff, matching the server's range rule", () => {
    const diff = [
      'diff --git a/src/x.ts b/src/x.ts',
      '--- a/src/x.ts',
      '+++ b/src/x.ts',
      '@@ -10,2 +10,3 @@',
      ' a',
      '+b',
      ' c',
      '',
    ].join('\n')
    const findings = [
      // line is inside the hunk (10..12) but startLine 2 is not — the server
      // (payload-builder) validates the whole range and drops this to the
      // review body, so the preview must agree.
      mk({ id: 'R1', dbId: 'd1', file: 'src/x.ts', line: 11, startLine: 2 }),
      // fully in-hunk range stays inline
      mk({ id: 'R2', dbId: 'd2', file: 'src/x.ts', line: 12, startLine: 10 }),
    ]
    render(
      withClient(<SubmitDrawer sessionId="s1" onClose={() => {}} />, 's1', {
        session,
        findings,
        diff,
      }),
    )
    const moved = screen.getByTestId('moved-to-body-list')
    expect(moved).toHaveTextContent(/R1/)
    expect(moved).not.toHaveTextContent(/\bR2\b/)

    const inline = screen.getByTestId('inline-list')
    expect(inline).toHaveTextContent(/R2/)
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
    expect(prWide).toHaveTextContent(/whole PR/)
    expect(prWide).toHaveTextContent(/Architecture note/)
    expect(prWide).toHaveTextContent(/Design/)
  })

  it('groups manual file-level findings separately from PR-wide and excludes them from the inline count', async () => {
    const user = userEvent.setup()
    render(
      withClient(<SubmitDrawer sessionId="s1" onClose={() => {}} />, 's1', {
        session,
        findings: [
          mk({
            id: 'R1',
            dbId: 'd1',
            file: 'src/x.ts',
            line: null,
            source: 'manual',
            title: 'whole-file concern',
          }),
          mk({
            id: 'R2',
            dbId: 'd2',
            file: null,
            line: null,
            title: 'architectural note',
          }),
        ],
      }),
    )
    // File-level manual finding lands in its own section, not in pr-wide.
    const fileLevelList = screen.getByTestId('file-level-list')
    expect(fileLevelList).toHaveTextContent(/whole-file concern/)
    expect(fileLevelList).not.toHaveTextContent(/architectural note/)
    const prWide = screen.getByTestId('pr-wide-list')
    expect(prWide).toHaveTextContent(/architectural note/)
    expect(prWide).not.toHaveTextContent(/whole-file concern/)
    // File-level findings render into the review body, not as inline
    // comments — GitHub's create-review API rejects subject_type:'file'.
    // So the confirmation's inline count must not include them.
    await user.click(screen.getByRole('button', { name: /Next/i }))
    expect(screen.getByText(/0 inline comments/i)).toBeInTheDocument()
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

  it('defaults to APPROVE and lets you submit when there are no findings (LGTM)', async () => {
    const user = userEvent.setup()
    render(
      withClient(<SubmitDrawer sessionId="s1" onClose={() => {}} />, 's1', {
        session,
        findings: [],
      }),
    )
    // No findings → the LGTM path pre-selects APPROVE.
    expect(screen.getByRole('radio', { name: /APPROVE/i })).toBeChecked()
    // Next is enabled even with an empty selection.
    const next = screen.getByRole('button', { name: /Next/i })
    expect(next).toBeEnabled()
    await user.click(next)
    expect(screen.getByRole('button', { name: /Submit/i })).toBeEnabled()
  })

  it('blocks a COMMENT with no findings until a review body is written', async () => {
    const user = userEvent.setup()
    render(
      withClient(<SubmitDrawer sessionId="s1" onClose={() => {}} />, 's1', {
        session,
        findings: [],
      }),
    )
    // Switch away from the pre-selected APPROVE to COMMENT.
    await user.click(screen.getByRole('radio', { name: /COMMENT/i }))
    const next = screen.getByRole('button', { name: /Next/i })
    expect(next).toBeDisabled()
    // Typing a body makes an otherwise-empty COMMENT submittable.
    await user.type(screen.getByLabelText(/Review body/i), 'overall this looks fine')
    expect(next).toBeEnabled()
  })

  it('does not default to APPROVE while the review is still running with no findings', () => {
    render(
      withClient(<SubmitDrawer sessionId="s1" onClose={() => {}} />, 's1', {
        // Zero findings but the review hasn't finished — an empty findings list
        // here means "not done yet", not "clean". APPROVE must not be the default.
        session: { ...session, status: 'running' },
        findings: [],
      }),
    )
    expect(screen.getByRole('radio', { name: /COMMENT/i })).toBeChecked()
  })

  it('keeps COMMENT as the default when findings exist but are all deselected', () => {
    render(
      withClient(<SubmitDrawer sessionId="s1" onClose={() => {}} />, 's1', {
        session,
        // The agent flagged something; the user deselected it. Approving a PR
        // the agent flagged should stay a deliberate switch, not a default.
        findings: [mk({ id: 'R1', dbId: 'd1', selected: false })],
      }),
    )
    expect(screen.getByRole('radio', { name: /COMMENT/i })).toBeChecked()
    // canSubmit is false → Next stays disabled until a finding or body.
    expect(screen.getByRole('button', { name: /Next/i })).toBeDisabled()
  })

  it('confirms a body-only COMMENT as a comment, not as "approve with no comments"', async () => {
    const user = userEvent.setup()
    render(
      withClient(<SubmitDrawer sessionId="s1" onClose={() => {}} />, 's1', {
        session,
        findings: [],
      }),
    )
    await user.click(screen.getByRole('radio', { name: /COMMENT/i }))
    await user.type(screen.getByLabelText(/Review body/i), 'overall thoughts')
    await user.click(screen.getByRole('button', { name: /Next/i }))
    // The confirmation must reflect the COMMENT event, not contradict it.
    expect(screen.queryByText(/approve with no comments/i)).not.toBeInTheDocument()
    expect(screen.getByText(/0 inline comments/i)).toBeInTheDocument()
    expect(screen.getByText(/This will post immediately/i).parentElement).toHaveTextContent(
      /COMMENT on acme\/web#42/i,
    )
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
