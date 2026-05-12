import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'

import { useResizable } from '@/lib/use-resizable'

const KEY = 'better-review:test:width'

function Harness({
  edge = 'right' as 'right' | 'left',
  defaultWidth = 280,
  min = 256,
  max = 560,
}: {
  edge?: 'right' | 'left'
  defaultWidth?: number
  min?: number
  max?: number
}) {
  const { width, isDragging, separatorProps } = useResizable({
    defaultWidth,
    min,
    max,
    storageKey: KEY,
    edge,
    ariaLabel: 'test-resize',
  })
  return (
    <div>
      <div data-testid="value">{width}</div>
      <div data-testid="dragging">{String(isDragging)}</div>
      <div data-testid="handle" {...separatorProps} />
    </div>
  )
}

beforeEach(() => {
  window.localStorage.removeItem(KEY)
})

describe('useResizable', () => {
  it('starts at defaultWidth when storage is empty', () => {
    render(<Harness defaultWidth={320} />)
    expect(screen.getByTestId('value').textContent).toBe('320')
  })

  it('hydrates from localStorage, clamped to [min, max]', () => {
    window.localStorage.setItem(KEY, '9999')
    render(<Harness max={560} />)
    expect(screen.getByTestId('value').textContent).toBe('560')

    window.localStorage.setItem(KEY, '10')
    const { unmount } = render(<Harness min={256} />)
    expect(screen.getAllByTestId('value').at(-1)?.textContent).toBe('256')
    unmount()
  })

  it('exposes ARIA + tabIndex on the separator', () => {
    render(<Harness defaultWidth={300} min={200} max={500} />)
    const handle = screen.getByTestId('handle')
    expect(handle).toHaveAttribute('role', 'separator')
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
    expect(handle).toHaveAttribute('aria-label', 'test-resize')
    expect(handle).toHaveAttribute('aria-valuenow', '300')
    expect(handle).toHaveAttribute('aria-valuemin', '200')
    expect(handle).toHaveAttribute('aria-valuemax', '500')
    expect(handle).toHaveAttribute('tabindex', '0')
  })

  it('grows on ArrowRight for edge=right, persists to storage', () => {
    render(<Harness edge="right" defaultWidth={280} />)
    const handle = screen.getByTestId('handle')
    act(() => {
      fireEvent.keyDown(handle, { key: 'ArrowRight' })
    })
    expect(screen.getByTestId('value').textContent).toBe('288')
    expect(window.localStorage.getItem(KEY)).toBe('288')
    act(() => {
      fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })
    })
    expect(screen.getByTestId('value').textContent).toBe('320')
    expect(window.localStorage.getItem(KEY)).toBe('320')
  })

  it('inverts arrow keys for edge=left', () => {
    render(<Harness edge="left" defaultWidth={300} />)
    const handle = screen.getByTestId('handle')
    act(() => {
      fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    })
    expect(screen.getByTestId('value').textContent).toBe('308')
    act(() => {
      fireEvent.keyDown(handle, { key: 'ArrowRight' })
    })
    expect(screen.getByTestId('value').textContent).toBe('300')
  })

  it('clamps at min and max', () => {
    render(<Harness defaultWidth={260} min={256} max={300} />)
    const handle = screen.getByTestId('handle')
    act(() => {
      for (let i = 0; i < 10; i++) fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    })
    expect(screen.getByTestId('value').textContent).toBe('256')
    act(() => {
      for (let i = 0; i < 10; i++) fireEvent.keyDown(handle, { key: 'ArrowRight' })
    })
    expect(screen.getByTestId('value').textContent).toBe('300')
  })

  it('ignores non-arrow keys', () => {
    render(<Harness defaultWidth={280} />)
    const handle = screen.getByTestId('handle')
    act(() => {
      fireEvent.keyDown(handle, { key: 'a' })
      fireEvent.keyDown(handle, { key: 'Enter' })
    })
    expect(screen.getByTestId('value').textContent).toBe('280')
  })
})
