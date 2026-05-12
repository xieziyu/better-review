import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { TranscriptStream } from '@/components/TranscriptStream'

function setBodyMetrics(
  el: HTMLElement,
  opts: { scrollHeight: number; clientHeight: number; scrollTop: number },
) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: opts.scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: opts.clientHeight })
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get() {
      return (el as unknown as { _scrollTop?: number })._scrollTop ?? opts.scrollTop
    },
    set(v: number) {
      ;(el as unknown as { _scrollTop?: number })._scrollTop = v
    },
  })
  ;(el as unknown as { _scrollTop?: number })._scrollTop = opts.scrollTop
}

describe('TranscriptStream', () => {
  it('renders waiting placeholder while running with no chunks', () => {
    render(<TranscriptStream chunks={[]} status="running" />)
    expect(screen.getByText(/Waiting for agent output/i)).toBeInTheDocument()
  })

  it('renders nothing visible (no waiting copy) when not running and no chunks', () => {
    render(<TranscriptStream chunks={[]} status="ready" />)
    expect(screen.queryByText(/Waiting/i)).not.toBeInTheDocument()
    // The component itself always renders the outer log region — TranscriptDrawer
    // is responsible for hiding the empty-when-done case.
    expect(screen.getByRole('log')).toBeInTheDocument()
  })

  it('renders chunks joined by newlines', () => {
    render(
      <TranscriptStream
        chunks={['system: init', 'Reading the diff…', '→ tool: Read({"file_path":"a.ts"})']}
        status="running"
      />,
    )
    const log = screen.getByRole('log')
    const pre = log.querySelector('pre')!
    expect(pre.textContent).toBe(
      'system: init\nReading the diff…\n→ tool: Read({"file_path":"a.ts"})',
    )
  })

  it('auto-scrolls to bottom when user is pinned', () => {
    const { rerender, getByRole } = render(
      <TranscriptStream chunks={['line 1']} status="running" />,
    )
    const body = getByRole('log') as HTMLElement
    setBodyMetrics(body, { scrollHeight: 200, clientHeight: 100, scrollTop: 100 })

    rerender(<TranscriptStream chunks={['line 1', 'line 2']} status="running" />)

    setBodyMetrics(body, { scrollHeight: 400, clientHeight: 100, scrollTop: 100 })
    rerender(<TranscriptStream chunks={['line 1', 'line 2', 'line 3']} status="running" />)
    expect(body.scrollTop).toBe(400)
  })

  it('does not auto-scroll once user has scrolled up', () => {
    const { rerender, getByRole } = render(
      <TranscriptStream chunks={['line 1']} status="running" />,
    )
    const body = getByRole('log') as HTMLElement
    setBodyMetrics(body, { scrollHeight: 1000, clientHeight: 100, scrollTop: 0 })

    fireEvent.scroll(body)

    rerender(<TranscriptStream chunks={['line 1', 'line 2']} status="running" />)
    expect(body.scrollTop).toBe(0)
  })
})
