import type { HealthStatus } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'

import { HealthBanner } from '@/components/HealthBanner'

function withClient(ui: React.ReactNode, initial?: { health?: HealthStatus }): React.ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (initial?.health) qc.setQueryData(['health'], initial.health)
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

const healthy: HealthStatus = {
  ok: true,
  agents: {
    claude: { found: true, path: '/usr/local/bin/claude' },
    codex: { found: true, path: '/usr/local/bin/codex' },
  },
  defaultAgent: 'claude',
  gh: { found: true, path: '/usr/local/bin/gh', authed: true },
  fs: { folderPicker: { supported: true } },
  daemon: { pid: 1, port: 7345, startedAt: 0 },
}

describe('HealthBanner', () => {
  it('renders nothing when default agent and gh are healthy', () => {
    const { container } = render(withClient(<HealthBanner />, { health: healthy }))
    expect(container.firstChild).toBeNull()
  })

  it('warns when the default agent is missing', () => {
    render(
      withClient(<HealthBanner />, {
        health: {
          ...healthy,
          agents: { claude: { found: false }, codex: { found: true, path: '/x' } },
        },
      }),
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/default agent.*claude.*not found/i)
  })

  it('stays quiet when a non-default agent is missing', () => {
    const { container } = render(
      withClient(<HealthBanner />, {
        health: {
          ...healthy,
          agents: { claude: { found: true, path: '/x' }, codex: { found: false } },
        },
      }),
    )
    expect(container.firstChild).toBeNull()
  })

  it('warns when gh is not authed', () => {
    render(
      withClient(<HealthBanner />, {
        health: { ...healthy, gh: { found: true, path: '/x', authed: false } },
      }),
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/gh.*not authenticated/i)
  })

  it('warns when gh CLI is missing', () => {
    render(
      withClient(<HealthBanner />, {
        health: { ...healthy, gh: { found: false, authed: false } },
      }),
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/gh.*not found/i)
  })
})
