import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCw, ExternalLink, Loader2, Check, AlertTriangle, CheckCheck } from "lucide-react";
import { api, queryKeys, ApiError } from "@/lib/api";
import { useSSE } from "@/lib/sse";
import { cn } from "@/lib/utils";
import { FindingList } from "@/components/FindingList";
import { SubmitDrawer } from "@/components/SubmitDrawer";
import type { PRSession, SessionStatus } from "@shared/types";

const STATUS_BADGE: Record<SessionStatus, { label: string; cls: string }> = {
  running: {
    label: "running",
    cls: "text-blue-700 bg-blue-50 dark:text-blue-300 dark:bg-blue-950/40",
  },
  pending: {
    label: "pending",
    cls: "text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40",
  },
  ready: {
    label: "ready",
    cls: "text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40",
  },
  failed: {
    label: "failed",
    cls: "text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-950/40",
  },
  submitted: {
    label: "submitted",
    cls: "text-violet-700 bg-violet-50 dark:text-violet-300 dark:bg-violet-950/40",
  },
  archived: {
    label: "archived",
    cls: "text-gray-500 bg-gray-100 dark:bg-gray-800",
  },
};

function StatusBadge({ status }: { status: SessionStatus }) {
  const { label, cls } = STATUS_BADGE[status];
  const Icon =
    status === "running"
      ? Loader2
      : status === "ready"
        ? Check
        : status === "failed"
          ? AlertTriangle
          : status === "submitted"
            ? CheckCheck
            : null;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium", cls)}>
      {Icon && <Icon size={12} className={status === "running" ? "animate-spin" : undefined} />}
      {label}
    </span>
  );
}

function PRHeader({
  session,
  selectedCount,
  onRerun,
  onSubmit,
  rerunPending,
}: {
  session: PRSession;
  selectedCount: number;
  onRerun: () => void;
  onSubmit: () => void;
  rerunPending: boolean;
}) {
  return (
    <header className="space-y-2">
      <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {session.title ?? `${session.owner}/${session.repo}#${session.number}`}
      </h1>
      <div className="flex items-center gap-3 text-sm text-gray-500">
        <span className="font-mono">
          {session.owner}/{session.repo}#{session.number}
        </span>
        {session.author && <span>@{session.author}</span>}
        {session.url && (
          <a
            href={session.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:text-blue-600"
          >
            <ExternalLink size={12} />
            open on GitHub
          </a>
        )}
      </div>
      <div className="flex items-center gap-3 pt-2">
        <StatusBadge status={session.status} />
        {session.status === "submitted" && (
          <span className="text-xs text-gray-500">Submitted to GitHub.</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (session.status === "running") {
                if (!confirm("Rerun while a review is still in progress? Current run will be canceled.")) return;
              }
              onRerun();
            }}
            disabled={rerunPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            <RotateCw size={14} className={rerunPending ? "animate-spin" : undefined} />
            Rerun
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={selectedCount === 0}
            className="px-4 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed"
            title={selectedCount === 0 ? "Select at least one finding" : undefined}
          >
            Submit{selectedCount > 0 ? ` (${selectedCount})` : ""}
          </button>
        </div>
      </div>
    </header>
  );
}

export function PRDetail() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const [submitOpen, setSubmitOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.session(id),
    queryFn: () => api.getSession(id),
    enabled: !!id,
  });

  const { data: diffFromEndpoint } = useQuery({
    queryKey: ["session", id, "diff"],
    queryFn: () => api.getSessionDiff(id),
    enabled: !!id,
    retry: false,
  });

  useSSE(`/api/sessions/${id}/events`, () => {
    void qc.invalidateQueries({ queryKey: queryKeys.session(id) });
  });

  const rerun = useMutation({
    mutationFn: () => api.rerunSession(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.session(id) });
    },
  });

  if (isLoading || !data) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-3 animate-pulse">
        <div className="h-5 w-2/3 bg-gray-200 dark:bg-gray-800 rounded" />
        <div className="h-4 w-1/3 bg-gray-200 dark:bg-gray-800 rounded" />
        <div className="h-32 bg-gray-200 dark:bg-gray-800 rounded mt-6" />
      </div>
    );
  }

  const { session, findings } = data;
  const inlineDiff = data.diff ?? diffFromEndpoint ?? null;
  const activeFindings = findings.filter((f) => !f.archived);
  const selectedCount = activeFindings.filter((f) => f.selected).length;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <PRHeader
        session={session}
        selectedCount={selectedCount}
        onRerun={() => rerun.mutate()}
        onSubmit={() => setSubmitOpen(true)}
        rerunPending={rerun.isPending}
      />

      {session.error && (
        <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <div className="font-medium">Session error</div>
          <div className="mt-1">{session.error}</div>
        </div>
      )}

      {rerun.isError && (
        <div className="rounded-md bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {rerun.error instanceof ApiError ? rerun.error.message : "Rerun failed"}
        </div>
      )}

      {session.status === "running" && activeFindings.length === 0 && (
        <div className="rounded-md border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 px-4 py-6 text-sm text-blue-700 dark:text-blue-300 text-center">
          <Loader2 size={18} className="inline-block mr-2 animate-spin" />
          claude is reviewing… findings will stream in here as they're produced.
        </div>
      )}

      {session.status === "ready" && activeFindings.length === 0 && (
        <div className="rounded-md border border-dashed border-gray-300 dark:border-gray-700 px-6 py-8 text-center">
          <div className="text-sm text-gray-700 dark:text-gray-300">
            No issues found. Either the PR is clean, or the prompt missed something.
          </div>
          <div className="mt-3 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => rerun.mutate()}
              className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Rerun
            </button>
          </div>
        </div>
      )}

      {activeFindings.length > 0 && (
        <FindingList findings={activeFindings} session={session} unifiedDiff={inlineDiff} />
      )}

      {submitOpen && (
        <SubmitDrawer
          sessionId={id}
          onClose={() => setSubmitOpen(false)}
        />
      )}
    </div>
  );
}
