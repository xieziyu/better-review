import { findingsFileSchema, type FindingFromClaude } from "../../shared/findings-schema";

export type ParseResult =
  | { ok: true; data: FindingFromClaude[] }
  | { ok: false; error: string };

export function parseFindings(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `JSON parse error: ${(e as Error).message}` };
  }
  const result = findingsFileSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    return {
      ok: false,
      error: `${first?.path.join(".") ?? "$"}: ${first?.message ?? "invalid"}`,
    };
  }
  return { ok: true, data: result.data };
}
