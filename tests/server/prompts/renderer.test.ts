import { describe, it, expect } from "vitest";
import { renderPrompt } from "../../../src/server/prompts/renderer";

describe("renderPrompt", () => {
  it("substitutes all variables", () => {
    const tpl = "M: {{PR_META}}\nD: {{DIFF}}\nP: {{FINDINGS_PATH}}\nS: {{SCHEMA}}";
    const out = renderPrompt(tpl, {
      prMeta: "META",
      diff: "DIFF",
      findingsPath: "/p/f.json",
      schemaJson: "{}",
    });
    expect(out).toBe("M: META\nD: DIFF\nP: /p/f.json\nS: {}");
  });
  it("leaves unknown placeholders alone", () => {
    expect(
      renderPrompt("hello {{UNKNOWN}}", {
        prMeta: "x",
        diff: "x",
        findingsPath: "x",
        schemaJson: "x",
      }),
    ).toBe("hello {{UNKNOWN}}");
  });
});
