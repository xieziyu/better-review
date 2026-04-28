import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionsRepo } from "../db/sessions";
import type { FindingsRepo } from "../db/findings";
import type { SubmissionsRepo } from "../db/submissions";
import type { GhClient } from "../github/gh-client";
import type { ReviewEvent } from "../../shared/types";
import { buildSubmitPayload } from "./payload-builder";

export interface SubmitArgs {
  sessionId: string;
  event: ReviewEvent;
  body?: string;
  sessions: SessionsRepo;
  findings: FindingsRepo;
  submissions: SubmissionsRepo;
  gh: GhClient;
}

export interface SubmitResult {
  url: string;
  droppedToBody: string[];
}

export async function submitSession(args: SubmitArgs): Promise<SubmitResult> {
  const session = args.sessions.getById(args.sessionId);
  if (!session) throw new Error("session not found");
  const all = args.findings.listBySession(args.sessionId);
  const selected = all.filter((f) => f.selected);
  const diff = readFileSync(join(session.workdir, "diff.cache"), "utf8");
  const built = buildSubmitPayload({
    diff,
    findings: selected,
    event: args.event,
    userBody: args.body,
  });
  const findingIds = selected.map((f) => f.dbId);
  try {
    const r = await args.gh.submitReview(
      { owner: session.owner, repo: session.repo, number: session.number },
      built.payload,
    );
    args.submissions.insert({
      sessionId: args.sessionId,
      event: args.event,
      githubUrl: r.html_url,
      payloadJson: JSON.stringify(built.payload),
      findingIds,
      error: null,
    });
    args.sessions.setStatus(args.sessionId, "submitted");
    return { url: r.html_url, droppedToBody: built.droppedToBody.map((f) => f.dbId) };
  } catch (e) {
    args.submissions.insert({
      sessionId: args.sessionId,
      event: args.event,
      githubUrl: null,
      payloadJson: JSON.stringify(built.payload),
      findingIds,
      error: (e as Error).message,
    });
    throw e;
  }
}
