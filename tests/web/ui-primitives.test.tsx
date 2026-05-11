import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  Button,
  EmptyState,
  KbdHint,
  ScrollPin,
  SectionHeader,
  SeverityLabel,
  Tag,
} from '@/components/ui'

describe('ui primitives', () => {
  it('Button renders text and forwards onClick', () => {
    const fn = vi.fn()
    render(
      <Button variant="primary" onClick={fn}>
        submit
      </Button>,
    )
    const btn = screen.getByRole('button', { name: 'submit' })
    btn.click()
    expect(fn).toHaveBeenCalledOnce()
    expect(btn.className).toMatch(/btn-primary-bg/)
  })

  it('Tag renders tone and uppercases content visually via class', () => {
    render(<Tag tone="brand">running</Tag>)
    const el = screen.getByText('running')
    expect(el.className).toMatch(/uppercase/)
    expect(el.className).toMatch(/bg-brand/)
  })

  it('SeverityLabel writes data-level and inline `→ CAPS` wordmark', () => {
    const { container } = render(<SeverityLabel level="must" />)
    const wrapper = container.querySelector('[data-level="must"]')
    expect(wrapper).toBeTruthy()
    expect(wrapper?.className).toMatch(/text-severity-must/)
    expect(wrapper?.textContent).toContain('→')
    expect(wrapper?.textContent).toContain('MUST')
    expect(screen.getByLabelText(/severity: must/i)).toBe(wrapper)
  })

  it('SectionHeader shows eyebrow + title + meta + actions', () => {
    render(
      <SectionHeader
        eyebrow="findings"
        title="3 must · 5 should"
        meta="last updated 4m ago"
        actions={<button type="button">go</button>}
      />,
    )
    expect(screen.getByText('findings').className).toMatch(/uppercase/)
    expect(screen.getByRole('heading', { level: 2, name: '3 must · 5 should' })).toBeTruthy()
    expect(screen.getByText('last updated 4m ago')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'go' })).toBeTruthy()
  })

  it('KbdHint renders one kbd per key plus optional label', () => {
    const { container } = render(<KbdHint keys={['⌘', 'S']} label="save" />)
    const kbds = container.querySelectorAll('kbd')
    expect(kbds.length).toBe(2)
    expect(kbds[0]?.textContent).toBe('⌘')
    expect(kbds[1]?.textContent).toBe('S')
    expect(screen.getByText('save')).toBeTruthy()
  })

  it('EmptyState renders eyebrow/title/body/action', () => {
    render(
      <EmptyState
        eyebrow="empty"
        title="no findings"
        body="run the agent to populate this list"
        action={<button type="button">start</button>}
      />,
    )
    expect(screen.getByText('empty')).toBeTruthy()
    expect(screen.getByText('no findings')).toBeTruthy()
    expect(screen.getByText('run the agent to populate this list')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'start' })).toBeTruthy()
  })

  it('ScrollPin hides when 0 lines pinned, shows count and follow when >0', () => {
    const onFollow = vi.fn()
    const { rerender } = render(<ScrollPin pinnedLines={0} onFollow={onFollow} />)
    expect(screen.queryByRole('button')).toBeNull()
    rerender(<ScrollPin pinnedLines={12} onFollow={onFollow} />)
    const btn = screen.getByRole('button', { name: /follow stream/i })
    btn.click()
    expect(onFollow).toHaveBeenCalledOnce()
    expect(btn.textContent).toContain('12')
  })
})
