import { describe, it, expect } from "vitest";
import { parsePRTarget } from "../../../src/server/github/pr-target-parser";

describe("parsePRTarget", () => {
  it("parses bare number with default repo", () => {
    expect(parsePRTarget("123", { defaultOwner: "o", defaultRepo: "r" })).toEqual({
      owner: "o",
      repo: "r",
      number: 123,
    });
  });
  it("parses owner/repo#num", () => {
    expect(parsePRTarget("foo/bar#42")).toEqual({ owner: "foo", repo: "bar", number: 42 });
  });
  it("parses GitHub URL", () => {
    expect(parsePRTarget("https://github.com/foo/bar/pull/7")).toEqual({
      owner: "foo",
      repo: "bar",
      number: 7,
    });
  });
  it("rejects bare number without default repo", () => {
    expect(() => parsePRTarget("123")).toThrow(/repo/);
  });
  it("rejects gibberish", () => {
    expect(() => parsePRTarget("???")).toThrow();
  });
});
