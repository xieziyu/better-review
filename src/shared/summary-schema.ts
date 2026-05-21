import { z } from 'zod'

// One entry in the agent's "recommend a human look here" list. `file` is the
// repo-relative path the note is about; null / omitted means the note is
// PR-wide (no single file). `reason` is the prose the agent writes explaining
// why a human should pay attention.
export const manualReviewItemSchema = z.object({
  file: z.string().min(1).nullable().optional(),
  reason: z.string().min(1),
})

// The agent writes this object to `summary.json` alongside `findings.json`.
// `overview` is a short markdown description of what the PR does; `manualReview`
// is the curated list of files / areas the agent thinks warrant careful human
// review. Stats and the excluded-files set are computed by the tool, not here.
export const reviewSummaryFromAgentSchema = z.object({
  overview: z.string().min(1),
  manualReview: z.array(manualReviewItemSchema).default([]),
})

export type ManualReviewItem = z.infer<typeof manualReviewItemSchema>
export type ReviewSummaryFromAgent = z.infer<typeof reviewSummaryFromAgentSchema>
