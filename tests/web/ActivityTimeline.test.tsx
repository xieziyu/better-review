import type { PrepCall, PrepStep, SessionStatus } from '@shared/types'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ActivityTimeline } from '@/components/ActivityTimeline'

const phase = (p: string, ts = 1): PrepStep => ({ phase: p, ts })

const call = (overrides: Partial<PrepCall> = {}): PrepCall => ({
  phase: 'prep:fetching-pr',
  command: ['gh', 'pr', 'view', '12'],
  stdout: '{"number":12,"title":"hi"}',
  stderr: '',
  exitCode: 0,
  durationMs: 240,
  ts: 1,
  ...overrides,
})

interface Overrides {
  prepSteps?: PrepStep[]
  prepCalls?: PrepCall[]
  chunks?: string[]
  status?: SessionStatus
  agent?: 'codex' | 'claude' | 'pi'
}

function timelineProps(o: Overrides = {}) {
  return {
    prepSteps: o.prepSteps ?? [],
    prepCalls: o.prepCalls ?? [],
    chunks: o.chunks ?? [],
    status: o.status ?? ('ready' as SessionStatus),
    agent: o.agent,
  }
}

describe('ActivityTimeline', () => {
  it('renders an agent node even when there are no prep buckets', () => {
    render(<ActivityTimeline {...timelineProps()} />)
    expect(screen.getByText('Agent review')).toBeInTheDocument()
  })

  it('renders a node per prep bucket with i18n labels', () => {
    render(
      <ActivityTimeline
        {...timelineProps({
          prepSteps: [phase('prep:fetching-pr', 1), phase('prep:fetching-diff', 2)],
        })}
      />,
    )
    expect(screen.getByText(/Fetching PR metadata/i)).toBeInTheDocument()
    expect(screen.getByText(/Fetching diff/i)).toBeInTheDocument()
  })

  it('expanding a bucket reveals its captured command + stdout', () => {
    render(
      <ActivityTimeline
        {...timelineProps({ prepSteps: [phase('prep:fetching-pr')], prepCalls: [call()] })}
      />,
    )
    expect(screen.queryByText(/"number"/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Fetching PR metadata/i }))
    expect(screen.getByText(/gh pr view 12/)).toBeInTheDocument()
    // Stdout is JSON-pretty-printed in the call card body, so match the field
    // name rather than the exact serialisation.
    expect(screen.getByText(/"number": 12/)).toBeInTheDocument()
  })

  it('disables expand and shows "in-process" tag when a bucket has no calls', () => {
    render(<ActivityTimeline {...timelineProps({ prepSteps: [phase('prep:rendering-prompt')] })} />)
    const btn = screen.getByRole('button', { name: /Assembling prompt/i })
    expect(btn).toBeDisabled()
    expect(screen.getByText(/in-process/i)).toBeInTheDocument()
  })

  it('attaches calls under a synthetic bucket when markPhase has not fired', () => {
    render(
      <ActivityTimeline {...timelineProps({ prepCalls: [call({ phase: 'prep:fetching-pr' })] })} />,
    )
    expect(screen.getByText(/Fetching PR metadata/i)).toBeInTheDocument()
    expect(screen.getByText(/1 call/i)).toBeInTheDocument()
  })

  it('renders stderr in the severity-must color when non-empty', () => {
    render(
      <ActivityTimeline
        {...timelineProps({
          prepSteps: [phase('prep:fetching-pr')],
          prepCalls: [call({ stdout: '', stderr: 'GraphQL: not found', exitCode: 1 })],
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Fetching PR metadata/i }))
    const errPre = screen.getByText(/GraphQL: not found/)
    expect(errPre.className).toMatch(/severity-must/)
  })

  it('shows the agent name on the agent node label when provided', () => {
    render(<ActivityTimeline {...timelineProps({ agent: 'codex' })} />)
    expect(screen.getByText(/Agent review — codex/i)).toBeInTheDocument()
  })

  it('renders the transcript inside the agent node while running', () => {
    render(<ActivityTimeline {...timelineProps({ status: 'running', chunks: ['hello agent'] })} />)
    const log = screen.getByRole('log')
    expect(log).toHaveTextContent(/hello agent/)
    expect(screen.getByText(/running/i)).toBeInTheDocument()
  })

  it('renders a failed indicator on the agent node when status is failed', () => {
    render(<ActivityTimeline {...timelineProps({ status: 'failed', chunks: ['x'] })} />)
    expect(screen.getByText(/failed/i)).toBeInTheDocument()
  })

  it('renders a cancelled indicator when status is cancelled', () => {
    render(<ActivityTimeline {...timelineProps({ status: 'cancelled', chunks: ['x'] })} />)
    expect(screen.getByText(/cancelled/i)).toBeInTheDocument()
  })

  it('omits the streaming indicator after the agent finishes', () => {
    render(<ActivityTimeline {...timelineProps({ status: 'ready', chunks: ['done'] })} />)
    expect(screen.queryByText(/^running$/i)).not.toBeInTheDocument()
  })

  it('collapses the agent transcript body when the header is clicked', () => {
    render(<ActivityTimeline {...timelineProps({ status: 'running', chunks: ['live'] })} />)
    expect(screen.getByRole('log')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Agent review/i }))
    expect(screen.queryByRole('log')).not.toBeInTheDocument()
  })

  describe('elapsed timer', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-05-26T00:00:00Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('ticks the elapsed counter while running', () => {
      const startedAt = Date.now() - 1500
      render(
        <ActivityTimeline
          {...timelineProps({
            status: 'running',
            chunks: ['x'],
            prepSteps: [phase('prep:rendering-prompt', startedAt)],
          })}
        />,
      )
      // First render uses Date.now() captured at mount.
      expect(screen.getByText(/1\.5 s/)).toBeInTheDocument()

      // Advance the clock and the 1 s interval; the component should re-render.
      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(screen.getByText(/3\.5 s/)).toBeInTheDocument()
    })

    it('does not start an interval when the session is not active', () => {
      const setIntervalSpy = vi.spyOn(window, 'setInterval')
      render(<ActivityTimeline {...timelineProps({ status: 'ready', chunks: ['done'] })} />)
      expect(setIntervalSpy).not.toHaveBeenCalled()
      setIntervalSpy.mockRestore()
    })
  })
})
