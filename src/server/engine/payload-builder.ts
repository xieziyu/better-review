import type { Finding, ReviewEvent } from "../../shared/types";
import type { ReviewPayload, ReviewComment } from "../github/gh-client";
import { isLineInDiff } from "./diff-line-validator";

export interface BuildArgs {
  diff: string;
  findings: Finding[];
  event: ReviewEvent;
  userBody?: string;
}

export interface BuildResult {
  payload: ReviewPayload;
  droppedToBody: Finding[];
}

function severityTag(s: Finding["severity"]): string {
  if (s === "must") return "[MUST]";
  if (s === "should") return "[SHOULD]";
  return "[NIT]";
}

function renderFindingMarkdown(f: Finding): string {
  const tag = severityTag(f.severity);
  const loc = f.file ? ` (${f.file}${f.line ? ":" + f.line : ""})` : "";
  const head = `### ${tag} ${f.title}${loc}`;
  const sug = f.suggestion ? `\n\n\`\`\`suggestion\n${f.suggestion}\n\`\`\`` : "";
  return `${head}\n\n${f.body}${sug}`;
}

function renderInlineComment(f: Finding): string {
  const tag = `**[${f.severity.toUpperCase()}]**`;
  const sug = f.suggestion ? `\n\n\`\`\`suggestion\n${f.suggestion}\n\`\`\`` : "";
  return `${tag} ${f.title}\n\n${f.body}${sug}`;
}

export function buildSubmitPayload(args: BuildArgs): BuildResult {
  const comments: ReviewComment[] = [];
  const dropped: Finding[] = [];
  const bodyParts: string[] = [];
  if (args.userBody) bodyParts.push(args.userBody);
  for (const f of args.findings) {
    if (f.file && f.line && isLineInDiff(args.diff, f.file, f.line)) {
      comments.push({
        path: f.file,
        line: f.line,
        side: "RIGHT",
        body: renderInlineComment(f),
      });
    } else if (f.file && f.line) {
      dropped.push(f);
      bodyParts.push(renderFindingMarkdown(f));
    } else {
      bodyParts.push(renderFindingMarkdown(f));
    }
  }
  return {
    payload: { event: args.event, body: bodyParts.join("\n\n---\n\n"), comments },
    droppedToBody: dropped,
  };
}
