import { z } from "zod";

export const severitySchema = z.enum(["must", "should", "nit"]);

export const findingSchema = z.object({
  id: z.string().min(1),
  severity: severitySchema,
  category: z.string().min(1),
  file: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  title: z.string().min(1),
  body: z.string().min(1),
  suggestion: z.string().optional(),
});

export const findingsFileSchema = z.array(findingSchema);

export type FindingFromClaude = z.infer<typeof findingSchema>;
export type Severity = z.infer<typeof severitySchema>;
