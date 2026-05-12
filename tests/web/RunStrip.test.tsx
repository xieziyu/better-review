import type { PrepStep, PRSession, SessionStatus } from '@shared/types'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RunStrip } from '@/components/RunStrip'

const baseSession: PRSession = {
  id: 's1',
  owner: 'acme',
  repo: 'web',
  number: 42,
  title: 'feat(auth): refresh tokens',
  author: 'alice',
  url: 'https://github.com/acme/web/pull/42',
  baseRef: 'main',
  headRef: 'feature/x',
  status: 'pending',
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

function renderStrip(
  overrides: {
    status?: SessionStatus
    prepSteps?: PrepStep[]
    agentEventCount?: number
    transcriptOpen?: boolean
  } = {},
) {
  const session: PRSession = { ...baseSession, status: overrides.status ?? 'pending' }
  return render(
    <RunStrip
      session={session}
      prepSteps={overrides.prepSteps ?? []}
      agentEventCount={overrides.agentEventCount ?? 0}
      transcriptOpen={overrides.transcriptOpen ?? false}
      onToggleTranscript={() => {}}
    />,
  )
}

describe('RunStrip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-12T00:00:00Z').getTime())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing when the session has settled', () => {
    for (const status of ['ready', 'submitted', 'failed', 'cancelled', 'archived'] as const) {
      const { container } = renderStrip({ status })
      expect(container.firstChild).toBeNull()
    }
  })

  it('renders the PREP phase label and last prep step detail during prep', () => {
    const steps: PrepStep[] = [
      { phase: 'prep:fetching-pr', ts: 1 },
      { phase: 'prep:fetching-diff', ts: 2 },
    ]
    renderStrip({ status: 'pending', prepSteps: steps })
    const strip = screen.getByRole('status', { name: /Review run progress/i })
    expect(strip).toHaveTextContent(/Prep/i)
    expect(strip).toHaveTextContent(/Fetching diff/i)
  })

  it('renders the REVIEWING label and the {agent} · {count} events detail while running', () => {
    renderStrip({ status: 'running', agentEventCount: 23 })
    const strip = screen.getByRole('status', { name: /Review run progress/i })
    expect(strip).toHaveTextContent(/Reviewing/i)
    expect(strip).toHaveTextContent(/claude · 23 events/i)
  })

  it('ticks the elapsed clock every second', () => {
    // session.createdAt is 0 (Unix epoch); the strip mounts at the
    // fake-now (a real date) and shows the wall-clock difference.
    const startedAt = vi.getMockedSystemTime()!.valueOf()
    const session: PRSession = {
      ...baseSession,
      status: 'running',
      createdAt: startedAt - 12_000,
    }
    render(
      <RunStrip
        session={session}
        prepSteps={[]}
        agentEventCount={1}
        transcriptOpen={false}
        onToggleTranscript={() => {}}
      />,
    )
    const strip = screen.getByRole('status', { name: /Review run progress/i })
    expect(strip).toHaveTextContent(/0:12/)
    act(() => {
      vi.advanceTimersByTime(3_000)
    })
    expect(strip).toHaveTextContent(/0:15/)
  })

  it('exposes the transcript toggle with the correct aria-expanded state', () => {
    const { rerender } = render(
      <RunStrip
        session={{ ...baseSession, status: 'running' }}
        prepSteps={[]}
        agentEventCount={0}
        transcriptOpen={false}
        onToggleTranscript={() => {}}
      />,
    )
    const btn = screen.getByRole('button', { name: /Toggle transcript drawer/i })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    rerender(
      <RunStrip
        session={{ ...baseSession, status: 'running' }}
        prepSteps={[]}
        agentEventCount={0}
        transcriptOpen={true}
        onToggleTranscript={() => {}}
      />,
    )
    expect(btn).toHaveAttribute('aria-expanded', 'true')
  })
})
