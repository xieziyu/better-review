import type { HealthStatus } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DaemonStatus } from '@/components/DaemonStatus'
import { copyTextToClipboard } from '@/lib/export-clipboard'

vi.mock('@/lib/export-clipboard', () => ({
  copyTextToClipboard: vi.fn().mockResolvedValue(undefined),
}))

function withClient(ui: React.ReactNode, health: HealthStatus) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['health'], health)
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

const healthy: HealthStatus = {
  ok: true,
  agents: {
    claude: { found: true, path: '/usr/local/bin/claude' },
    codex: { found: true, path: '/usr/local/bin/codex' },
    pi: { found: true, path: '/usr/local/bin/pi' },
  },
  defaultAgent: 'claude',
  gh: { found: true, path: '/usr/local/bin/gh', authed: true },
  fs: { folderPicker: { supported: true } },
  daemon: {
    pid: 4242,
    port: 7345,
    startedAt: Date.now() - 2 * 60 * 60 * 1000 - 15 * 60 * 1000, // 2h 15m ago
    home: '/Users/x/.better-review',
    logPath: '/Users/x/.better-review/daemon.log',
    version: '0.1.1',
  },
}

describe('DaemonStatus', () => {
  beforeEach(() => {
    vi.mocked(copyTextToClipboard).mockClear()
  })

  it('renders a green dot when default agent + gh are healthy', () => {
    render(withClient(<DaemonStatus />, healthy))
    const trigger = screen.getByRole('button', { name: /daemon healthy/i })
    expect(trigger).toBeInTheDocument()
    // Dot color encoded via class on the inner span
    const dot = trigger.querySelector('span')
    expect(dot?.className).toMatch(/bg-accent-ready/)
  })

  it('renders a green dot when only one agent is present', () => {
    render(
      withClient(<DaemonStatus />, {
        ...healthy,
        agents: {
          claude: { found: true, path: '/x' },
          codex: { found: false },
          pi: { found: false },
        },
      }),
    )
    const trigger = screen.getByRole('button', { name: /daemon healthy/i })
    expect(trigger.querySelector('span')?.className).toMatch(/bg-accent-ready/)
  })

  it('renders a green dot when the default agent is missing but a fallback agent exists', () => {
    render(
      withClient(<DaemonStatus />, {
        ...healthy,
        agents: {
          claude: { found: false },
          codex: { found: true, path: '/x' },
          pi: { found: true, path: '/y' },
        },
      }),
    )
    const trigger = screen.getByRole('button', { name: /daemon healthy/i })
    expect(trigger.querySelector('span')?.className).toMatch(/bg-accent-ready/)
  })

  it('renders a red dot when no agent is found', () => {
    render(
      withClient(<DaemonStatus />, {
        ...healthy,
        agents: {
          claude: { found: false },
          codex: { found: false },
          pi: { found: false },
        },
      }),
    )
    const trigger = screen.getByRole('button', { name: /daemon has blockers/i })
    expect(trigger.querySelector('span')?.className).toMatch(/bg-severity-must/)
  })

  it('renders a red dot when gh is not authed', () => {
    render(
      withClient(<DaemonStatus />, {
        ...healthy,
        gh: { found: true, path: '/usr/local/bin/gh', authed: false },
      }),
    )
    const trigger = screen.getByRole('button', { name: /daemon has blockers/i })
    expect(trigger.querySelector('span')?.className).toMatch(/bg-severity-must/)
  })

  it('opens the popover on click and shows pid/port/version/uptime + path rows', async () => {
    const user = userEvent.setup()
    render(withClient(<DaemonStatus />, healthy))
    await user.click(screen.getByRole('button', { name: /daemon healthy/i }))
    const popover = await screen.findByRole('dialog', { name: /daemon status/i })
    expect(popover).toHaveTextContent(/pid 4242/)
    expect(popover).toHaveTextContent(/port 7345/)
    expect(popover).toHaveTextContent(/v0\.1\.1/)
    expect(popover).toHaveTextContent(/Daemon up 2h/)
    expect(popover).toHaveTextContent('/Users/x/.better-review')
    expect(popover).toHaveTextContent('/Users/x/.better-review/daemon.log')
  })

  it('copies a path to the clipboard and shows a copied state', async () => {
    const user = userEvent.setup()
    render(withClient(<DaemonStatus />, healthy))
    await user.click(screen.getByRole('button', { name: /daemon healthy/i }))
    const popover = await screen.findByRole('dialog', { name: /daemon status/i })

    const copyButtons = within(popover).getAllByRole('button', { name: 'Copy' })
    expect(copyButtons).toHaveLength(2)

    await user.click(copyButtons[0]!)
    expect(copyTextToClipboard).toHaveBeenCalledWith('/Users/x/.better-review')
    expect(within(popover).getByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('marks the default agent in the popover', async () => {
    const user = userEvent.setup()
    render(withClient(<DaemonStatus />, healthy))
    await user.click(screen.getByRole('button', { name: /daemon healthy/i }))
    await screen.findByRole('dialog')
    // The default tag renders on the default agent's row (claude in this fixture).
    expect(screen.getByText('claude').closest('li')).toHaveTextContent(/default/i)
  })

  it('closes the popover on Escape', async () => {
    const user = userEvent.setup()
    render(withClient(<DaemonStatus />, healthy))
    await user.click(screen.getByRole('button', { name: /daemon healthy/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
