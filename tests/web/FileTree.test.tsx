import type { Severity } from '@shared/findings-schema'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { FileData, HunkData } from 'react-diff-view'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FileTree } from '@/components/files-changed/FileTree'
import type { FileSummary } from '@/lib/diff-utils'

interface MkFileOpts {
  status?: FileSummary['status']
  additions?: number
  deletions?: number
}

function mkFile(path: string, opts: MkFileOpts = {}): FileSummary {
  return {
    path,
    oldPath: path,
    newPath: path,
    status: opts.status ?? 'modify',
    additions: opts.additions ?? 1,
    deletions: opts.deletions ?? 0,
    hunks: [] as HunkData[],
    fileData: { type: opts.status ?? 'modify', oldPath: path, newPath: path, hunks: [] } as FileData,
  }
}

function mkCtx(
  entries: Array<{ file: string; count?: number; severities?: Severity[] }> = [],
): { countsByFile: Map<string, number>; severitiesByFile: Map<string, Set<Severity>> } {
  const counts = new Map<string, number>()
  const sevs = new Map<string, Set<Severity>>()
  for (const e of entries) {
    if (e.count != null) counts.set(e.file, e.count)
    if (e.severities) sevs.set(e.file, new Set(e.severities))
  }
  return { countsByFile: counts, severitiesByFile: sevs }
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
})

const SESSION_ID = 'test-session-1'
const STORAGE_KEY = `better-review:files-tree-collapsed:${SESSION_ID}`

function renderTree(
  files: FileSummary[],
  opts: {
    sessionId?: string
    selectedPath?: string | null
    countsByFile?: Map<string, number>
    severitiesByFile?: Map<string, Set<Severity>>
  } = {},
) {
  const ctx = mkCtx()
  return render(
    <FileTree
      files={files}
      selectedPath={opts.selectedPath ?? null}
      onSelect={() => {}}
      severitiesByFile={opts.severitiesByFile ?? ctx.severitiesByFile}
      countsByFile={opts.countsByFile ?? ctx.countsByFile}
      sessionId={opts.sessionId ?? SESSION_ID}
    />,
  )
}

function getFolderItem(path: string): HTMLElement {
  const items = screen.getAllByRole('treeitem')
  for (const item of items) {
    if (item.getAttribute('aria-expanded') == null) continue
    const label = item.getAttribute('aria-label') ?? ''
    if (label.includes(path)) return item
  }
  throw new Error(`folder treeitem with path "${path}" not found`)
}

describe('FileTree path compression', () => {
  it('merges a folder chain when the deepest folder has multiple children', () => {
    renderTree([
      mkFile('src/web/components/files-changed/A.tsx'),
      mkFile('src/web/components/files-changed/B.tsx'),
    ])
    const folder = getFolderItem('src/web/components/files-changed')
    expect(folder).toHaveAttribute('aria-expanded', 'true')
    expect(folder).toHaveAttribute('aria-level', '1')
    expect(folder.textContent).toContain('files-changed')
    expect(folder.textContent).toContain('src')
    // The two file rows live at the next level.
    const fileButtons = screen
      .getAllByRole('treeitem')
      .filter((i) => i.getAttribute('aria-expanded') == null)
    expect(fileButtons).toHaveLength(2)
    expect(fileButtons[0]).toHaveAttribute('aria-level', '2')
  })

  it('merges a folder chain ending in a sole file into one leaf row', () => {
    renderTree([mkFile('lib/diff-utils.ts', { additions: 42, deletions: 9 })])
    const items = screen.getAllByRole('treeitem')
    // Only the file row — no folder wrapper, because lib/ collapses into it.
    expect(items).toHaveLength(1)
    const leaf = items[0]!
    expect(leaf).toHaveAttribute('aria-level', '1')
    const text = leaf.textContent ?? ''
    expect(text).toContain('lib/')
    expect(text).toContain('diff-utils.ts')
  })

  it('renders a root file at depth 0 with no folder wrapper', () => {
    renderTree([mkFile('README.md', { additions: 6, deletions: 2 })])
    const items = screen.getAllByRole('treeitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveAttribute('aria-level', '1')
    expect(items[0]!.getAttribute('aria-expanded')).toBeNull()
    expect(items[0]!.textContent).toContain('README.md')
  })

  it('keeps a file and a folder with the same segment side by side', () => {
    // A refactor that deletes a file and adds a directory of the same name
    // produces a diff with both paths. The previous Map<string, RawNode>
    // would silently overwrite one with the other; here we assert both are
    // visible after the build.
    renderTree([
      mkFile('Makefile', { status: 'delete', deletions: 12 }),
      mkFile('Makefile/build.mk', { status: 'add', additions: 18 }),
      mkFile('Makefile/test.mk', { status: 'add', additions: 7 }),
    ])
    const items = screen.getAllByRole('treeitem')
    // 1 folder row (Makefile/) + 2 file rows under it + 1 standalone file row.
    expect(items).toHaveLength(4)
    const labels = items.map((i) => i.getAttribute('aria-label'))
    expect(labels).toContain('Makefile, folder')
    // The standalone file row has no aria-label; verify by text content.
    const standaloneFile = items.find(
      (i) =>
        i.getAttribute('aria-expanded') == null && (i.textContent ?? '').endsWith('−12'),
    )
    expect(standaloneFile).toBeDefined()
    expect(standaloneFile!.textContent).toContain('Makefile')
    expect(screen.getByText('build.mk')).toBeInTheDocument()
    expect(screen.getByText('test.mk')).toBeInTheDocument()
  })
})

describe('FileTree collapse persistence', () => {
  it('persists collapse across remounts with the same sessionId', () => {
    const { unmount } = renderTree([
      mkFile('src/a/A.tsx'),
      mkFile('src/a/B.tsx'),
    ])
    // src/a/ merges into a single folder row with two children.
    const folder = getFolderItem('src/a')
    expect(folder).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(folder)
    expect(folder).toHaveAttribute('aria-expanded', 'false')
    const stored = window.localStorage.getItem(STORAGE_KEY)
    expect(stored).not.toBeNull()
    expect(JSON.parse(stored!)).toContain('src/a')
    unmount()
    renderTree([mkFile('src/a/A.tsx'), mkFile('src/a/B.tsx')])
    const folder2 = getFolderItem('src/a')
    expect(folder2).toHaveAttribute('aria-expanded', 'false')
    // Child rows are not in the DOM when the folder is collapsed.
    expect(screen.queryByText(/A\.tsx/)).toBeNull()
    expect(screen.queryByText(/B\.tsx/)).toBeNull()
  })

  it('isolates collapse state by sessionId', () => {
    const { unmount } = renderTree(
      [mkFile('src/a/A.tsx'), mkFile('src/a/B.tsx')],
      { sessionId: 'session-A' },
    )
    fireEvent.click(getFolderItem('src/a'))
    expect(getFolderItem('src/a')).toHaveAttribute('aria-expanded', 'false')
    unmount()
    renderTree([mkFile('src/a/A.tsx'), mkFile('src/a/B.tsx')], { sessionId: 'session-B' })
    expect(getFolderItem('src/a')).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('FileTree filter auto-expand', () => {
  it('force-expands ancestors of matches without mutating stored state, then restores on clear', () => {
    // Pre-collapse "src/a" via storage. Use two files with a shared substring
    // so the filter keeps multiple matches under the same folder — otherwise
    // path compression would collapse the singleton chain into one leaf row
    // and there'd be no folder left to assert on.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(['src/a']))
    renderTree([mkFile('src/a/A.tsx'), mkFile('src/a/B.tsx')])
    expect(getFolderItem('src/a')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/A\.tsx/)).toBeNull()
    expect(screen.queryByText(/B\.tsx/)).toBeNull()

    const input = screen.getByPlaceholderText(/Filter files/)
    fireEvent.change(input, { target: { value: '.tsx' } })
    // Both files match → folder remains in the tree and force-expands.
    expect(getFolderItem('src/a')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/A\.tsx/)).toBeInTheDocument()
    expect(screen.getByText(/B\.tsx/)).toBeInTheDocument()
    // Storage is untouched during the transient expansion.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(['src/a']))

    fireEvent.change(input, { target: { value: '' } })
    expect(getFolderItem('src/a')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/A\.tsx/)).toBeNull()
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(['src/a']))
  })
})

describe('FileTree collapsed folder aggregates', () => {
  it('shows aggregated count, severities, and +/- on a collapsed folder row', () => {
    const files = [
      mkFile('pkg/x.ts', { additions: 10, deletions: 3 }),
      mkFile('pkg/y.ts', { additions: 5, deletions: 0 }),
    ]
    const counts = new Map<string, number>([
      ['pkg/x.ts', 1],
      ['pkg/y.ts', 2],
    ])
    const sevs = new Map<string, Set<Severity>>([
      ['pkg/x.ts', new Set<Severity>(['must'])],
      ['pkg/y.ts', new Set<Severity>(['nit'])],
    ])
    renderTree(files, { countsByFile: counts, severitiesByFile: sevs })

    const folder = getFolderItem('pkg')
    fireEvent.click(folder)
    const collapsed = getFolderItem('pkg')
    const text = collapsed.textContent ?? ''
    expect(text).toContain('3')
    expect(text).toContain('+15')
    expect(text).toContain('−3')
    // Two severity dots: must and nit (no should). Look up by aria-label.
    expect(within(collapsed).getByLabelText('has must finding')).toBeInTheDocument()
    expect(within(collapsed).getByLabelText('has nit finding')).toBeInTheDocument()
    expect(within(collapsed).queryByLabelText('has should finding')).toBeNull()
  })
})

describe('FileTree onlyWithFindings filter', () => {
  it('hides folders whose subtree contains no findings when toggled on', () => {
    const files = [
      mkFile('with/a.ts'),
      mkFile('without/b.ts'),
    ]
    const counts = new Map<string, number>([['with/a.ts', 1]])
    const sevs = new Map<string, Set<Severity>>([['with/a.ts', new Set<Severity>(['must'])]])
    renderTree(files, { countsByFile: counts, severitiesByFile: sevs })
    expect(screen.getByText(/a\.ts/)).toBeInTheDocument()
    expect(screen.getByText(/b\.ts/)).toBeInTheDocument()

    const checkbox = screen.getByLabelText(/Only with findings/i)
    fireEvent.click(checkbox)
    expect(screen.getByText(/a\.ts/)).toBeInTheDocument()
    expect(screen.queryByText(/b\.ts/)).toBeNull()
  })
})
