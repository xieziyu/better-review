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
    // Unified rows carry one gutter + one code cell; the split-only line
    // classes never appear.
    expect(container.querySelector('.diff-line-new-only')).toBeNull()
    expect(container.querySelector('.diff-line-old-only')).toBeNull()
    const firstLine = container.querySelector('tr.diff-line')
    expect(firstLine?.querySelectorAll('.diff-code')).toHaveLength(1)
  })

  it('renders paired old/new columns in split mode', () => {
    const { container } = render(
      <FileDiff file="src/x.ts" fileType="modify" hunks={hunksOf(DIFF)} viewType="split" />,
    )
    // Split emits side-specific line classes and two code cells per row.
    expect(container.querySelector('.diff-line-new-only')).not.toBeNull()
    const firstLine = container.querySelector('tr.diff-line')
    expect(firstLine?.querySelectorAll('.diff-code')).toHaveLength(2)
  })
})
