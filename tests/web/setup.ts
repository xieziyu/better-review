import "@testing-library/jest-dom/vitest";

// jsdom does not implement EventSource; provide a noop stub for tests.
class StubEventSource {
  url: string;
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

if (typeof globalThis.EventSource === "undefined") {
  // @ts-expect-error -- jsdom global stub
  globalThis.EventSource = StubEventSource;
}
