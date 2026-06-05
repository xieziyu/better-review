import type { Finding, PRSession } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Stub heavy pieces so jsdom doesn't pull Shiki WASM or actually mount the
// react-diff-view widgets (which expect a real layout). The test focuses on
// the FilesChangedView's structural contract: tree + diff pane scaffolding.
vi.mock('@/components/files-changed/FileDiff', () => ({
  FileDiff: ({ file, viewType }: { file: string; viewType?: string }) => (
    <div data-testid="file-diff" data-file={file} data-view={viewType ?? 'unified'}>
      diff-for {file}
    </div>
  ),
}))

vi.mock('@/components/CodeBlock', () => ({
  CodeBlock: ({ code, children }: { code?: string; children?: React.ReactNode }) => (
    <pre data-testid="codeblock">{code ?? children}</pre>
  ),
}))

import { FilesChangedView } from '@/components/files-changed/FilesChangedView'
import { SelectionProvider } from '@/lib/selection'

const session: PRSession = {
  id: 's1',
  owner: 'o',
  repo: 'r',
  number: 1,
  title: null,
  author: null,
  url: null,
  baseRef: null,
  headRef: null,
  status: 'ready',
  agent: 'claude',
  createdAt: 0,
  updatedAt: 0,
  workdir: '',
  localRepoPath: null,
  sourceKind: null,
  sourceRefName: null,
  promptUsed: '',
  extraPrompt: null,
  headSha: null,
  reviewSummary: null,
  excludedFiles: [],
  error: null,
}

const DIFF = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 a
+b
 c
 d
diff --git a/src/bar.ts b/src/bar.ts
--- a/src/bar.ts
+++ b/src/bar.ts
@@ -1,2 +1,3 @@
 x
+y
 z
`

function withProviders(node: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <QueryClientProvider client={qc}>
      <SelectionProvider>{node}</SelectionProvider>
    </QueryClientProvider>
  )
}

const findings: Finding[] = [
  {
    id: 'R1',
    dbId: 'd1',
    sessionId: 's1',
    ord: 1,
    severity: 'must',
    category: 'C',
    file: 'src/foo.ts',
    line: 2,
    title: 'foo issue',
    body: 'b',
    selected: true,
    edited: false,
    archived: false,
    createdAt: 0,
    source: 'agent',
    submittedAt: null,
    submittedCommentId: null,
  },
  {
    id: 'R2',
    dbId: 'd2',
    sessionId: 's1',
    ord: 2,
    severity: 'should',
    category: 'C',
    file: 'src/bar.ts',
    line: 2,
    title: 'bar issue',
    body: 'b',
    selected: true,
    edited: false,
    archived: false,
    createdAt: 0,
    source: 'agent',
    submittedAt: null,
    submittedCommentId: null,
  },
]

beforeEach(() => {
  // Viewed state and collapsed folders are persisted per-session in
  // localStorage; clear it so cases don't leak through the shared session id.
  window.localStorage.clear()
})

describe('FilesChangedView', () => {
  it('renders a file tree row per diff file and selects the first one by default', () => {
    const onSelect = vi.fn()
    render(
      withProviders(
        <FilesChangedView
          session={session}
          findings={findings}
          unifiedDiff={DIFF}
          selectedPath={null}
          onSelectPath={onSelect}
          onOpenFindingInPanel={() => {}}
        />,
      ),
    )
    // Both files appear in the tree. With path compression, the shared "src/"
    // parent becomes a folder row and the files render as leaf rows under it.
    const list = screen.getByRole('list', { name: /files changed/i })
    expect(within(list).getByText('src/')).toBeInTheDocument()
    expect(within(list).getByText('foo.ts')).toBeInTheDocument()
    expect(within(list).getByText('bar.ts')).toBeInTheDocument()
    // Default selection feeds back via onSelectPath effect.
    expect(onSelect).toHaveBeenCalledWith('src/foo.ts')
    // The diff stub renders for the currently-selected file.
    expect(screen.getByTestId('file-diff')).toHaveAttribute('data-file', 'src/foo.ts')
  })

  it('selecting another file path swaps the displayed diff', () => {
    const onSelect = vi.fn()
    const { rerender } = render(
      withProviders(
        <FilesChangedView
          session={session}
          findings={findings}
          unifiedDiff={DIFF}
          selectedPath="src/foo.ts"
          onSelectPath={onSelect}
          onOpenFindingInPanel={() => {}}
        />,
      ),
    )
    expect(screen.getByTestId('file-diff')).toHaveAttribute('data-file', 'src/foo.ts')
    const barRow = screen.getByRole('button', { name: /bar\.ts/ })
    fireEvent.click(barRow)
    expect(onSelect).toHaveBeenCalledWith('src/bar.ts')
    rerender(
      withProviders(
        <FilesChangedView
          session={session}
          findings={findings}
          unifiedDiff={DIFF}
          selectedPath="src/bar.ts"
          onSelectPath={onSelect}
          onOpenFindingInPanel={() => {}}
        />,
      ),
    )
    expect(screen.getByTestId('file-diff')).toHaveAttribute('data-file', 'src/bar.ts')
  })

  it('shows the empty state when there are no changed files', () => {
    render(
      withProviders(
        <FilesChangedView
          session={session}
          findings={[]}
          unifiedDiff=""
          selectedPath={null}
          onSelectPath={() => {}}
          onOpenFindingInPanel={() => {}}
        />,
      ),
    )
    // Empty diff → "No changes" body.
    expect(screen.getByText(/No changes/i)).toBeInTheDocument()
  })

  it('shows the loading state when the diff has not arrived yet', () => {
    render(
      withProviders(
        <FilesChangedView
          session={session}
          findings={[]}
          unifiedDiff={null}
          selectedPath={null}
          onSelectPath={() => {}}
          onOpenFindingInPanel={() => {}}
        />,
      ),
    )
    expect(screen.getByText(/Loading diff/i)).toBeInTheDocument()
  })

  it('surfaces rename-file findings under the new (canonical) path', () => {
    const RENAME_DIFF = `diff --git a/src/old.ts b/src/new.ts
similarity index 90%
rename from src/old.ts
rename to src/new.ts
--- a/src/old.ts
+++ b/src/new.ts
@@ -1,3 +1,4 @@
 a
+b
 c
 d
`
    const renameFinding: Finding = {
      id: 'R3',
      dbId: 'd3',
      sessionId: 's1',
      ord: 3,
      severity: 'must',
      category: 'C',
      // Agent recorded the finding against the OLD path — this is the case
      // the bug was about. It should still surface in the tree (severity dot,
      // count) under the canonical display path (newPath).
      file: 'src/old.ts',
      line: 2,
      title: 'rename issue',
      body: 'b',
      selected: true,
      edited: false,
      archived: false,
      createdAt: 0,
      source: 'agent',
      submittedAt: null,
      submittedCommentId: null,
    }
    render(
      withProviders(
        <FilesChangedView
          session={session}
          findings={[renameFinding]}
          unifiedDiff={RENAME_DIFF}
          selectedPath={null}
          onSelectPath={() => {}}
          onOpenFindingInPanel={() => {}}
        />,
      ),
    )
    // With one file in the diff, path compression renders a single leaf row
    // showing dim "src/" + bright "new.ts". The "+1" diff stat in the row
    // proves bucketing landed under newPath (not oldPath, which would have
    // produced a tree miss and no row at all).
    const newRow = screen.getByRole('button', { name: /new\.ts/ })
    expect(newRow).toHaveTextContent('+1')
  })

  it('auto-advances to the next unviewed file when the current file is marked viewed', () => {
    const onSelect = vi.fn()
    render(
      withProviders(
        <FilesChangedView
          session={session}
          findings={findings}
          unifiedDiff={DIFF}
          selectedPath="src/foo.ts"
          onSelectPath={onSelect}
          onOpenFindingInPanel={() => {}}
        />,
      ),
    )
    // The diff-pane header carries the "Viewed" checkbox for the active file.
    fireEvent.click(screen.getByLabelText('Viewed'))
    expect(onSelect).toHaveBeenCalledWith('src/bar.ts')
  })

  it('toggles the diff layout to split and persists the choice to config', async () => {
    // Server-persisted (config.json), not browser localStorage: the daemon
    // rebinds an ephemeral port on restart, which would wipe per-origin
    // localStorage. The preference therefore lives in the shared config cache.
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    })
    qc.setQueryData(['config'], {
      config: {
        port: 0,
        maxConcurrentReviews: 4,
        stallMinutes: 3,
        defaultAgent: 'claude',
        perPRGCDays: 7,
        language: 'en',
        reviewExcludeGlobs: [],
        diffViewMode: 'unified',
      },
      file: '/Users/x/.better-review/config.json',
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      return Promise.resolve(
        new Response(JSON.stringify({ config: body }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    })
    const ui = (
      <QueryClientProvider client={qc}>
        <SelectionProvider>
          <FilesChangedView
            session={session}
            findings={findings}
            unifiedDiff={DIFF}
            selectedPath="src/foo.ts"
            onSelectPath={() => {}}
            onOpenFindingInPanel={() => {}}
          />
        </SelectionProvider>
      </QueryClientProvider>
    )
    const view = render(ui)
    // Defaults to unified — the toggle reflects it via aria-pressed.
    expect(screen.getByTestId('file-diff')).toHaveAttribute('data-view', 'unified')
    expect(screen.getByRole('button', { name: 'Unified' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Split' }))
    await waitFor(() =>
      expect(screen.getByTestId('file-diff')).toHaveAttribute('data-view', 'split'),
    )
    expect(screen.getByRole('button', { name: 'Split' })).toHaveAttribute('aria-pressed', 'true')

    // The choice is global (not session-scoped): a remount reads it back from
    // the same config cache the PUT updated.
    view.unmount()
    render(ui)
    expect(screen.getByTestId('file-diff')).toHaveAttribute('data-view', 'split')
  })

  it('does not toggle viewed state on a historical (readOnly) round', () => {
    render(
      withProviders(
        <FilesChangedView
          session={session}
          findings={findings}
          unifiedDiff={DIFF}
          selectedPath="src/foo.ts"
          onSelectPath={() => {}}
          onOpenFindingInPanel={() => {}}
          readOnly
        />,
      ),
    )
    expect(screen.getByLabelText('Viewed')).toBeDisabled()
  })
})
