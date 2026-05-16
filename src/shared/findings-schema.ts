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

// Manual finding input: same shape as an agent finding, except the agent-side
// `id` is server-assigned and `file` + `line` are required (the user can only
// create a finding by clicking a + on a concrete diff line in the UI).
export const manualFindingInputSchema = z
  .object({
    severity: severitySchema,
    category: z.string().min(1),
    file: z.string().min(1),
    line: z.number().int().positive(),
    startLine: z.number().int().positive().optional(),
    title: z.string().min(1),
    body: z.string().min(1),
    suggestion: z.string().optional(),
  })
  .refine((f) => f.startLine === undefined || f.startLine <= f.line, {
    message: 'startLine must be <= line',
    path: ['startLine'],
  })

export type ManualFindingInput = z.infer<typeof manualFindingInputSchema>
