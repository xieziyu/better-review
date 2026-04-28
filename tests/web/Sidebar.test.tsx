import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Sidebar } from "@/components/Sidebar";
import type { PRSession } from "@shared/types";

function withClient(
  ui: React.ReactNode,
  initial?: { sessions?: PRSession[] },
): React.ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (initial?.sessions) qc.setQueryData(["sessions"], initial.sessions);
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

const mkSession = (overrides: Partial<PRSession> = {}): PRSession => ({
  id: "s1",
  owner: "acme",
  repo: "web",
  number: 42,
  title: "feat: add login",
  author: "alice",
  url: "https://github.com/acme/web/pull/42",
  baseRef: "main",
  headRef: "feature/login",
  status: "ready",
  createdAt: 0,
  updatedAt: 0,
  workdir: "/tmp/x",
  promptUsed: "",
  error: null,
  ...overrides,
});

describe("Sidebar", () => {
  it("renders the new-PR input", () => {
    render(withClient(<Sidebar />, { sessions: [] }));
    expect(screen.getByPlaceholderText(/Enter PR # or URL/i)).toBeInTheDocument();
  });

  it("renders a session entry with repo#num and title", () => {
    render(withClient(<Sidebar />, { sessions: [mkSession()] }));
    expect(screen.getByText(/acme\/web#42/)).toBeInTheDocument();
    expect(screen.getByText(/feat: add login/)).toBeInTheDocument();
  });

  it("groups sessions by status", () => {
    render(
      withClient(<Sidebar />, {
        sessions: [
          mkSession({ id: "a", number: 1, status: "running" }),
          mkSession({ id: "b", number: 2, status: "ready" }),
          mkSession({ id: "c", number: 3, status: "failed" }),
        ],
      }),
    );
    expect(screen.getByText(/Running/)).toBeInTheDocument();
    expect(screen.getByText(/Ready/)).toBeInTheDocument();
    expect(screen.getByText(/Failed/)).toBeInTheDocument();
  });
});
