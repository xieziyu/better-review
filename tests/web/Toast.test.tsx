import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider, useToast } from '@/lib/toast'

interface PushButtonProps {
  payloads: Parameters<ReturnType<typeof useToast>['push']>[0][]
}

function PushButton({ payloads }: PushButtonProps) {
  const { push } = useToast()
  return (
    <button
      type="button"
      onClick={() => {
        payloads.forEach((p) => push(p))
      }}
    >
      push
    </button>
  )
}

function pushOne(payload: Parameters<ReturnType<typeof useToast>['push']>[0]) {
  render(
    <ToastProvider>
      <PushButton payloads={[payload]} />
    </ToastProvider>,
  )
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: 'push' }))
  })
}

describe('Toast (peek)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('renders severity, mono path with line, and title', () => {
    pushOne({
      title: 'gh stderr is swallowed when API call fails',
      file: 'src/server/github/gh-client.ts',
      line: 142,
      severity: 'should',
    })

    expect(screen.getByLabelText(/severity: should/i)).toBeInTheDocument()
    expect(screen.getByText('gh-client.ts')).toBeInTheDocument()
    expect(screen.getByText(/:142/)).toBeInTheDocument()
    expect(screen.getByText(/src\/server\/github/)).toBeInTheDocument()
    expect(
      screen.getByText('gh stderr is swallowed when API call fails'),
    ).toBeInTheDocument()
  })

  it('auto-dismisses after the default 6s', () => {
    pushOne({
      title: 'auto dismiss me',
      file: 'a.ts',
      severity: 'nit',
    })
    expect(screen.getByText('auto dismiss me')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(5999)
    })
    expect(screen.getByText('auto dismiss me')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByText('auto dismiss me')).not.toBeInTheDocument()
  })

  it('persistent MUST toast does not auto-dismiss', () => {
    pushOne({
      title: 'critical issue',
      file: 'a.ts',
      severity: 'must',
      persistent: true,
    })

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByText('critical issue')).toBeInTheDocument()
  })

  it('pauses the dismiss timer on hover, resumes on leave', () => {
    pushOne({
      title: 'hover to pause',
      file: 'a.ts',
      severity: 'should',
    })

    const card = screen.getByText('hover to pause').closest('[role="button"]')!
    expect(card).toBeTruthy()

    // Hover before timer fires.
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    fireEvent.mouseEnter(card)

    // Advance past the original 6s window — should still be present.
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(screen.getByText('hover to pause')).toBeInTheDocument()

    // Leave → fresh 6s window starts.
    fireEvent.mouseLeave(card)
    act(() => {
      vi.advanceTimersByTime(5999)
    })
    expect(screen.getByText('hover to pause')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByText('hover to pause')).not.toBeInTheDocument()
  })

  it('clicking the card invokes onClick and dismisses', () => {
    const onClick = vi.fn()
    pushOne({
      title: 'click me',
      file: 'a.ts',
      severity: 'should',
      onClick,
    })

    const card = screen.getByText('click me').closest('[role="button"]')!
    fireEvent.click(card)

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('click me')).not.toBeInTheDocument()
  })

  it('close button dismisses without invoking onClick', () => {
    const onClick = vi.fn()
    pushOne({
      title: 'do not jump',
      file: 'a.ts',
      severity: 'should',
      onClick,
    })

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))

    expect(onClick).not.toHaveBeenCalled()
    expect(screen.queryByText('do not jump')).not.toBeInTheDocument()
  })

  it('older entries in a stack render as head-only (no title, no foot)', () => {
    render(
      <ToastProvider>
        <PushButton
          payloads={[
            { title: 'first title', file: 'a.ts', severity: 'nit', persistent: true },
            { title: 'second title', file: 'b.ts', severity: 'should', persistent: true },
            { title: 'third title', file: 'c.ts', severity: 'must', persistent: true },
          ]}
        />
      </ToastProvider>,
    )
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'push' }))
    })

    // Newest (third) renders the title and foot CTA.
    expect(screen.getByText('third title')).toBeInTheDocument()
    expect(screen.getAllByText(/click to jump/i)).toHaveLength(1)

    // Older two have their head (path) but no title in the DOM.
    expect(screen.queryByText('first title')).not.toBeInTheDocument()
    expect(screen.queryByText('second title')).not.toBeInTheDocument()
    expect(screen.getByText('a.ts')).toBeInTheDocument()
    expect(screen.getByText('b.ts')).toBeInTheDocument()
  })
})
