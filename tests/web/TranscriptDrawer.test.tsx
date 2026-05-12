import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { TranscriptDrawer, useTranscriptDrawer } from '@/components/TranscriptDrawer'

const OPEN_KEY = 'better-review:transcript-drawer:open:v1'
const HEIGHT_KEY = 'better-review:transcript-drawer:height:v1'

beforeEach(() => {
  window.localStorage.removeItem(OPEN_KEY)
  window.localStorage.removeItem(HEIGHT_KEY)
})

describe('TranscriptDrawer', () => {
  it('renders nothing when chunks is empty and status is not running', () => {
    const { container } = render(
      <TranscriptDrawer
        chunks={[]}
        status="ready"
        open={false}
        onToggle={() => {}}
        onClose={() => {}}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the handle but hides the body when collapsed', () => {
    render(
      <TranscriptDrawer
        chunks={[]}
        status="running"
        open={false}
        onToggle={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /Open transcript drawer/i })).toBeInTheDocument()
    expect(screen.queryByRole('log')).not.toBeInTheDocument()
  })

  it('renders the body and the chunks when open', () => {
    render(
      <TranscriptDrawer
        chunks={['line a', 'line b']}
        status="running"
        open={true}
        onToggle={() => {}}
        onClose={() => {}}
      />,
    )
    const log = screen.getByRole('log')
    expect(log).toHaveTextContent(/line a/)
    expect(log).toHaveTextContent(/line b/)
    expect(screen.getByRole('button', { name: /Close transcript drawer/i })).toBeInTheDocument()
  })

  it('shows the streaming marker on the handle only while running', () => {
    const { rerender } = render(
      <TranscriptDrawer
        chunks={['x']}
        status="running"
        open={false}
        onToggle={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText('streaming')).toBeInTheDocument()
    rerender(
      <TranscriptDrawer
        chunks={['x']}
        status="ready"
        open={false}
        onToggle={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.queryByText('streaming')).not.toBeInTheDocument()
  })

  it('calls onToggle when the handle is clicked', () => {
    let toggled = 0
    render(
      <TranscriptDrawer
        chunks={['x']}
        status="running"
        open={false}
        onToggle={() => {
          toggled += 1
        }}
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Open transcript drawer/i }))
    expect(toggled).toBe(1)
  })

  it('calls onClose when Esc is pressed while focus is inside the open drawer', () => {
    let closed = 0
    render(
      <TranscriptDrawer
        chunks={['x']}
        status="running"
        open={true}
        onToggle={() => {}}
        onClose={() => {
          closed += 1
        }}
      />,
    )
    // The handle button is a real focusable element inside the drawer root.
    const handle = screen.getByRole('button', { name: /Close transcript drawer/i })
    act(() => {
      handle.focus()
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(closed).toBe(1)
  })

  it('does not call onClose when Esc is pressed with focus outside the drawer', () => {
    let closed = 0
    render(
      <div>
        <button type="button" data-testid="outside">
          outside
        </button>
        <TranscriptDrawer
          chunks={['x']}
          status="running"
          open={true}
          onToggle={() => {}}
          onClose={() => {
            closed += 1
          }}
        />
      </div>,
    )
    act(() => {
      ;(screen.getByTestId('outside') as HTMLButtonElement).focus()
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(closed).toBe(0)
  })

  it('exposes a horizontal resize separator with the localStorage-backed height', () => {
    window.localStorage.setItem(HEIGHT_KEY, '320')
    render(
      <TranscriptDrawer
        chunks={['x']}
        status="running"
        open={true}
        onToggle={() => {}}
        onClose={() => {}}
      />,
    )
    const sep = screen.getByRole('separator')
    expect(sep).toHaveAttribute('aria-orientation', 'horizontal')
    expect(sep).toHaveAttribute('aria-valuenow', '320')
  })
})

describe('useTranscriptDrawer', () => {
  afterEach(() => {
    window.localStorage.removeItem(OPEN_KEY)
  })

  it('defaults to closed when storage is empty', () => {
    const { result } = renderHook(() => useTranscriptDrawer())
    expect(result.current.open).toBe(false)
  })

  it('hydrates from localStorage', () => {
    window.localStorage.setItem(OPEN_KEY, '1')
    const { result } = renderHook(() => useTranscriptDrawer())
    expect(result.current.open).toBe(true)
  })

  it('toggle() flips state and persists', () => {
    const { result } = renderHook(() => useTranscriptDrawer())
    act(() => result.current.toggle())
    expect(result.current.open).toBe(true)
    expect(window.localStorage.getItem(OPEN_KEY)).toBe('1')
    act(() => result.current.toggle())
    expect(result.current.open).toBe(false)
    expect(window.localStorage.getItem(OPEN_KEY)).toBe('0')
  })

  it('setOpen() persists an explicit value', () => {
    const { result } = renderHook(() => useTranscriptDrawer())
    act(() => result.current.setOpen(true))
    expect(result.current.open).toBe(true)
    expect(window.localStorage.getItem(OPEN_KEY)).toBe('1')
  })
})
