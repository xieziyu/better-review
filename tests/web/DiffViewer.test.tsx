import { render, screen } from '@testing-library/react'
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
})
