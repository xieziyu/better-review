import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { Combobox } from '@/components/ui'

interface Repo {
  path: string
  hint?: string
}

const REPOS: Repo[] = [
  { path: '/repo/a', hint: '5 min ago' },
  { path: '/repo/b', hint: 'yesterday' },
]

function Harness({ initial = '' }: { initial?: string } = {}) {
  const [value, setValue] = useState(initial)
  return (
    <div>
      <Combobox
        value={value}
        onChange={setValue}
        options={REPOS}
        getValue={(r) => r.path}
        getKey={(r) => r.path}
        renderOption={(r) => (
          <>
            <span>{r.path}</span>
            {r.hint ? <span data-testid="hint">{r.hint}</span> : null}
          </>
        )}
        ariaLabel="repo path"
        menuAriaLabel="recent repos"
      />
      <div data-testid="echo">{value}</div>
    </div>
  )
}

describe('Combobox', () => {
  it('opens the listbox when the chevron is clicked and picks an option into the input', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: /recent repos/i }))
    const listbox = await screen.findByRole('listbox', { name: /recent repos/i })
    expect(listbox).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /\/repo\/a/i }))
    expect(screen.getByTestId('echo').textContent).toBe('/repo/a')
    // Panel should close after selection.
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('opens on input focus and stays open while typing free-text', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getByRole('combobox', { name: /repo path/i })
    await user.click(input)
    expect(await screen.findByRole('listbox')).toBeInTheDocument()
    await user.keyboard('/custom/path/not-in-list')
    expect(screen.getByTestId('echo').textContent).toBe('/custom/path/not-in-list')
    // Custom text doesn't match any option → no option is marked selected.
    for (const opt of screen.getAllByRole('option')) {
      expect(opt).toHaveAttribute('aria-selected', 'false')
    }
  })

  it('marks the matching option as selected when value equals an option', async () => {
    const user = userEvent.setup()
    render(<Harness initial="/repo/b" />)
    await user.click(screen.getByRole('button', { name: /recent repos/i }))
    expect(screen.getByRole('option', { name: /\/repo\/b/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('option', { name: /\/repo\/a/i })).toHaveAttribute(
      'aria-selected',
      'false',
    )
  })

  it('closes on Escape and on pointerdown outside the wrapper', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <Harness />
        <button>outside</button>
      </div>,
    )
    await user.click(screen.getByRole('button', { name: /recent repos/i }))
    expect(await screen.findByRole('listbox')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /recent repos/i }))
    expect(await screen.findByRole('listbox')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'outside' }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('renders the empty hint when options is empty', async () => {
    const user = userEvent.setup()
    function EmptyHarness() {
      const [v, setV] = useState('')
      return (
        <Combobox
          value={v}
          onChange={setV}
          options={[] as Repo[]}
          getValue={(r) => r.path}
          getKey={(r) => r.path}
          renderOption={(r) => <span>{r.path}</span>}
          ariaLabel="repo path"
          menuAriaLabel="recent repos"
          emptyHint={<span>no results</span>}
        />
      )
    }
    render(<EmptyHarness />)
    await user.click(screen.getByRole('button', { name: /recent repos/i }))
    expect(await screen.findByText('no results')).toBeInTheDocument()
  })
})
