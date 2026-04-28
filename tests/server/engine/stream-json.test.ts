import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { parseStreamJson, type StreamEvent } from "../../../src/server/engine/stream-json";

describe("parseStreamJson", () => {
  it("emits events for each newline-delimited JSON object", async () => {
    const lines =
      [
        JSON.stringify({ type: "system", subtype: "init" }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "tool_use", name: "Write" }] },
        }),
        JSON.stringify({ type: "result", subtype: "success" }),
      ].join("\n") + "\n";
    const events: StreamEvent[] = [];
    const stream = Readable.from([lines]);
    await parseStreamJson(stream, (e) => events.push(e));
    expect(events).toHaveLength(3);
    expect(events[1]!.type).toBe("assistant");
  });

  it("handles split-across-chunks lines", async () => {
    const events: StreamEvent[] = [];
    const stream = Readable.from([`{"type":"as`, `sistant"}\n{"type":"result"}\n`]);
    await parseStreamJson(stream, (e) => events.push(e));
    expect(events.map((e) => e.type)).toEqual(["assistant", "result"]);
  });

  it("calls onError on malformed line", async () => {
    const events: StreamEvent[] = [];
    const errors: string[] = [];
    const stream = Readable.from([`{"ok":1}\nBROKEN\n{"ok":2}\n`]);
    await parseStreamJson(
      stream,
      (e) => events.push(e),
      (err) => errors.push(err),
    );
    expect(events).toHaveLength(2);
    expect(errors).toHaveLength(1);
  });
});
