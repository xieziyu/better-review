import type { Finding, PRSession } from '@shared/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ExportPopover } from '@/components/ExportPopover'

const session: PRSession = {
  id: 's1',
  owner: 'xieziyu',
  repo: 'better-review',
  number: 42,
  title: 'feat(export): local findings export',
  author: null,
  url: 'https://github.com/xieziyu/better-review/pull/42',
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

const mkFinding = (overrides: Partial<Finding> = {}): Finding => ({
  id: 'R1',
  dbId: 'd1',
  sessionId: 's1',
  ord: 1,
  severity: 'must',
  category: 'Correctness',
  file: 'src/a.ts',
  line: 10,
  title: 'Title',
  body: 'Body',
  selected: true,
  edited: false,
  archived: false,
  createdAt: 0,
  source: 'agent',
  ...overrides,
})

// Stub the clipboard + download helpers so tests can assert what was passed
// without touching the JSDOM clipboard (which is flaky) or triggering an
// actual file download.
const copyMock = vi.fn(async () => {})
const downloadMock = vi.fn()
vi.mock('@/lib/export-clipboard', () => ({
  copyTextToClipboard: (text: string) => copyMock(text),
  downloadTextFile: (...args: unknown[]) => downloadMock(...args),
}))

describe('ExportPopover', () => {
  beforeEach(() => {
    copyMock.mockClear()
    downloadMock.mockClear()
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the trigger but hides the dialog until clicked', () => {
    render(
      <ExportPopover
        session={session}
        findings={[mkFinding(), mkFinding({ dbId: 'd2', selected: false })]}
        roundNumber={2}
      />,
    )
    expect(screen.getByRole('button', { name: /Export/ })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens the dialog and shows scope counts', async () => {
    const user = userEvent.setup()
    render(
      <ExportPopover
        session={session}
        findings={[
          mkFinding({ dbId: 'd1', selected: true }),
          mkFinding({ dbId: 'd2', selected: true }),
          mkFinding({ dbId: 'd3', selected: false }),
        ]}
        roundNumber={1}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Export/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // Scope buttons should report 2 selected of 3 total.
    expect(screen.getByRole('button', { name: /Selected · 2/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /All · 3/ })).toBeInTheDocument()
  })

  it('copies Markdown content matching the selected scope', async () => {
    const user = userEvent.setup()
    render(
      <ExportPopover
        session={session}
        findings={[
          mkFinding({ dbId: 'd1', selected: true, title: 'keep me' }),
          mkFinding({ dbId: 'd2', selected: false, title: 'drop me' }),
        ]}
        roundNumber={1}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Export/ }))
    await user.click(screen.getByRole('button', { name: /^Copy$/ }))
    await waitFor(() => expect(copyMock).toHaveBeenCalled())
    const text = copyMock.mock.calls[0]![0] as string
    expect(text).toContain('# Findings · xieziyu/better-review#42')
    expect(text).toContain('keep me')
    expect(text).not.toContain('drop me')
  })

  it('morphs the Copy button to Copied after a successful copy and reverts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })
    render(<ExportPopover session={session} findings={[mkFinding()]} roundNumber={1} />)
    await user.click(screen.getByRole('button', { name: /Export/ }))
    await user.click(screen.getByRole('button', { name: /^Copy$/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Copied/ })).toBeInTheDocument())
    act(() => {
      vi.advanceTimersByTime(1600)
    })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Copied/ })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: /^Copy$/ })).toBeInTheDocument()
  })

  it('switches to JSON and Download invokes downloadTextFile with the json filename', async () => {
    const user = userEvent.setup()
    render(
      <ExportPopover
        session={session}
        findings={[mkFinding({ selected: true })]}
        roundNumber={1}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Export/ }))
    await user.click(screen.getByRole('button', { name: /^JSON$/ }))
    await user.click(screen.getByRole('button', { name: /^Download$/ }))
    expect(downloadMock).toHaveBeenCalledTimes(1)
    const [filename, mime, text] = downloadMock.mock.calls[0]! as [string, string, string]
    expect(filename).toBe('findings-pr-42-selected.json')
    expect(mime).toBe('application/json')
    const parsed = JSON.parse(text)
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.pr.number).toBe(42)
  })

  it('falls back to scope=all when nothing is selected, and disables Selected', async () => {
    const user = userEvent.setup()
    render(
      <ExportPopover
        session={session}
        findings={[mkFinding({ selected: false }), mkFinding({ dbId: 'd2', selected: false })]}
        roundNumber={1}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Export/ }))
    const selectedBtn = screen.getByRole('button', { name: /Selected · 0/ })
    expect(selectedBtn).toBeDisabled()
    expect(selectedBtn).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /All · 2/ })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: /^Copy$/ }))
    await waitFor(() => expect(copyMock).toHaveBeenCalled())
    expect(copyMock.mock.calls[0]![0]).toContain('2 of 2 findings')
  })

  it('closes the dialog on Escape', async () => {
    const user = userEvent.setup()
    render(<ExportPopover session={session} findings={[mkFinding()]} roundNumber={1} />)
    await user.click(screen.getByRole('button', { name: /Export/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('toggles open/closed via the ⌘E / Ctrl+E shortcut', async () => {
    render(<ExportPopover session={session} findings={[mkFinding()]} roundNumber={1} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('persists scope + format prefs across remounts via localStorage', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <ExportPopover
        session={session}
        findings={[
          mkFinding({ dbId: 'd1', selected: true }),
          mkFinding({ dbId: 'd2', selected: false }),
        ]}
        roundNumber={1}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Export/ }))
    await user.click(screen.getByRole('button', { name: /All · 2/ }))
    await user.click(screen.getByRole('button', { name: /^JSON$/ }))
    unmount()

    render(
      <ExportPopover
        session={session}
        findings={[
          mkFinding({ dbId: 'd1', selected: true }),
          mkFinding({ dbId: 'd2', selected: false }),
        ]}
        roundNumber={1}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Export/ }))
    expect(screen.getByRole('button', { name: /All · 2/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^JSON$/ })).toHaveAttribute('aria-pressed', 'true')
  })
})
