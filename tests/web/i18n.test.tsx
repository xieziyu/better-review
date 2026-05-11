import { render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it } from 'vitest'

import { EmptyState } from '../../src/web/components/ui'
import en from '../../src/web/i18n/locales/en.json'
import zhCN from '../../src/web/i18n/locales/zh-CN.json'

describe('i18n', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('zh-CN dictionary covers every key in the English dictionary', () => {
    // i18next will fall back to English when a key is missing, but that
    // produces silent EN text inside a ZH UI. Catch missing keys at test
    // time instead.
    const missing: string[] = []
    function walk(prefix: string, en: unknown, zh: unknown): void {
      if (typeof en === 'string') {
        if (typeof zh !== 'string') missing.push(prefix)
        return
      }
      if (en && typeof en === 'object') {
        for (const [k, v] of Object.entries(en as Record<string, unknown>)) {
          walk(prefix ? `${prefix}.${k}` : k, v, (zh as Record<string, unknown> | undefined)?.[k])
        }
      }
    }
    walk('', en, zhCN)
    expect(missing).toEqual([])
  })

  it('renders Chinese strings when the language is zh-CN', async () => {
    await i18n.changeLanguage('zh-CN')
    render(
      <I18nextProvider i18n={i18n}>
        <EmptyState eyebrow="" title="占位" body="" />
      </I18nextProvider>,
    )
    expect(screen.getByText('占位')).toBeInTheDocument()
  })

  it('exposes both languages from the public LANGUAGES list', async () => {
    const { LANGUAGES } = await import('../../src/shared/types')
    expect(LANGUAGES).toEqual(['en', 'zh-CN'])
  })

  it('translates the language selector option labels', () => {
    expect(i18n.t('settings.language.options.en')).toBe('English')
    expect(i18n.t('settings.language.options.zh-CN', { lng: 'zh-CN' })).toBe('简体中文')
  })

  it('looks up the prep phase labels by stable phase id', async () => {
    expect(i18n.t('prep.phase.prep:fetching-pr')).toBe('Fetching PR metadata')
    expect(i18n.t('prep.phase.prep:fetching-pr', { lng: 'zh-CN' })).toBe('获取 PR 元数据')
    expect(i18n.t('prep.phase.prep:starting', { agent: 'claude' })).toBe('Starting claude')
    expect(i18n.t('prep.phase.prep:starting', { lng: 'zh-CN', agent: 'claude' })).toBe(
      '启动 claude',
    )
  })
})
