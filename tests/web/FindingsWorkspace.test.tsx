import type { Finding, PRSession } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, it, expect, vi } from 'vitest'

import { FindingsWorkspace } from '@/components/FindingsWorkspace'
import { SelectionProvider, useSelectedFinding } from '@/lib/selection'

const session: PRSession = {
  id: 's1',
  owner: 'acme',
  repo: 'web',
  number: 1,
  title: 'PR',
  author: null,
  url: null,
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
  file: 'src/x.ts',
  line: 10,
  title: 'Race condition somewhere very specific',
  body: 'because of the ordering',
  selected: false,
  edited: false,
  archived: false,
  createdAt: 0,
  ...overrides,
})

interface MqState {
  matches: boolean
  listeners: Array<(e: MediaQueryListEvent) => void>
}

function installMatchMedia(initial: boolean): MqState {
  const state: MqState = { matches: initial, listeners: [] }
  // @ts-expect-error -- jsdom polyfill
  window.matchMedia = (q: string) => {
    void q
    return {
      matches: state.matches,
      media: q,
      onchange: null,
      addEventListener: (_t: string, cb: (e: MediaQueryListEvent) => void) =>
        state.listeners.push(cb),
      removeEventListener: (_t: string, cb: (e: MediaQueryListEvent) => void) => {
        const idx = state.listeners.indexOf(cb)
        if (idx >= 0) state.listeners.splice(idx, 1)
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    }
  }
  return state
}

function mqChange(state: MqState, matches: boolean): void {
  state.matches = matches
  const ev = { matches } as unknown as MediaQueryListEvent
  state.listeners.forEach((l) => l(ev))
}

function Harness({
  findings,
  diff,
  selectFirst = false,
}: {
  findings: Finding[]
  diff?: string | null
  selectFirst?: boolean
}) {
  return (
    <SelectionHarness selectFirst={selectFirst} firstId={findings[0]?.dbId ?? null}>
      <FindingsWorkspace
        findings={findings}
        session={session}
        unifiedDiff={diff ?? null}
        selectedCount={findings.filter((f) => f.selected).length}
      />
    </SelectionHarness>
  )
}

function SelectionHarness({
  children,
  selectFirst,
  firstId,
}: {
  children: React.ReactNode
  selectFirst: boolean
  firstId: string | null
}) {
  return (
    <SelectionProvider>
      <SelectionEffect selectFirst={selectFirst} firstId={firstId} />
      {children}
    </SelectionProvider>
  )
}

function SelectionEffect({
  selectFirst,
  firstId,
}: {
  selectFirst: boolean
  firstId: string | null
}) {
  const { setSelectedFindingDbId } = useSelectedFinding()
  if (selectFirst && firstId) {
    setTimeoutOnce(() => setSelectedFindingDbId(firstId))
  }
  return null
}

let scheduled = false
function setTimeoutOnce(fn: () => void) {
  if (scheduled) return
  scheduled = true
  queueMicrotask(() => {
    scheduled = false
    fn()
  })
}

function wrapped(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('FindingsWorkspace', () => {
  it('wide mode shows the empty inspector message when nothing is selected', () => {
    installMatchMedia(true)
    render(wrapped(<Harness findings={[mkFinding()]} />))
    expect(screen.getByText(/Select a finding to inspect/i)).toBeInTheDocument()
  })

  it('wide mode renders the resize separator with min/max/value', () => {
    installMatchMedia(true)
    render(wrapped(<Harness findings={[mkFinding()]} />))
    const handle = screen.getByRole('separator', { name: /resize findings list/i })
    expect(handle).toHaveAttribute('aria-valuemin', '320')
    expect(handle).toHaveAttribute('aria-valuemax', '560')
    expect(handle).toHaveAttribute('aria-valuenow', '380')
  })

  it('keyboard arrow on separator persists new width', () => {
    installMatchMedia(true)
    render(wrapped(<Harness findings={[mkFinding()]} />))
    const handle = screen.getByRole('separator', { name: /resize findings list/i })
    act(() => {
      fireEvent.keyDown(handle, { key: 'ArrowRight' })
    })
    expect(handle).toHaveAttribute('aria-valuenow', '388')
    expect(window.localStorage.getItem('better-review:findings-list-width:v1')).toBe('388')
  })

  it('narrow mode: hides the separator and renders no detail when nothing selected', () => {
    installMatchMedia(false)
    render(wrapped(<Harness findings={[mkFinding()]} />))
    expect(
      screen.queryByRole('separator', { name: /resize findings list/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /finding detail/i })).not.toBeInTheDocument()
  })

  it('switches between wide and narrow on media-query change', () => {
    const state = installMatchMedia(true)
    render(wrapped(<Harness findings={[mkFinding()]} />))
    expect(screen.getByRole('separator', { name: /resize findings list/i })).toBeInTheDocument()
    act(() => mqChange(state, false))
    expect(
      screen.queryByRole('separator', { name: /resize findings list/i }),
    ).not.toBeInTheDocument()
  })

  it('shows the selected-count footer when at least one finding is selected', () => {
    installMatchMedia(true)
    render(
      wrapped(
        <Harness findings={[mkFinding({ selected: true }), mkFinding({ dbId: 'd2', id: 'R2' })]} />,
      ),
    )
    expect(screen.getByText(/1 selected/i)).toBeInTheDocument()
  })

  it('persists list width separately from the sidebar key', () => {
    installMatchMedia(true)
    window.localStorage.setItem('better-review:findings-list-width:v1', '480')
    render(wrapped(<Harness findings={[mkFinding()]} />))
    const handle = screen.getByRole('separator', { name: /resize findings list/i })
    expect(handle).toHaveAttribute('aria-valuenow', '480')
  })

  it('queries the diff fallback endpoint when no diff is passed in', () => {
    installMatchMedia(true)
    const spy = vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ diff: '' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    render(wrapped(<Harness findings={[mkFinding()]} diff={null} />))
    expect(spy).toHaveBeenCalledWith('/api/sessions/s1/diff')
    spy.mockRestore()
  })
})
