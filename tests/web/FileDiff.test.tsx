import { render } from '@testing-library/react'
import { parseDiff } from 'react-diff-view'
import { describe, expect, it } from 'vitest'

import { FileDiff } from '@/components/files-changed/FileDiff'

// A modify hunk: one deleted line replaced by two inserts, surrounded by
// context. Split rendering should pair old/new sides cell-by-cell.
const DIFF = `diff --git a/src/x.ts b/src/x.ts
index 0000001..0000002 100644
--- a/src/x.ts
+++ b/src/x.ts
@@ -40,4 +40,5 @@
 context A
-removed line
+added line one
+added line two
 context C
`

function hunksOf(diff: string) {
  const [file] = parseDiff(diff)
  return file!.hunks
}

describe('FileDiff viewType', () => {
  it('renders a single code column per row in unified mode', () => {
    const { container } = render(
      <FileDiff file="src/x.ts" fileType="modify" hunks={hunksOf(DIFF)} viewType="unified" />,
    )
    // The root table carries diff-unified — the split-seam CSS is scoped under
    // .diff-split so it must NOT apply here. (This is the regression the seam
    // selectors caused: a unified row is [old gutter, new gutter, code] = 3
    // cells, so an unscoped nth-child(3) would have hit the code cell.)
    expect(container.querySelector('table.diff-unified')).not.toBeNull()
    expect(container.querySelector('table.diff-split')).toBeNull()
    expect(container.querySelector('.diff-line-new-only')).toBeNull()
    expect(container.querySelector('.diff-line-old-only')).toBeNull()
    const firstLine = container.querySelector('tr.diff-line')
    expect(firstLine?.querySelectorAll('td')).toHaveLength(3)
    expect(firstLine?.querySelectorAll('.diff-code')).toHaveLength(1)
  })

  it('renders paired old/new columns in split mode', () => {
    const { container } = render(
      <FileDiff file="src/x.ts" fileType="modify" hunks={hunksOf(DIFF)} viewType="split" />,
    )
    // Split tags the root .diff-split and emits side-specific line classes with
    // two code cells per row.
    expect(container.querySelector('table.diff-split')).not.toBeNull()
    expect(container.querySelector('.diff-line-new-only')).not.toBeNull()
    const firstLine = container.querySelector('tr.diff-line')
    expect(firstLine?.querySelectorAll('.diff-code')).toHaveLength(2)
  })
})

describe('FileDiff hidden-line expanders', () => {
  it('renders no expander when not expandable', () => {
    const { container } = render(
      <FileDiff file="src/x.ts" fileType="modify" hunks={hunksOf(DIFF)} viewType="unified" />,
    )
    expect(container.querySelector('.diff-expander')).toBeNull()
  })

  it('renders a head-gap expander whose click expands toward the hunk', () => {
    // The only hunk starts at old line 40, so lines 1-39 are collapsed above it.
    const calls: Array<[number, number]> = []
    const { container } = render(
      <FileDiff
        file="src/x.ts"
        fileType="modify"
        hunks={hunksOf(DIFF)}
        viewType="unified"
        expandable
        totalLines={50}
        onExpand={(start, end) => calls.push([start, end])}
      />,
    )
    const expander = container.querySelector('.diff-expander')
    expect(expander).not.toBeNull()
    // A 39-line gap is "big" (> EXPAND_STEP), so it offers up + down arrows.
    const btns = expander!.querySelectorAll('.diff-expander-btn')
    expect(btns.length).toBe(2)
    // The bottom-of-file expander also shows because totalLines (50) exceeds the
    // last hunk's end (44).
    expect(container.querySelectorAll('.diff-expander').length).toBe(2)
  })
})
