import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import { DiffViewer } from '@/components/DiffViewer'

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
  const after = Array.from(
    { length: contextAfter },
    (_, i) => ` ctx${contextBefore + 1 + i}`,
  ).join('\n')
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
    render(<DiffViewer unifiedDiff={sampleDiff} file="src/x.ts" line={41} findingId="R1" />)

    expect(screen.getByText('removed line')).toBeInTheDocument()
    expect(screen.getByText('added line one')).toBeInTheDocument()
    expect(screen.getByText('added line two')).toBeInTheDocument()
    expect(screen.getByText('context A')).toBeInTheDocument()
  })

  it('marks the finding line with diff-code-selected when it lands on an inserted line', () => {
    // anchor is 42 — the first '+ added line one'.
    const { container } = render(
      <DiffViewer unifiedDiff={sampleDiff} file="src/x.ts" line={42} findingId="R1" />,
    )

    const selected = container.querySelectorAll('.diff-code-selected')
    expect(selected.length).toBe(1)
    expect(selected[0]?.textContent).toContain('added line one')
  })

  it('marks the finding line with diff-code-selected when it lands on a context line', () => {
    // anchor is 41 — the ' context B' context line.
    const { container } = render(
      <DiffViewer unifiedDiff={sampleDiff} file="src/x.ts" line={41} findingId="R1" />,
    )

    const selected = container.querySelectorAll('.diff-code-selected')
    expect(selected.length).toBe(1)
    expect(selected[0]?.textContent).toContain('context B')
  })

  it('falls back to "No diff context" when finding.line is off any hunk', () => {
    render(<DiffViewer unifiedDiff={sampleDiff} file="src/x.ts" line={999} findingId="R1" />)

    expect(screen.getByText(/No diff context near line 999/)).toBeInTheDocument()
  })

  it('shows "Loading diff…" while unifiedDiff is null', () => {
    render(<DiffViewer unifiedDiff={null} file="src/x.ts" line={42} findingId="R1" />)

    expect(screen.getByText(/Loading diff…/)).toBeInTheDocument()
  })

  it('shows "File not in diff" when the file is missing from the diff', () => {
    render(<DiffViewer unifiedDiff={sampleDiff} file="src/y.ts" line={42} findingId="R1" />)

    expect(screen.getByText(/File not in diff/)).toBeInTheDocument()
  })

  it('trims a large new-file hunk to a window around the anchor by default', () => {
    render(
      <DiffViewer unifiedDiff={bigInsertDiff(60)} file="src/big.ts" line={30} findingId="R1" />,
    )

    expect(screen.getByText('line 30 content')).toBeInTheDocument()
    expect(screen.queryByText('line 1 content')).not.toBeInTheDocument()
    expect(screen.queryByText('line 60 content')).not.toBeInTheDocument()
  })

  it('reveals the trimmed lines when the user clicks "Expand full file"', () => {
    render(
      <DiffViewer unifiedDiff={bigInsertDiff(60)} file="src/big.ts" line={30} findingId="R1" />,
    )

    fireEvent.click(screen.getByRole('button', { name: /expand full file/i }))

    expect(screen.getByText('line 1 content')).toBeInTheDocument()
    expect(screen.getByText('line 60 content')).toBeInTheDocument()
  })

  it('keeps +/- rows visible when the anchor is on a context line a few rows away', () => {
    // 14 context lines + (-/+) + 14 context lines = 30 changes, so trimming
    // kicks in. Anchor on context line 10 — change at line 15 is 5 rows away.
    // Regression guard for the bug fixed in 2210d65.
    render(
      <DiffViewer
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
