import { describe, it, expect, beforeEach } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GhClient } from "../../../src/server/github/gh-client";
import { GhPRNotFoundError, GhSubmitError } from "../../../src/server/github/errors";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = resolve(here, "../../fixtures/fake-gh.sh");

describe("GhClient", () => {
  beforeEach(() => {
    delete process.env.FAKE_GH_AUTHED;
    delete process.env.FAKE_GH_NOTFOUND;
    delete process.env.FAKE_GH_SUBMIT_FAIL;
  });

  it("authStatus true when fake gh succeeds", async () => {
    const c = new GhClient({ ghPath: FAKE });
    expect(await c.authStatus()).toBe(true);
  });

  it("authStatus false when env says not logged in", async () => {
    process.env.FAKE_GH_AUTHED = "0";
    const c = new GhClient({ ghPath: FAKE });
    expect(await c.authStatus()).toBe(false);
  });

  it("prView returns parsed PRMeta", async () => {
    const c = new GhClient({ ghPath: FAKE });
    const meta = await c.prView({ owner: "o", repo: "r", number: 1 });
    expect(meta.title).toBe("Title");
    expect(meta.author).toBe("alice");
    expect(meta.baseRef).toBe("main");
  });

  it("prView throws GhPRNotFoundError when fake says missing", async () => {
    process.env.FAKE_GH_NOTFOUND = "1";
    const c = new GhClient({ ghPath: FAKE });
    await expect(c.prView({ owner: "o", repo: "r", number: 1 })).rejects.toBeInstanceOf(
      GhPRNotFoundError,
    );
  });

  it("prDiff returns unifiedDiff string", async () => {
    const c = new GhClient({ ghPath: FAKE });
    const d = await c.prDiff({ owner: "o", repo: "r", number: 1 });
    expect(d.unifiedDiff).toContain("diff --git");
  });

  it("submitReview returns html_url", async () => {
    const c = new GhClient({ ghPath: FAKE });
    const r = await c.submitReview(
      { owner: "o", repo: "r", number: 1 },
      { event: "COMMENT", body: "hi", comments: [] },
    );
    expect(r.html_url).toContain("pullrequestreview");
  });

  it("submitReview throws GhSubmitError on failure", async () => {
    process.env.FAKE_GH_SUBMIT_FAIL = "1";
    const c = new GhClient({ ghPath: FAKE });
    await expect(
      c.submitReview(
        { owner: "o", repo: "r", number: 1 },
        { event: "COMMENT", body: "x", comments: [] },
      ),
    ).rejects.toBeInstanceOf(GhSubmitError);
  });
});
