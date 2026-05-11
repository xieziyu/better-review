import type { SessionStatus } from '@shared/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AgentOutputPanel } from '@/components/AgentOutputPanel'

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

describe('AgentOutputPanel', () => {
  const renderWith = (status: SessionStatus, chunks: string[]) =>
    render(<AgentOutputPanel chunks={chunks} status={status} />)

  it('renders nothing for non-running session with no chunks', () => {
    const { container } = renderWith('ready', [])
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing for failed session with no chunks', () => {
    const { container } = renderWith('failed', [])
    expect(container.firstChild).toBeNull()
  })

  it('renders waiting placeholder while running with no chunks', () => {
    renderWith('running', [])
    expect(screen.getByText(/Waiting for the agent/i)).toBeInTheDocument()
    expect(screen.getByLabelText('streaming')).toBeInTheDocument()
  })

  it('renders chunks joined by newlines and a count badge', () => {
    renderWith('running', [
      'system: init',
      'Reading the diff…',
      '→ tool: Read({"file_path":"a.ts"})',
    ])
    const log = screen.getByRole('log')
    const pre = log.querySelector('pre')!
    expect(pre.textContent).toBe(
      'system: init\nReading the diff…\n→ tool: Read({"file_path":"a.ts"})',
    )
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders as a full pane (no <details> collapsing wrapper)', () => {
    const running = render(<AgentOutputPanel chunks={['hi']} status="running" />)
    expect(running.container.querySelector('details')).toBeNull()
    expect(running.getByRole('log')).toBeInTheDocument()
  })

  it('hides streaming chip once status is not running', () => {
    renderWith('ready', ['something'])
    expect(screen.queryByLabelText('streaming')).not.toBeInTheDocument()
  })

  it('auto-scrolls to bottom when user is pinned', () => {
    const { rerender, getByRole } = render(
      <AgentOutputPanel chunks={['line 1']} status="running" />,
    )
    const body = getByRole('log') as HTMLElement
    setBodyMetrics(body, { scrollHeight: 200, clientHeight: 100, scrollTop: 100 })

    rerender(<AgentOutputPanel chunks={['line 1', 'line 2']} status="running" />)

    setBodyMetrics(body, { scrollHeight: 400, clientHeight: 100, scrollTop: 100 })
    rerender(<AgentOutputPanel chunks={['line 1', 'line 2', 'line 3']} status="running" />)
    expect(body.scrollTop).toBe(400)
  })

  it('does not auto-scroll once user has scrolled up', () => {
    const { rerender, getByRole } = render(
      <AgentOutputPanel chunks={['line 1']} status="running" />,
    )
    const body = getByRole('log') as HTMLElement
    setBodyMetrics(body, { scrollHeight: 1000, clientHeight: 100, scrollTop: 0 })

    fireEvent.scroll(body)

    rerender(<AgentOutputPanel chunks={['line 1', 'line 2']} status="running" />)
    expect(body.scrollTop).toBe(0)
  })
})
