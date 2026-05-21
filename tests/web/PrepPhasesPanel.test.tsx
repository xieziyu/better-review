import type { PrepCall, PrepStep } from '@shared/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PrepPhasesPanel } from '@/components/PrepPhasesPanel'

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

describe('PrepPhasesPanel', () => {
  it('renders nothing when there are no phases and no calls', () => {
    const { container } = render(<PrepPhasesPanel steps={[]} calls={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a row per entered phase using i18n labels', () => {
    render(
      <PrepPhasesPanel
        steps={[phase('prep:fetching-pr', 1), phase('prep:fetching-diff', 2)]}
        calls={[]}
      />,
    )
    expect(screen.getByText(/Fetching PR metadata/i)).toBeInTheDocument()
    expect(screen.getByText(/Fetching diff/i)).toBeInTheDocument()
  })

  it('shows captured command + stdout when a row is expanded', () => {
    render(<PrepPhasesPanel steps={[phase('prep:fetching-pr')]} calls={[call()]} />)
    // Stdout starts collapsed.
    expect(screen.queryByText(/"number":12/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Fetching PR metadata/i }))
    expect(screen.getByText(/gh pr view 12/)).toBeInTheDocument()
    expect(screen.getByText(/"number":12/)).toBeInTheDocument()
  })

  it('marks a phase with no captured calls as muted and disables expand', () => {
    render(<PrepPhasesPanel steps={[phase('prep:rendering-prompt')]} calls={[]} />)
    const btn = screen.getByRole('button', { name: /Assembling prompt/i })
    expect(btn).toBeDisabled()
    expect(screen.getByText(/no captured output/i)).toBeInTheDocument()
  })

  it('attaches calls under a synthetic phase row when no markPhase fired yet', () => {
    render(<PrepPhasesPanel steps={[]} calls={[call({ phase: 'prep:fetching-pr' })]} />)
    expect(screen.getByText(/Fetching PR metadata/i)).toBeInTheDocument()
    expect(screen.getByText(/1 call/i)).toBeInTheDocument()
  })

  it('renders stderr in the severity-must color when non-empty', () => {
    render(
      <PrepPhasesPanel
        steps={[phase('prep:fetching-pr')]}
        calls={[
          call({
            stdout: '',
            stderr: 'GraphQL: not found',
            exitCode: 1,
          }),
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Fetching PR metadata/i }))
    const errPre = screen.getByText(/GraphQL: not found/)
    expect(errPre.className).toMatch(/severity-must/)
  })
})
