import type { PromptStateResponse, PRSession } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'

import { PromptEditor } from '@/pages/PromptEditor'

// The component fetches prompt state per repo: `['prompts', null]` with no repo
// pinned, `['prompts', '/proj']` once a repo is entered. Seed both keys with the
// same payload so tests can switch into the Project tab's repo context.
function withClient(
  ui: React.ReactNode,
  state: { prompts?: PromptStateResponse; sessions?: PRSession[]; route?: string } = {},
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  if (state.prompts) {
    qc.setQueryData(['prompts', null], state.prompts)
    qc.setQueryData(['prompts', '/proj'], state.prompts)
  }
  if (state.sessions) qc.setQueryData(['sessions'], state.sessions)
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[state.route ?? '/prompt']}>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

const baseState: PromptStateResponse = {
  repo: '/proj',
  framework: { content: '# framework body with {{RULES}} placeholder' },
  rules: {
    effective: { source: 'builtin', content: '# builtin rules body', path: null },
    scopes: {
      project: { exists: false, content: null, path: '/proj/.better-review/review.md' },
      global: { exists: false, content: null, path: '/home/.better-review/review.md' },
    },
  },
}

// Enters a repo path into the repo selector so the Project tab has a repo to
// resolve against. The selector renders on the Guidelines and Project tabs
// (both depend on the project tier), so callers on either tab can use it.
async function pickRepo(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/local repository path for project rules/i), '/proj')
}

describe('PromptEditor', () => {
  it('defaults to the Guidelines tab and shows the rules source indicator', () => {
    render(withClient(<PromptEditor />, { prompts: baseState }))
    expect(screen.getByRole('tab', { name: /guidelines/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByTestId('prompt-source')).toHaveTextContent(/builtin/i)
    expect(screen.getByLabelText(/review guidelines/i)).toHaveValue('# builtin rules body')
  })

  it('seeds the repo selector from the ?repo= query param', () => {
    render(
      withClient(<PromptEditor />, {
        prompts: baseState,
        route: `/prompt?repo=${encodeURIComponent('/proj')}`,
      }),
    )
    expect(screen.getByLabelText(/local repository path for project rules/i)).toHaveValue('/proj')
  })

  it('Framework tab renders read-only framework content', async () => {
    const user = userEvent.setup()
    render(withClient(<PromptEditor />, { prompts: baseState }))
    await user.click(screen.getByRole('tab', { name: /framework/i }))
    const ta = screen.getByLabelText(/^framework$/i) as HTMLTextAreaElement
    expect(ta).toHaveAttribute('readonly')
    expect(ta.value).toContain('{{RULES}}')
  })

  it('shows the repo selector on Guidelines and Project, hides it on Framework and Global', async () => {
    const user = userEvent.setup()
    render(withClient(<PromptEditor />, { prompts: baseState }))
    const selector = () => screen.queryByLabelText(/local repository path for project rules/i)

    // Guidelines (default) and Project resolve through the project tier.
    expect(selector()).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /project/i }))
    expect(selector()).toBeInTheDocument()

    // Framework and Global don't depend on a repo.
    await user.click(screen.getByRole('tab', { name: /framework/i }))
    expect(selector()).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /global/i }))
    expect(selector()).not.toBeInTheDocument()
  })

  it('Project tab prompts to pick a repo when none is selected', async () => {
    const user = userEvent.setup()
    render(withClient(<PromptEditor />, { prompts: baseState }))
    await user.click(screen.getByRole('tab', { name: /project/i }))
    expect(screen.getByText(/select a repo above/i)).toBeInTheDocument()
  })

  it("shows 'Override at this scope' when project has no override", async () => {
    const user = userEvent.setup()
    render(withClient(<PromptEditor />, { prompts: baseState }))
    await user.click(screen.getByRole('tab', { name: /project/i }))
    await pickRepo(user)
    expect(screen.getByRole('button', { name: /override at this scope/i })).toBeInTheDocument()
  })

  it('renders an editable textarea on Project when an override exists', async () => {
    const user = userEvent.setup()
    const state: PromptStateResponse = {
      ...baseState,
      rules: {
        effective: {
          source: 'project',
          content: '# project body',
          path: '/proj/.better-review/review.md',
        },
        scopes: {
          ...baseState.rules.scopes,
          project: {
            exists: true,
            content: '# project body',
            path: '/proj/.better-review/review.md',
          },
        },
      },
    }
    render(withClient(<PromptEditor />, { prompts: state }))
    await user.click(screen.getByRole('tab', { name: /project/i }))
    await pickRepo(user)
    const ta = screen.getByLabelText(/^project rules$/i) as HTMLTextAreaElement
    expect(ta).not.toHaveAttribute('readonly')
    expect(ta.value).toBe('# project body')
  })

  it('disables Save until the textarea is dirty', async () => {
    const user = userEvent.setup()
    const state: PromptStateResponse = {
      ...baseState,
      rules: {
        ...baseState.rules,
        scopes: {
          ...baseState.rules.scopes,
          global: {
            exists: true,
            content: 'old',
            path: '/home/.better-review/review.md',
          },
        },
      },
    }
    render(withClient(<PromptEditor />, { prompts: state }))
    await user.click(screen.getByRole('tab', { name: /global/i }))
    const save = screen.getByRole('button', { name: /^save/i })
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText(/global rules/i), 'x')
    expect(save).not.toBeDisabled()
  })

  it("hides 'Apply to current session' when no eligible sessions", async () => {
    const user = userEvent.setup()
    render(withClient(<PromptEditor />, { prompts: baseState, sessions: [] }))
    await user.click(screen.getByRole('tab', { name: /project/i }))
    await pickRepo(user)
    expect(
      screen.queryByRole('button', { name: /apply to current session/i }),
    ).not.toBeInTheDocument()
  })

  it("shows 'Apply to current session' when a session for the same repo exists and editor is clean", async () => {
    const user = userEvent.setup()
    const sessions: PRSession[] = [
      {
        id: 's1',
        owner: 'a',
        repo: 'b',
        number: 1,
        title: 'T',
        author: 'u',
        url: null,
        baseRef: null,
        headRef: null,
        status: 'ready',
        agent: 'claude',
        createdAt: 0,
        updatedAt: 0,
        workdir: '',
        localRepoPath: '/proj',
        sourceKind: null,
        sourceRefName: null,
        promptUsed: '',
        extraPrompt: null,
        headSha: null,
        reviewSummary: null,
        excludedFiles: [],
        error: null,
      },
    ]
    const state: PromptStateResponse = {
      ...baseState,
      rules: {
        ...baseState.rules,
        scopes: {
          ...baseState.rules.scopes,
          project: {
            exists: true,
            content: '# project body',
            path: '/proj/.better-review/review.md',
          },
        },
      },
    }
    render(withClient(<PromptEditor />, { prompts: state, sessions }))
    await user.click(screen.getByRole('tab', { name: /project/i }))
    await pickRepo(user)
    expect(screen.getByRole('button', { name: /apply to current session/i })).toBeInTheDocument()
  })
})
