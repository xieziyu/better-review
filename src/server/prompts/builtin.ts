import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  resolve(here, "../../../prompts/builtin.md"),
  resolve(here, "../../../../prompts/builtin.md"),
];

let cached: string | null = null;

export function getBuiltinPrompt(): string {
  if (cached) return cached;
  for (const c of candidates) {
    try {
      cached = readFileSync(c, "utf8");
      return cached;
    } catch {
      /* try next */
    }
  }
  throw new Error("builtin prompt not found in any candidate path");
}
