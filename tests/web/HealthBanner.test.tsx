import type { HealthStatus } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import { HealthBanner } from '@/components/HealthBanner'

function withClient(ui: React.ReactNode, initial?: { health?: HealthStatus }): React.ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (initial?.health) qc.setQueryData(['health'], initial.health)
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

const healthy: HealthStatus = {
  ok: true,
  claude: { found: true, path: '/usr/local/bin/claude' },
  gh: { found: true, path: '/usr/local/bin/gh', authed: true },
  daemon: { pid: 1, port: 7345, startedAt: 0 },
}

describe('HealthBanner', () => {
  it('renders nothing when claude and gh are healthy', () => {
    const { container } = render(withClient(<HealthBanner />, { health: healthy }))
    expect(container.firstChild).toBeNull()
  })

  it('warns when claude is missing', () => {
    render(withClient(<HealthBanner />, { health: { ...healthy, claude: { found: false } } }))
    expect(screen.getByRole('alert')).toHaveTextContent(/claude.*not found/i)
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
