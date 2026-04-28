import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PromptEditor } from "@/pages/PromptEditor";
import type { PromptStateResponse, PRSession } from "@shared/types";

function withClient(
  ui: React.ReactNode,
  state: { prompts?: PromptStateResponse; sessions?: PRSession[] } = {},
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (state.prompts) qc.setQueryData(["prompts"], state.prompts);
  if (state.sessions) qc.setQueryData(["sessions"], state.sessions);
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

const baseState: PromptStateResponse = {
  effective: { source: "builtin", content: "# builtin prompt body" },
  scopes: {
    cwd: { exists: false, content: null, path: "/cwd/.better-review/review.md" },
    project: { exists: false, content: null, path: "/proj/.better-review/review.md" },
    global: { exists: false, content: null, path: "/home/.better-review/review.md" },
  },
};

describe("PromptEditor", () => {
  it("defaults to the Effective tab and shows the source indicator", () => {
    render(withClient(<PromptEditor />, { prompts: baseState }));
    expect(screen.getByRole("tab", { name: /effective/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("prompt-source")).toHaveTextContent(/builtin/i);
    expect(screen.getByLabelText(/effective prompt/i)).toHaveValue(
      "# builtin prompt body",
    );
  });

  it("shows 'Override at this scope' when project has no override", async () => {
    const user = userEvent.setup();
    render(withClient(<PromptEditor />, { prompts: baseState }));
    await user.click(screen.getByRole("tab", { name: /project/i }));
    expect(
      screen.getByRole("button", { name: /override at this scope/i }),
    ).toBeInTheDocument();
  });

  it("renders an editable textarea on Project when an override exists", async () => {
    const user = userEvent.setup();
    const state: PromptStateResponse = {
      ...baseState,
      effective: { source: "project", content: "# project body" },
      scopes: {
        ...baseState.scopes,
        project: {
          exists: true,
          content: "# project body",
          path: "/proj/.better-review/review.md",
        },
      },
    };
    render(withClient(<PromptEditor />, { prompts: state }));
    await user.click(screen.getByRole("tab", { name: /project/i }));
    const ta = screen.getByLabelText(/project prompt/i) as HTMLTextAreaElement;
    expect(ta).not.toHaveAttribute("readonly");
    expect(ta.value).toBe("# project body");
  });

  it("disables Save until the textarea is dirty", async () => {
    const user = userEvent.setup();
    const state: PromptStateResponse = {
      ...baseState,
      scopes: {
        ...baseState.scopes,
        global: {
          exists: true,
          content: "old",
          path: "/home/.better-review/review.md",
        },
      },
    };
    render(withClient(<PromptEditor />, { prompts: state }));
    await user.click(screen.getByRole("tab", { name: /global/i }));
    const save = screen.getByRole("button", { name: /^save/i });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText(/global prompt/i), "x");
    expect(save).not.toBeDisabled();
  });

  it("hides 'Apply to current session' when no eligible sessions", async () => {
    const user = userEvent.setup();
    render(withClient(<PromptEditor />, { prompts: baseState, sessions: [] }));
    await user.click(screen.getByRole("tab", { name: /project/i }));
    expect(
      screen.queryByRole("button", { name: /apply to current session/i }),
    ).not.toBeInTheDocument();
  });

  it("shows 'Apply to current session' when an eligible session exists and editor is clean", async () => {
    const user = userEvent.setup();
    const sessions: PRSession[] = [
      {
        id: "s1",
        owner: "a",
        repo: "b",
        number: 1,
        title: "T",
        author: "u",
        url: null,
        baseRef: null,
        headRef: null,
        status: "ready",
        createdAt: 0,
        updatedAt: 0,
        workdir: "",
        promptUsed: "",
        error: null,
      },
    ];
    const state: PromptStateResponse = {
      ...baseState,
      scopes: {
        ...baseState.scopes,
        project: {
          exists: true,
          content: "# project body",
          path: "/proj/.better-review/review.md",
        },
      },
    };
    render(withClient(<PromptEditor />, { prompts: state, sessions }));
    await user.click(screen.getByRole("tab", { name: /project/i }));
    expect(
      screen.getByRole("button", { name: /apply to current session/i }),
    ).toBeInTheDocument();
  });
});
