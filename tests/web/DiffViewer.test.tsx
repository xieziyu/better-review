import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

import { DiffViewer } from '@/components/DiffViewer'

// The hidden-line expanders fetch full file content; stub it so tests stay
// offline. Returning null marks the source unavailable, which disables the
// expanders — the rendering assertions below don't depend on expansion.
vi.mock('@/lib/api', () => ({ api: { getSessionFile: vi.fn(async () => null) } }))

const sampleDiff = `diff --git a/src/x.ts b/src/x.ts
index 0000001..0000002 100644
--- a/src/x.ts
+++ b/src/x.ts
@@ -40,4 +40,5 @@
 context A
 context B
-removed line
+added line one
+added line two
 context C
`

function bigInsertDiff(lines: number): string {
  const body = Array.from({ length: lines }, (_, i) => `+line ${i + 1} content`).join('\n')
  return `diff --git a/src/big.ts b/src/big.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/big.ts
@@ -0,0 +1,${lines} @@
${body}
`
}

// Builds a 30-change hunk: contextBefore × " ctxN", then "-removed line" /
// "+added line", then contextAfter × " ctxM". Useful for regression-testing
// the "anchor on context line near a change" case from commit 2210d65.
function hunkWithChangeAt({
  contextBefore,
  contextAfter,
}: {
  contextBefore: number
  contextAfter: number
}): string {
  const before = Array.from({ length: contextBefore }, (_, i) => ` ctx${i + 1}`).join('\n')
  const after = Array.from({ length: contextAfter }, (_, i) => ` ctx${contextBefore + 1 + i}`).join(
    '\n',
  )
  const oldLines = contextBefore + 1 + contextAfter
  const newLines = contextBefore + 1 + contextAfter
  return `diff --git a/src/y.ts b/src/y.ts
index 0000001..0000002 100644
--- a/src/y.ts
+++ b/src/y.ts
@@ -1,${oldLines} +1,${newLines} @@
${before}
-removed line
+added line
${after}
`
}

describe('DiffViewer', () => {
  it('renders the +/- change lines when finding.line is on a context line', () => {
    // anchor is 41 (context B) — the actual change is on lines 42/43.
    // Old behaviour would have filtered changes to [38, 44] AND broken hunk
    // structure; the new behaviour shows the full containing hunk so
    // additions/deletions are visible.
    render(
      <DiffViewer
        sessionId="s1"
        unifiedDiff={sampleDiff}
        file="src/x.ts"
        line={41}
        findingId="R1"
      />,
    )

    expect(screen.getByText('removed line')).toBeInTheDocument()
    expect(screen.getByText('added line one')).toBeInTheDocument()
    expect(screen.getByText('added line two')).toBeInTheDocument()
    expect(screen.getByText('context A')).toBeInTheDocument()
  })

  it('marks the finding line with diff-code-selected when it lands on an inserted line', () => {
    // anchor is 42 — the first '+ added line one'.
    const { container } = render(
      <DiffViewer
        sessionId="s1"
        unifiedDiff={sampleDiff}
        file="src/x.ts"
        line={42}
        findingId="R1"
      />,
    )

    const selected = container.querySelectorAll('.diff-code-selected')
    expect(selected.length).toBe(1)
    expect(selected[0]?.textContent).toContain('added line one')
  })

  it('marks the finding line with diff-code-selected when it lands on a context line', () => {
    // anchor is 41 — the ' context B' context line.
    const { container } = render(
      <DiffViewer
        sessionId="s1"
        unifiedDiff={sampleDiff}
        file="src/x.ts"
        line={41}
        findingId="R1"
      />,
    )

    const selected = container.querySelectorAll('.diff-code-selected')
    expect(selected.length).toBe(1)
    expect(selected[0]?.textContent).toContain('context B')
  })

  it('still renders the diff hunks when finding.line is off any hunk', () => {
    // Off-diff line (999 is past the hunk). The viewer no longer dead-ends with
    // "No diff context"; it shows the file's hunks and would auto-expand the
    // surrounding gap toward the line when the source is available.
    render(
      <DiffViewer
        sessionId="s1"
        unifiedDiff={sampleDiff}
        file="src/x.ts"
        line={999}
        findingId="R1"
      />,
    )

    expect(screen.queryByText(/No diff context/)).not.toBeInTheDocument()
    expect(screen.getByText('removed line')).toBeInTheDocument()
  })

  it('shows "Loading diff…" while unifiedDiff is null', () => {
    render(
      <DiffViewer sessionId="s1" unifiedDiff={null} file="src/x.ts" line={42} findingId="R1" />,
    )

    expect(screen.getByText(/Loading diff…/)).toBeInTheDocument()
  })

  it('shows "File not in diff" when the file is missing from the diff', () => {
    render(
      <DiffViewer
        sessionId="s1"
        unifiedDiff={sampleDiff}
        file="src/y.ts"
        line={42}
        findingId="R1"
      />,
    )

    expect(screen.getByText(/File not in diff/)).toBeInTheDocument()
  })

  it('renders a large new-file hunk in full (no window trimming)', () => {
    render(
      <DiffViewer
        sessionId="s1"
        unifiedDiff={bigInsertDiff(60)}
        file="src/big.ts"
        line={30}
        findingId="R1"
      />,
    )

    // The detail viewer shows the file's diff hunks in full; surrounding
    // context (not in the diff) is reached via the gap expanders instead.
    expect(screen.getByText('line 1 content')).toBeInTheDocument()
    expect(screen.getByText('line 30 content')).toBeInTheDocument()
    expect(screen.getByText('line 60 content')).toBeInTheDocument()
  })

  it('shows +/- rows for the full hunk regardless of where the anchor lands', () => {
    render(
      <DiffViewer
        sessionId="s1"
        unifiedDiff={hunkWithChangeAt({ contextBefore: 14, contextAfter: 14 })}
        file="src/y.ts"
        line={10}
        findingId="R1"
      />,
    )

    expect(screen.getByText('removed line')).toBeInTheDocument()
    expect(screen.getByText('added line')).toBeInTheDocument()
  })
})
