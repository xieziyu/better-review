import { describe, it, expect } from 'vitest'

import { annotateDiffWithLineNumbers } from '../../../src/server/engine/diff-annotator'

describe('annotateDiffWithLineNumbers', () => {
  it('prefixes context and added lines with the new-file line number', () => {
    const diff = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -10,3 +10,5 @@
 ctx
 ctx
+new1
+new2
 ctx
`
    const out = annotateDiffWithLineNumbers(diff)
    const lines = out.split('\n')
    expect(lines).toContain('10 |  ctx')
    expect(lines).toContain('11 |  ctx')
    expect(lines).toContain('12 | +new1')
    expect(lines).toContain('13 | +new2')
    expect(lines).toContain('14 |  ctx')
  })

  it('leaves the gutter blank for deleted lines and skips the new-file counter', () => {
    const diff = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1,4 +1,3 @@
 keep
-old1
-old2
+new1
 keep2
`
    const out = annotateDiffWithLineNumbers(diff)
    const lines = out.split('\n')
    expect(lines).toContain(' 1 |  keep')
    // Deleted lines have a blank gutter, do NOT consume a new-file number.
    expect(lines).toContain('   | -old1')
    expect(lines).toContain('   | -old2')
    expect(lines).toContain(' 2 | +new1')
    expect(lines).toContain(' 3 |  keep2')
  })

  it('passes through file headers, hunk headers, and trailing markers unchanged', () => {
    const diff = `diff --git a/x b/x
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/x
@@ -0,0 +1,2 @@
+a
+b
\\ No newline at end of file
`
    const out = annotateDiffWithLineNumbers(diff).split('\n')
    expect(out).toContain('diff --git a/x b/x')
    expect(out).toContain('new file mode 100644')
    expect(out).toContain('index 0000000..e69de29')
    expect(out).toContain('--- /dev/null')
    expect(out).toContain('+++ b/x')
    expect(out).toContain('@@ -0,0 +1,2 @@')
    expect(out).toContain(' 1 | +a')
    expect(out).toContain(' 2 | +b')
    expect(out).toContain('\\ No newline at end of file')
  })

  it('numbers the GLOBAL_EPISODE_RECOMMEND env line as 9, not 10 (regression)', () => {
    // Regression test for the off-by-one bug where the agent attached a
    // suggestion to line 10 (SENTRY_OMNI_DSN) instead of the intended line 9
    // (GLOBAL_EPISODE_RECOMMEND_TASK_LOOKBACK_HOURS). With explicit line
    // numbers in the gutter, the agent can read the correct number directly.
    const diff = `diff --git a/env.ts b/env.ts
--- a/env.ts
+++ b/env.ts
@@ -6,7 +6,11 @@ const EnvShape = z.object({
   RECORD_REQUEST_BODY: z.coerce.boolean().default(false),
   MONGO_PODHUB_URL: z.string(),
   MONGO_PODHUB_DATA_URL: z.string(),
+  GLOBAL_EPISODE_RECOMMEND_TASK_LOOKBACK_HOURS: z.number().default(2),
   SENTRY_OMNI_DSN: z.string().optional(),
+  QINIU_ACCESS_KEY: z.string(),
`
    const out = annotateDiffWithLineNumbers(diff)
    expect(out).toMatch(
      /\b9 \| \+ {2}GLOBAL_EPISODE_RECOMMEND_TASK_LOOKBACK_HOURS: z\.number\(\)\.default\(2\),/,
    )
    expect(out).toMatch(/\b10 \|  {3}SENTRY_OMNI_DSN: z\.string\(\)\.optional\(\),/)
    expect(out).toMatch(/\b11 \| \+ {2}QINIU_ACCESS_KEY: z\.string\(\),/)
  })

  it('preserves multiple files with independent hunk numbering', () => {
    const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,2 @@
 only-in-a
+added-a
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -100,1 +100,2 @@
 only-in-b
+added-b
`
    const out = annotateDiffWithLineNumbers(diff).split('\n')
    expect(out).toContain('  1 |  only-in-a')
    expect(out).toContain('  2 | +added-a')
    expect(out).toContain('100 |  only-in-b')
    expect(out).toContain('101 | +added-b')
  })
})
