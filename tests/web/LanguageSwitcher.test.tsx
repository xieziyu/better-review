import type { AppConfig } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LanguageSwitcher } from '@/components/LanguageSwitcher'

const baseConfig: AppConfig = {
  port: 0,
  maxConcurrentReviews: 4,
  stallMinutes: 3,
  defaultAgent: 'claude',
  perPRGCDays: 7,
  language: 'en',
}

function renderSwitcher(opts?: { config?: AppConfig }) {
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
  return render(
    <QueryClientProvider client={qc}>
      <LanguageSwitcher />
    </QueryClientProvider>,
  )
}

describe('LanguageSwitcher', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await i18n.changeLanguage('en')
  })

  it('renders the globe trigger with a localized aria-label', () => {
    renderSwitcher()
    expect(screen.getByRole('button', { name: /change language/i })).toBeInTheDocument()
  })

  it('opens the menu and marks the current language as checked', async () => {
    const user = userEvent.setup()
    renderSwitcher()
    await user.click(screen.getByRole('button', { name: /change language/i }))
    const menu = await screen.findByRole('menu', { name: /language menu/i })
    expect(menu).toBeInTheDocument()
    const en = screen.getByRole('menuitemradio', { name: /english/i })
    const zh = screen.getByRole('menuitemradio', { name: /简体中文/ })
    expect(en).toHaveAttribute('aria-checked', 'true')
    expect(zh).toHaveAttribute('aria-checked', 'false')
  })

  it('PUTs /api/config with the new language when picking the other option', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ config: { ...baseConfig, language: 'zh-CN' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    renderSwitcher()

    await user.click(screen.getByRole('button', { name: /change language/i }))
    await user.click(screen.getByRole('menuitemradio', { name: /简体中文/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/config')
    expect((init as RequestInit).method).toBe('PUT')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({ ...baseConfig, language: 'zh-CN' })
  })

  it('does not PUT when the user re-selects the current language', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    renderSwitcher()

    await user.click(screen.getByRole('button', { name: /change language/i }))
    await user.click(screen.getByRole('menuitemradio', { name: /english/i }))

    expect(fetchMock).not.toHaveBeenCalled()
    // Menu closes after selection.
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes the menu on Escape', async () => {
    const user = userEvent.setup()
    renderSwitcher()
    await user.click(screen.getByRole('button', { name: /change language/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('reflects zh-CN initial state with a checked Chinese row and a localized trigger', async () => {
    await i18n.changeLanguage('zh-CN')
    const user = userEvent.setup()
    renderSwitcher({ config: { ...baseConfig, language: 'zh-CN' } })
    await user.click(screen.getByRole('button', { name: /切换语言/ }))
    const zh = screen.getByRole('menuitemradio', { name: /简体中文/ })
    expect(zh).toHaveAttribute('aria-checked', 'true')
  })
})
