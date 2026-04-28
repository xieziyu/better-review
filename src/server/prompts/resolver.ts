import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getBuiltinPrompt } from "./builtin";

export type PromptSource = "project" | "global" | "builtin";

export interface ResolvedPrompt {
  source: PromptSource;
  content: string;
  path: string | null;
}

export function resolveEffectivePrompt(opts: { cwd: string; home: string }): ResolvedPrompt {
  const project = join(opts.cwd, ".better-review", "review.md");
  if (existsSync(project))
    return { source: "project", content: readFileSync(project, "utf8"), path: project };
  const global = join(opts.home, "review.md");
  if (existsSync(global))
    return { source: "global", content: readFileSync(global, "utf8"), path: global };
  return { source: "builtin", content: getBuiltinPrompt(), path: null };
}
