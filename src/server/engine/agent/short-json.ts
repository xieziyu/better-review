// Compact one-line JSON for transcript display of tool-call inputs.
// Truncated so a single huge input (e.g. a full file write) cannot flood
// the transcript drawer.

const TOOL_INPUT_MAX = 120

export function shortJson(v: unknown): string {
  let s: string
  try {
    s = JSON.stringify(v)
  } catch {
    s = String(v)
  }
  if (s === undefined) return ''
  if (s.length > TOOL_INPUT_MAX) s = s.slice(0, TOOL_INPUT_MAX - 1) + '…'
  return s
}
