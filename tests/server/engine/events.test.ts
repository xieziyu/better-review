import { describe, it, expect } from "vitest";
import { EventBus } from "../../../src/server/engine/events";
import type { SSEEvent } from "../../../src/shared/types";

describe("EventBus", () => {
  it("delivers session event to per-session and global subscribers", () => {
    const bus = new EventBus();
    const perSession: SSEEvent[] = [];
    const global: SSEEvent[] = [];
    const offA = bus.subscribeSession("s1", (e) => perSession.push(e));
    const offB = bus.subscribeGlobal((e) => global.push(e));
    bus.emit({ type: "done", sessionId: "s1" });
    expect(perSession).toHaveLength(1);
    expect(global).toHaveLength(1);
    offA();
    offB();
  });

  it("does not leak across sessions", () => {
    const bus = new EventBus();
    const got: SSEEvent[] = [];
    bus.subscribeSession("s1", (e) => got.push(e));
    bus.emit({ type: "done", sessionId: "s2" });
    expect(got).toHaveLength(0);
  });

  it("global broadcast (no sessionId) reaches global only", () => {
    const bus = new EventBus();
    const session: SSEEvent[] = [];
    const global: SSEEvent[] = [];
    bus.subscribeSession("s1", (e) => session.push(e));
    bus.subscribeGlobal((e) => global.push(e));
    bus.emit({ type: "shutting-down" });
    expect(session).toHaveLength(0);
    expect(global).toHaveLength(1);
  });
});
