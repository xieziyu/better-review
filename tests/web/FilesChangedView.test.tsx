import type { Finding, PRSession } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// Stub heavy pieces so jsdom doesn't pull Shiki WASM or actually mount the
// react-diff-view widgets (which expect a real layout). The test focuses on
// the FilesChangedView's structural contract: tree + diff pane scaffolding.
vi.mock('@/components/files-changed/FileDiff', () => ({
  FileDiff: ({ file }: { file: string }) => (
    <div data-testid="file-diff" data-file={file}>
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
  },
]

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
    // Both files appear in the tree (the diff pane header also shows the
    // selected path, so query within the listbox by role).
    const list = screen.getByRole('listbox', { name: /files changed/i })
    expect(list).toHaveTextContent('src/foo.ts')
    expect(list).toHaveTextContent('src/bar.ts')
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
    const barRow = screen.getByRole('option', { name: /src\/bar\.ts/ })
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
})
