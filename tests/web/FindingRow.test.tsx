import type { Finding } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { FindingRow } from '@/components/FindingRow'
import { SelectionProvider, useSelectedFinding } from '@/lib/selection'

function withProviders(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <QueryClientProvider client={qc}>
      <SelectionProvider>{ui}</SelectionProvider>
    </QueryClientProvider>
  )
}

const finding: Finding = {
  id: 'R1',
  dbId: 'd1',
  sessionId: 's1',
  ord: 1,
  severity: 'must',
  category: 'Type Safety',
  file: 'src/x.ts',
  line: 42,
  title: 'Verify JWT signature',
  body: 'body',
  selected: true,
  edited: false,
  archived: false,
  createdAt: 0,
  source: 'agent',
  submittedAt: null,
  submittedCommentId: null,
}

function SelectionProbe() {
  const { selectedFindingDbId } = useSelectedFinding()
  return <div data-testid="probe">{selectedFindingDbId ?? 'none'}</div>
}

describe('FindingRow', () => {
  it('renders title, severity, category, and file:line in a single row', () => {
    render(withProviders(<FindingRow finding={finding} sessionId="s1" />))
    expect(screen.getByText(/Verify JWT signature/)).toBeInTheDocument()
    expect(screen.getByLabelText('src/x.ts:42')).toBeInTheDocument()
    expect(screen.getByText('Type Safety')).toBeInTheDocument()
    expect(screen.getByLabelText(/severity: must/i)).toBeInTheDocument()
  })

  it('clicking the row sets the selected finding in context', async () => {
    const user = userEvent.setup()
    render(
      withProviders(
        <>
          <FindingRow finding={finding} sessionId="s1" />
          <SelectionProbe />
        </>,
      ),
    )
    expect(screen.getByTestId('probe').textContent).toBe('none')
    await user.click(screen.getByText(/Verify JWT signature/))
    expect(screen.getByTestId('probe').textContent).toBe('d1')
  })

  it('checkbox click does not trigger row selection', async () => {
    const user = userEvent.setup()
    render(
      withProviders(
        <>
          <FindingRow finding={finding} sessionId="s1" />
          <SelectionProbe />
        </>,
      ),
    )
    await user.click(screen.getByRole('button', { name: /unselect finding R1/i }))
    expect(screen.getByTestId('probe').textContent).toBe('none')
  })

  it('marks the row active when its dbId matches the selection', async () => {
    const user = userEvent.setup()
    function Wrapper() {
      const { setSelectedFindingDbId } = useSelectedFinding()
      return (
        <>
          <button type="button" onClick={() => setSelectedFindingDbId('d1')}>
            select
          </button>
          <FindingRow finding={finding} sessionId="s1" />
        </>
      )
    }
    render(withProviders(<Wrapper />))
    await user.click(screen.getByRole('button', { name: /^select$/ }))
    const row = document.querySelector('[data-finding-id="d1"]')
    expect(row?.getAttribute('data-active')).toBe('true')
  })
})
