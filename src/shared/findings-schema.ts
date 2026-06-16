import { z } from 'zod'

export const severitySchema = z.enum(['must', 'should', 'nit'])

export const findingSchema = z
  .object({
    id: z.string().min(1),
    severity: severitySchema,
    category: z.string().min(1),
    file: z.string().nullable(),
    line: z.number().int().positive().nullable(),
    // Agents (notably codex) emit `null` for an absent value rather than
    // omitting the key. Accept `null` and normalize it to `undefined` so a
    // single `"suggestion": null` / `"startLine": null` entry doesn't fail
    // validation (and, pre-fix, drop the whole findings array on parse).
    startLine: z
      .number()
      .int()
      .positive()
      .nullish()
      .transform((v) => v ?? undefined),
    title: z.string().min(1),
    body: z.string().min(1),
    suggestion: z
      .string()
      .nullish()
      .transform((v) => v ?? undefined),
  })
  .refine((f) => f.startLine === undefined || (f.line !== null && f.startLine <= f.line), {
    message: 'startLine must be <= line and require a non-null line',
    path: ['startLine'],
  })

export const findingsFileSchema = z.array(findingSchema)

export type FindingFromAgent = z.infer<typeof findingSchema>
export type Severity = z.infer<typeof severitySchema>

// Manual finding input: same shape as an agent finding. `file` is always
// required (manual findings are anchored to a specific file). `line` is
// optional — omit it for a file-level finding (e.g. "this file shouldn't
// be committed"); set it for a line / range finding. `startLine` requires
// `line` (and `startLine <= line`). `suggestion` requires `line` — the
// fenced suggestion block is only actionable on inline review comments;
// on a file-level finding it would just render as a misleading code block
// in the review body.
export const manualFindingInputSchema = z
  .object({
    severity: severitySchema,
    category: z.string().min(1),
    file: z.string().min(1),
    line: z.number().int().positive().optional(),
    startLine: z.number().int().positive().optional(),
    title: z.string().min(1),
    body: z.string().min(1),
    suggestion: z.string().optional(),
  })
  .refine((f) => f.startLine === undefined || (f.line !== undefined && f.startLine <= f.line), {
    message: 'startLine requires line and must be <= line',
    path: ['startLine'],
  })
  .refine((f) => f.line !== undefined || f.suggestion === undefined, {
    message: 'suggestion requires line',
    path: ['suggestion'],
  })

export type ManualFindingInput = z.infer<typeof manualFindingInputSchema>
