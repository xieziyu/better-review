import type { AppConfig, HealthStatus } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Settings } from '@/pages/Settings'

const baseConfig: AppConfig = {
  port: 0,
  maxConcurrentReviews: 4,
  stallMinutes: 3,
  defaultAgent: 'claude',
  perPRGCDays: 7,
  language: 'en',
  reviewExcludeGlobs: [],
  diffViewMode: 'unified',
}

const baseHealth: HealthStatus = {
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
    startedAt: 1700000000000,
    home: '/Users/x/.better-review',
    logPath: '/Users/x/.better-review/daemon.log',
    version: '0.1.1',
  },
}

function renderSettings(opts?: { config?: AppConfig; health?: HealthStatus }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  qc.setQueryData(['config'], {
    config: opts?.config ?? baseConfig,
    file: '/Users/x/.better-review/config.json',
  })
  qc.setQueryData(['health'], opts?.health ?? baseHealth)
  const utils = render(
    <QueryClientProvider client={qc}>
      <Settings />
    </QueryClientProvider>,
  )
  return { ...utils, qc }
}

describe('Settings', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('renders all fields with current values and the config file path', () => {
    renderSettings({ config: { ...baseConfig, reviewExcludeGlobs: ['*.snap'] } })
    expect(screen.getByText(/\.better-review\/config\.json/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /default agent/i })).toHaveTextContent('claude')
    expect(screen.getByLabelText(/stall minutes/i)).toHaveValue(3)
    expect(screen.getByLabelText(/per-pr gc days/i)).toHaveValue(7)
    expect(screen.getByLabelText(/max concurrent reviews/i)).toHaveValue(4)
    expect(screen.getByLabelText(/^port$/i)).toHaveValue(0)
    expect(screen.getByLabelText(/review-exclude globs/i)).toHaveValue('*.snap')
  })

  it('does not read as dirty on mount when reviewExcludeGlobs is pre-populated', () => {
    renderSettings({ config: { ...baseConfig, reviewExcludeGlobs: ['*.snap', 'dist/**'] } })
    expect(screen.getByLabelText(/review-exclude globs/i)).toHaveValue('*.snap\ndist/**')
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
  })

  it('marks the form dirty and PUTs the entered globs when editing reviewExcludeGlobs', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ config: baseConfig }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    renderSettings()
    const globs = screen.getByLabelText(/review-exclude globs/i)
    const save = screen.getByRole('button', { name: /^save$/i })
    expect(save).toBeDisabled()

    await user.type(globs, '*.generated.ts{enter}docs/api/**')
    expect(save).toBeEnabled()
    await user.click(save)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      reviewExcludeGlobs: ['*.generated.ts', 'docs/api/**'],
    })
  })

  it('marks restart-required fields with a tag', () => {
    renderSettings()
    const tags = screen.getAllByText(/restart required/i)
    expect(tags.length).toBeGreaterThanOrEqual(2)
  })

  it('shows each agent availability inside the opened dropdown', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderSettings({
      health: {
        ...baseHealth,
        agents: {
          claude: { found: true, path: '/x' },
          codex: { found: false },
          pi: { found: false },
        },
      },
    })
    await user.click(screen.getByRole('button', { name: /default agent/i }))
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(3)
    // Missing agents are flagged; the found one is not.
    expect(screen.getAllByText(/not found/i)).toHaveLength(2)
    expect(screen.getByRole('menuitemradio', { name: /claude/i })).not.toHaveTextContent(
      /not found/i,
    )
  })

  it('Save is disabled until the form is dirty, and Discard restores the original', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderSettings()
    const save = screen.getByRole('button', { name: /^save$/i })
    const discard = screen.getByRole('button', { name: /discard/i })
    expect(save).toBeDisabled()
    expect(discard).toBeDisabled()

    const stall = screen.getByLabelText(/stall minutes/i)
    await user.clear(stall)
    await user.type(stall, '5')
    expect(stall).toHaveValue(5)
    expect(save).toBeEnabled()
    expect(discard).toBeEnabled()

    await user.click(discard)
    expect(stall).toHaveValue(3)
    expect(save).toBeDisabled()
  })

  it('shows a validation error and disables Save when stallMinutes is out of range', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderSettings()
    const stall = screen.getByLabelText(/stall minutes/i)
    await user.clear(stall)
    await user.type(stall, '999')
    expect(screen.getByText(/between 1 and 60/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
  })

  it('PUTs the form on Save and shows the success flash', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ config: { ...baseConfig, stallMinutes: 5 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    renderSettings()

    const stall = screen.getByLabelText(/stall minutes/i)
    await user.clear(stall)
    await user.type(stall, '5')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/config')
    expect((init as RequestInit).method).toBe('PUT')
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ stallMinutes: 5 })

    await waitFor(() => expect(screen.getByText(/^saved$/i)).toBeInTheDocument())
  })

  it('keeps the language dropdown in lockstep with the cached config (top-bar switcher)', async () => {
    const { qc } = renderSettings()
    expect(screen.getByRole('button', { name: /^language$/i })).toHaveTextContent('English')
    // Simulate the top-bar LanguageSwitcher: it persists via PUT and updates
    // the shared TanStack Query cache. The Settings dropdown must follow.
    qc.setQueryData(['config'], {
      config: { ...baseConfig, language: 'zh-CN' as const },
      file: '/Users/x/.better-review/config.json',
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^language$/i })).toHaveTextContent('简体中文'),
    )
    // Form is back to clean — the external change matched the server, so
    // Save stays disabled rather than reading as a pending user edit.
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
  })

  it('reflects the configured diff layout and PUTs the chosen value', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ config: { ...baseConfig, diffViewMode: 'split' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    renderSettings({ config: { ...baseConfig, diffViewMode: 'unified' } })

    const trigger = screen.getByRole('button', { name: /diff layout/i })
    expect(trigger).toHaveTextContent('Unified')
    await user.click(trigger)
    await user.click(screen.getByRole('menuitemradio', { name: /split/i }))
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      diffViewMode: 'split',
    })
  })

  it('renders an inline error when the save mutation fails', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'port: must be ≤ 65535' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    )
    renderSettings()
    const stall = screen.getByLabelText(/stall minutes/i)
    await user.clear(stall)
    await user.type(stall, '5')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(screen.getByText(/port: must be ≤ 65535/i)).toBeInTheDocument())
  })
})
