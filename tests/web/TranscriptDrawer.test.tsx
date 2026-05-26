import type { PrepCall, PrepStep, SessionStatus } from '@shared/types'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { TranscriptDrawer, useTranscriptDrawer } from '@/components/TranscriptDrawer'

const OPEN_KEY = 'better-review:transcript-drawer:open:v1'
const HEIGHT_KEY = 'better-review:transcript-drawer:height:v1'

interface Overrides {
  chunks?: string[]
  prepSteps?: PrepStep[]
  prepCalls?: PrepCall[]
  status?: SessionStatus
  open?: boolean
  maximized?: boolean
  onToggle?: () => void
  onClose?: () => void
  onToggleMaximize?: () => void
}

function drawerProps(o: Overrides = {}) {
  return {
    chunks: o.chunks ?? [],
    prepSteps: o.prepSteps ?? [],
    prepCalls: o.prepCalls ?? [],
    status: o.status ?? 'running',
    open: o.open ?? false,
    maximized: o.maximized ?? false,
    onToggle: o.onToggle ?? (() => {}),
    onClose: o.onClose ?? (() => {}),
    onToggleMaximize: o.onToggleMaximize ?? (() => {}),
  } as const
}

beforeEach(() => {
  window.localStorage.removeItem(OPEN_KEY)
  window.localStorage.removeItem(HEIGHT_KEY)
})

describe('TranscriptDrawer', () => {
  it('renders nothing when chunks is empty and status is not running', () => {
    const { container } = render(<TranscriptDrawer {...drawerProps({ status: 'ready' })} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the handle but hides the body when collapsed', () => {
    render(<TranscriptDrawer {...drawerProps()} />)
    expect(screen.getByRole('button', { name: /Open activity drawer/i })).toBeInTheDocument()
    expect(screen.queryByRole('log')).not.toBeInTheDocument()
  })

  it('renders the body and the chunks when open', () => {
    render(<TranscriptDrawer {...drawerProps({ chunks: ['line a', 'line b'], open: true })} />)
    const log = screen.getByRole('log')
    expect(log).toHaveTextContent(/line a/)
    expect(log).toHaveTextContent(/line b/)
    expect(screen.getByRole('button', { name: /Close activity drawer/i })).toBeInTheDocument()
  })

  it('shows the streaming marker on the handle only while running', () => {
    const { rerender } = render(<TranscriptDrawer {...drawerProps({ chunks: ['x'] })} />)
    expect(screen.getByText('streaming')).toBeInTheDocument()
    rerender(<TranscriptDrawer {...drawerProps({ chunks: ['x'], status: 'ready' })} />)
    expect(screen.queryByText('streaming')).not.toBeInTheDocument()
  })

  it('calls onToggle when the handle is clicked', () => {
    let toggled = 0
    render(<TranscriptDrawer {...drawerProps({ chunks: ['x'], onToggle: () => (toggled += 1) })} />)
    fireEvent.click(screen.getByRole('button', { name: /Open activity drawer/i }))
    expect(toggled).toBe(1)
  })

  it('calls onClose when Esc is pressed while focus is inside the open drawer', () => {
    let closed = 0
    render(
      <TranscriptDrawer
        {...drawerProps({ chunks: ['x'], open: true, onClose: () => (closed += 1) })}
      />,
    )
    const handle = screen.getByRole('button', { name: /Close activity drawer/i })
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
          {...drawerProps({ chunks: ['x'], open: true, onClose: () => (closed += 1) })}
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
    render(<TranscriptDrawer {...drawerProps({ chunks: ['x'], open: true })} />)
    const sep = screen.getByRole('separator')
    expect(sep).toHaveAttribute('aria-orientation', 'horizontal')
    expect(sep).toHaveAttribute('aria-valuenow', '320')
  })

  it('renders the prep timeline when prep data is present, even with no agent chunks', () => {
    render(
      <TranscriptDrawer
        {...drawerProps({
          status: 'pending',
          open: true,
          prepSteps: [{ phase: 'prep:fetching-pr', ts: 1 }],
          prepCalls: [
            {
              phase: 'prep:fetching-pr',
              command: ['gh', 'pr', 'view', '12'],
              stdout: '{"number":12}',
              stderr: '',
              exitCode: 0,
              durationMs: 240,
              ts: 2,
            },
          ],
        })}
      />,
    )
    expect(screen.getByText(/1 phases · 0 lines/i)).toBeInTheDocument()
    expect(screen.getByText(/Fetching PR metadata/i)).toBeInTheDocument()
  })

  it('keeps the drawer mounted during pending status even with no prep data yet', () => {
    const { container } = render(
      <TranscriptDrawer {...drawerProps({ status: 'pending', open: false })} />,
    )
    expect(container.firstChild).not.toBeNull()
  })

  it('only shows the maximize button when the drawer is open', () => {
    const { rerender } = render(<TranscriptDrawer {...drawerProps({ chunks: ['x'] })} />)
    expect(
      screen.queryByRole('button', { name: /Maximize activity drawer/i }),
    ).not.toBeInTheDocument()
    rerender(<TranscriptDrawer {...drawerProps({ chunks: ['x'], open: true })} />)
    expect(screen.getByRole('button', { name: /Maximize activity drawer/i })).toBeInTheDocument()
  })

  it('clicking the maximize button calls onToggleMaximize', () => {
    let toggled = 0
    render(
      <TranscriptDrawer
        {...drawerProps({ chunks: ['x'], open: true, onToggleMaximize: () => (toggled += 1) })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Maximize activity drawer/i }))
    expect(toggled).toBe(1)
  })

  it('swaps the button + tag when maximized, and drops the top resize handle', () => {
    render(<TranscriptDrawer {...drawerProps({ chunks: ['x'], open: true, maximized: true })} />)
    expect(screen.getByRole('button', { name: /Restore activity drawer/i })).toBeInTheDocument()
    expect(screen.getByText(/maximized/i)).toBeInTheDocument()
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  })

  it('Esc inside the maximized drawer restores first instead of closing', () => {
    let closed = 0
    let restored = 0
    render(
      <TranscriptDrawer
        {...drawerProps({
          chunks: ['x'],
          open: true,
          maximized: true,
          onClose: () => (closed += 1),
          onToggleMaximize: () => (restored += 1),
        })}
      />,
    )
    const handle = screen.getByRole('button', { name: /Restore activity drawer/i })
    act(() => {
      handle.focus()
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(restored).toBe(1)
    expect(closed).toBe(0)
  })

  it('ignores the maximized prop when the drawer is closed', () => {
    // Maximized only makes sense while open. If the user externally forces
    // maximized=true with open=false, fall back to the closed handle layout.
    render(<TranscriptDrawer {...drawerProps({ chunks: ['x'], open: false, maximized: true })} />)
    expect(screen.queryByText(/maximized/i)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Restore activity drawer/i }),
    ).not.toBeInTheDocument()
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

  it('maximized defaults to false and is not persisted across mounts', () => {
    const { result, unmount } = renderHook(() => useTranscriptDrawer())
    expect(result.current.maximized).toBe(false)
    act(() => result.current.toggleMaximize())
    expect(result.current.maximized).toBe(true)
    unmount()
    const { result: second } = renderHook(() => useTranscriptDrawer())
    expect(second.current.maximized).toBe(false)
  })

  it('toggleMaximize implicitly opens the drawer when called while closed', () => {
    const { result } = renderHook(() => useTranscriptDrawer())
    expect(result.current.open).toBe(false)
    act(() => result.current.toggleMaximize())
    expect(result.current.open).toBe(true)
    expect(result.current.maximized).toBe(true)
    expect(window.localStorage.getItem(OPEN_KEY)).toBe('1')
  })

  it('closing the drawer also drops the maximized flag', () => {
    const { result } = renderHook(() => useTranscriptDrawer())
    act(() => result.current.toggleMaximize())
    expect(result.current.maximized).toBe(true)
    act(() => result.current.setOpen(false))
    expect(result.current.open).toBe(false)
    expect(result.current.maximized).toBe(false)
  })

  it('toggle() also drops the maximized flag when it closes the drawer', () => {
    const { result } = renderHook(() => useTranscriptDrawer())
    act(() => result.current.toggleMaximize())
    expect(result.current.open).toBe(true)
    expect(result.current.maximized).toBe(true)
    act(() => result.current.toggle())
    expect(result.current.open).toBe(false)
    expect(result.current.maximized).toBe(false)
  })
})
