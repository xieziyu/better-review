import { z } from 'zod'

export const severitySchema = z.enum(['must', 'should', 'nit'])

export const findingSchema = z
  .object({
    id: z.string().min(1),
    severity: severitySchema,
    category: z.string().min(1),
    file: z.string().nullable(),
    line: z.number().int().positive().nullable(),
    startLine: z.number().int().positive().optional(),
    title: z.string().min(1),
    body: z.string().min(1),
    suggestion: z.string().optional(),
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
// `line` (and `startLine <= line`).
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

export type ManualFindingInput = z.infer<typeof manualFindingInputSchema>
