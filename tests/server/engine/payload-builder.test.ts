import { describe, it, expect } from 'vitest'

import { buildSubmitPayload } from '../../../src/server/engine/payload-builder'
import type { Finding } from '../../../src/shared/types'

const DIFF = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -10,1 +10,2 @@
 a
+b
`

function f(over: Partial<Finding>): Finding {
  return {
    dbId: 'x',
    sessionId: 's',
    id: 'R1',
    ord: 1,
    severity: 'must',
    category: 'x',
    file: null,
    line: null,
    title: 't',
    body: 'body text',
    selected: true,
    edited: false,
    archived: false,
    createdAt: 1,
    ...over,
  }
}

describe('buildSubmitPayload', () => {
  it('inline finding becomes comment', () => {
    const r = buildSubmitPayload({
      diff: DIFF,
      findings: [f({ file: 'foo.ts', line: 11 })],
      event: 'COMMENT',
    })
    expect(r.payload.comments).toHaveLength(1)
    expect(r.payload.comments[0]).toMatchObject({ path: 'foo.ts', line: 11, side: 'RIGHT' })
    expect(r.payload.comments[0]!.body).toContain('🔴 **[must]** t')
    expect(r.droppedToBody).toHaveLength(0)
  })

  it('file=null finding goes to body', () => {
    const r = buildSubmitPayload({
      diff: DIFF,
      findings: [f({ id: 'R1', file: null, line: null })],
      event: 'COMMENT',
    })
    expect(r.payload.comments).toHaveLength(0)
    expect(r.payload.body).toContain('### 🔴 **[must]** t')
    expect(r.payload.body).toContain('body text')
  })

  it('renders each severity with its emoji marker', () => {
    const r = buildSubmitPayload({
      diff: DIFF,
      findings: [
        f({ file: 'foo.ts', line: 11, severity: 'must', title: 'must title' }),
        f({ file: null, line: null, severity: 'should', title: 'should title' }),
        f({ file: 'foo.ts', line: 999, severity: 'nit', title: 'nit title' }),
      ],
      event: 'COMMENT',
    })

    expect(r.payload.comments[0]!.body).toContain('🔴 **[must]** must title')
    expect(r.payload.body).toContain('### 🟡 **[should]** should title')
    expect(r.payload.body).toContain('### 🔵 **[nit]** nit title')
  })

  it('line outside diff drops to body', () => {
    const r = buildSubmitPayload({
      diff: DIFF,
      findings: [f({ file: 'foo.ts', line: 999 })],
      event: 'COMMENT',
    })
    expect(r.payload.comments).toHaveLength(0)
    expect(r.droppedToBody).toHaveLength(1)
    expect(r.payload.body).toContain('foo.ts')
  })

  it('includes user-provided body prefix', () => {
    const r = buildSubmitPayload({
      diff: DIFF,
      findings: [],
      event: 'APPROVE',
      userBody: 'LGTM!',
    })
    expect(r.payload.body).toContain('LGTM!')
    expect(r.payload.event).toBe('APPROVE')
  })

  it('includes suggestion block in inline comment', () => {
    const r = buildSubmitPayload({
      diff: DIFF,
      findings: [f({ file: 'foo.ts', line: 11, suggestion: 'fixed' })],
      event: 'COMMENT',
    })
    expect(r.payload.comments[0]!.body).toContain('```suggestion')
    expect(r.payload.comments[0]!.body).toContain('fixed')
  })

  it('multi-line range emits start_line and start_side', () => {
    const MULTI = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -10,3 +10,5 @@
 a
+b
+c
+d
 e
`
    const r = buildSubmitPayload({
      diff: MULTI,
      findings: [f({ file: 'foo.ts', line: 13, startLine: 11, suggestion: 'B\nC\nD' })],
      event: 'COMMENT',
    })
    expect(r.payload.comments).toHaveLength(1)
    expect(r.payload.comments[0]).toMatchObject({
      path: 'foo.ts',
      line: 13,
      side: 'RIGHT',
      start_line: 11,
      start_side: 'RIGHT',
    })
    expect(r.droppedToBody).toHaveLength(0)
  })

  it('range that escapes the diff is dropped to body', () => {
    const r = buildSubmitPayload({
      diff: DIFF,
      findings: [f({ file: 'foo.ts', line: 11, startLine: 8 })],
      event: 'COMMENT',
    })
    expect(r.payload.comments).toHaveLength(0)
    expect(r.droppedToBody).toHaveLength(1)
  })

  it('startLine equal to line behaves as single-line', () => {
    const r = buildSubmitPayload({
      diff: DIFF,
      findings: [f({ file: 'foo.ts', line: 11, startLine: 11, suggestion: 'fixed' })],
      event: 'COMMENT',
    })
    expect(r.payload.comments).toHaveLength(1)
    expect(r.payload.comments[0]).not.toHaveProperty('start_line')
  })
})
