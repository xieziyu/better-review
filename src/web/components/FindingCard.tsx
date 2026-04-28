import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import { Pencil, Trash2, ExternalLink } from "lucide-react";
import { api, queryKeys, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { DiffViewer } from "@/components/DiffViewer";
import type { Finding, PRSession } from "@shared/types";
import type { Severity } from "@shared/findings-schema";

interface Props {
  finding: Finding;
  session: PRSession;
  unifiedDiff: string | null;
}

type SeverityTokens = { icon: string; label: string; border: string; stripe: string; text: string };

const SEVERITY_TOKENS: Record<Severity, SeverityTokens> = {
  must: {
    icon: "●",
    label: "must",
    border: "border-l-red-600 dark:border-l-red-500",
    stripe: "bg-red-50 dark:bg-red-950/40",
    text: "text-red-700 dark:text-red-300",
  },
  should: {
    icon: "◐",
    label: "should",
    border: "border-l-amber-500 dark:border-l-amber-400",
    stripe: "bg-amber-50 dark:bg-amber-950/40",
    text: "text-amber-700 dark:text-amber-300",
  },
  nit: {
    icon: "○",
    label: "nit",
    border: "border-l-emerald-600 dark:border-l-emerald-500",
    stripe: "bg-emerald-50 dark:bg-emerald-950/40",
    text: "text-emerald-700 dark:text-emerald-300",
  },
};

function githubLineLink(session: PRSession, file: string, line: number | null): string {
  const base = session.url ? `${session.url}/files` : "#";
  const anchor = line ? `R${line}` : "";
  // Best-effort GitHub anchor; users can click to navigate.
  return `${base}#diff-${encodeURIComponent(file)}${anchor}`;
}

export function FindingCard({ finding, session, unifiedDiff }: Props) {
  const qc = useQueryClient();
  const cardRef = useRef<HTMLElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    title: finding.title,
    body: finding.body,
    severity: finding.severity,
    suggestion: finding.suggestion ?? "",
  });

  useEffect(() => {
    if (!editing) {
      setDraft({
        title: finding.title,
        body: finding.body,
        severity: finding.severity,
        suggestion: finding.suggestion ?? "",
      });
    }
  }, [editing, finding]);

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: queryKeys.session(session.id) });
  };

  const select = useMutation({
    mutationFn: () => api.selectFinding(finding.dbId, { selected: !finding.selected }),
    onSuccess: invalidate,
  });

  const save = useMutation({
    mutationFn: () =>
      api.updateFinding(finding.dbId, {
        title: draft.title,
        body: draft.body,
        severity: draft.severity,
        suggestion: draft.suggestion ? draft.suggestion : null,
      }),
    onSuccess: () => {
      invalidate();
      setEditing(false);
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteFinding(finding.dbId),
    onSuccess: invalidate,
  });

  const onKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    if (editing) return;
    // Only trigger 'e' when the card itself (not a child input) is focused.
    if (e.key === "e" && e.target === cardRef.current) {
      e.preventDefault();
      setEditing(true);
    }
  };

  const onEditorKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      save.mutate();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
    }
  };

  const tokens = SEVERITY_TOKENS[finding.severity]!;

  return (
    <article
      ref={(el) => {
        cardRef.current = el;
      }}
      role="article"
      aria-labelledby={`f-${finding.dbId}-title`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn(
        "group relative rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 border-l-4 focus:outline-none focus:ring-2 focus:ring-blue-500",
        tokens.border,
      )}
    >
      <div className={cn("absolute left-0 top-0 bottom-0 w-1.5 pointer-events-none", tokens.stripe)} />
      <div className="p-4 space-y-3">
        <header className="flex items-center gap-2 flex-wrap">
          <input
            type="checkbox"
            checked={finding.selected}
            onChange={() => select.mutate()}
            aria-label={`Select finding ${finding.id}`}
            className="h-4 w-4 rounded border-gray-300 dark:border-gray-700 text-blue-600 focus:ring-blue-500"
          />
          <span className="font-mono text-xs text-gray-500">{finding.id}</span>
          <span className={cn("inline-flex items-center gap-1 text-xs font-medium", tokens.text)}>
            <span aria-hidden>{tokens.icon}</span>
            <span>{tokens.label}</span>
          </span>
          <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
            {finding.category}
          </span>
          <span className="font-mono text-xs text-gray-500">
            {finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ""}` : "(whole PR)"}
          </span>
          {finding.file && session.url && (
            <a
              href={githubLineLink(session, finding.file, finding.line)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600"
              aria-label="Open on GitHub"
            >
              <ExternalLink size={12} />
            </a>
          )}
          {finding.edited && (
            <Pencil
              size={12}
              className="text-gray-500"
              aria-label="Edited"
            />
          )}
          {!editing && (
            <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label="Edit"
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <Pencil size={14} className="text-gray-600 dark:text-gray-400" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete finding ${finding.id}?`)) remove.mutate();
                }}
                aria-label="Delete"
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <Trash2 size={14} className="text-gray-600 dark:text-gray-400" />
              </button>
            </div>
          )}
        </header>

        {!editing ? (
          <>
            <h3
              id={`f-${finding.dbId}-title`}
              className="text-base font-medium text-gray-900 dark:text-gray-100"
            >
              {finding.title}
            </h3>
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{finding.body}</ReactMarkdown>
            </div>
            {finding.file && finding.line !== null && (
              <DiffViewer
                unifiedDiff={unifiedDiff}
                file={finding.file}
                line={finding.line}
                findingId={finding.id}
              />
            )}
            {finding.suggestion && (
              <div className="rounded-md bg-blue-50/40 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900 p-3">
                <div className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-1">Suggestion</div>
                <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap">
                  <code>{finding.suggestion}</code>
                </pre>
              </div>
            )}
          </>
        ) : (
          <div onKeyDown={onEditorKeyDown} className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Title</span>
              <input
                type="text"
                aria-label="Title"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className="mt-1 w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>

            <fieldset>
              <legend className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Severity
              </legend>
              <div role="radiogroup" className="inline-flex rounded-md border border-gray-300 dark:border-gray-700 overflow-hidden">
                {(Object.keys(SEVERITY_TOKENS) as Severity[]).map((sev) => {
                  const tok = SEVERITY_TOKENS[sev]!;
                  const active = draft.severity === sev;
                  return (
                    <label
                      key={sev}
                      className={cn(
                        "px-3 py-1.5 text-xs cursor-pointer flex items-center gap-1",
                        active ? `${tok.stripe} ${tok.text}` : "hover:bg-gray-100 dark:hover:bg-gray-800",
                      )}
                    >
                      <input
                        type="radio"
                        name={`severity-${finding.dbId}`}
                        value={sev}
                        checked={active}
                        onChange={() => setDraft({ ...draft, severity: sev })}
                        aria-label={tok.label}
                        className="sr-only"
                      />
                      <span aria-hidden>{tok.icon}</span>
                      <span>{tok.label}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Body (markdown)</span>
                <textarea
                  aria-label="Body"
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  className="mt-1 w-full h-48 p-2 text-sm font-mono rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                />
              </label>
              <div className="block">
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Preview</span>
                <div className="mt-1 h-48 p-2 text-sm rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 overflow-auto prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{draft.body || "*(empty)*"}</ReactMarkdown>
                </div>
              </div>
            </div>

            <label className="block">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Suggestion (optional)</span>
              <textarea
                aria-label="Suggestion"
                value={draft.suggestion}
                onChange={(e) => setDraft({ ...draft, suggestion: e.target.value })}
                className="mt-1 w-full h-24 p-2 text-xs font-mono rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              />
            </label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => save.mutate()}
                disabled={save.isPending}
                className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300"
              >
                {save.isPending ? "Saving…" : "Save"}
              </button>
              <span className="text-xs text-gray-500">⌘↵</span>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              {save.isError && (
                <span className="text-xs text-red-600 dark:text-red-400">
                  {save.error instanceof ApiError ? save.error.message : "Save failed"}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
