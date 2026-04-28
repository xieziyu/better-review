import type { HealthStatus } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import { Settings } from '@/pages/Settings'

function withClient(ui: React.ReactNode, health?: HealthStatus) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (health) qc.setQueryData(['health'], health)
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

const healthy: HealthStatus = {
  ok: true,
  claude: { found: true, path: '/usr/local/bin/claude' },
  gh: { found: true, path: '/usr/local/bin/gh', authed: true },
  daemon: { pid: 4242, port: 7345, startedAt: 1700000000000 },
}

describe('Settings', () => {
  it('renders the config snippet with documented keys', () => {
    render(withClient(<Settings />, healthy))
    const snippet = screen.getByTestId('config-snippet').textContent ?? ''
    expect(snippet).toMatch(/idleShutdownMinutes/)
    expect(snippet).toMatch(/maxConcurrentReviews/)
    expect(snippet).toMatch(/claudeStallMinutes/)
  })

  it('shows daemon and tooling info from health', () => {
    render(withClient(<Settings />, healthy))
    expect(screen.getByTestId('daemon-pid')).toHaveTextContent('4242')
    expect(screen.getByTestId('daemon-port')).toHaveTextContent('7345')
    expect(screen.getByTestId('claude-path')).toHaveTextContent('/usr/local/bin/claude')
    expect(screen.getByTestId('gh-path')).toHaveTextContent('/usr/local/bin/gh')
  })

  it('renders without health data', () => {
    render(withClient(<Settings />))
    expect(screen.getByText(/Settings/i)).toBeInTheDocument()
    expect(screen.queryByTestId('daemon-pid')).not.toBeInTheDocument()
  })
})
