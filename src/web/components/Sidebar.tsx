import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Check,
  AlertTriangle,
  CheckCheck,
  Archive,
  Clock,
} from "lucide-react";
import { api, queryKeys, ApiError } from "@/lib/api";
import { useSSE } from "@/lib/sse";
import { cn } from "@/lib/utils";
import type { PRSession, SessionStatus } from "@shared/types";

const STATUS_ORDER: SessionStatus[] = [
  "running",
  "pending",
  "ready",
  "failed",
  "submitted",
  "archived",
];

const STATUS_LABEL: Record<SessionStatus, string> = {
  running: "Running",
  pending: "Pending",
  ready: "Ready",
  failed: "Failed",
  submitted: "Submitted",
  archived: "Archived",
};

interface StatusIconProps {
  status: SessionStatus;
  size?: number;
}

function StatusIcon({ status, size = 14 }: StatusIconProps) {
  const cls = (() => {
    switch (status) {
      case "running":
        return "text-blue-600 dark:text-blue-300";
      case "pending":
        return "text-amber-600 dark:text-amber-300";
      case "ready":
        return "text-emerald-600 dark:text-emerald-300";
      case "failed":
        return "text-red-600 dark:text-red-300";
      case "submitted":
        return "text-violet-600 dark:text-violet-300";
      case "archived":
        return "text-gray-500";
    }
  })();
  switch (status) {
    case "running":
      return <Loader2 size={size} className={cn(cls, "animate-spin")} aria-label="Running" />;
    case "pending":
      return <Clock size={size} className={cls} aria-label="Pending" />;
    case "ready":
      return <Check size={size} className={cls} aria-label="Ready" />;
    case "failed":
      return <AlertTriangle size={size} className={cls} aria-label="Failed" />;
    case "submitted":
      return <CheckCheck size={size} className={cls} aria-label="Submitted" />;
    case "archived":
      return <Archive size={size} className={cls} aria-label="Archived" />;
  }
}

function relativeTime(updatedAt: number): string {
  const diffMs = Date.now() - updatedAt;
  if (diffMs < 0) return "just now";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function NewPRInput() {
  const [value, setValue] = useState("");
  const nav = useNavigate();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: api.createSession,
    onSuccess: ({ id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.sessions });
      setValue("");
      nav(`/pr/${id}`);
    },
  });
  return (
    <form
      className="p-3 border-b border-gray-200 dark:border-gray-800 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = value.trim();
        if (trimmed) create.mutate({ prInput: trimmed });
      }}
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Enter PR # or URL"
        aria-label="Enter PR number or URL"
        className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {create.isError && (
        <div className="text-xs text-red-600 dark:text-red-400">
          {create.error instanceof ApiError ? create.error.message : "Failed to create session"}
        </div>
      )}
    </form>
  );
}

interface SessionRowProps {
  session: PRSession;
}

function SessionRow({ session }: SessionRowProps) {
  return (
    <NavLink
      to={`/pr/${session.id}`}
      className={({ isActive }) =>
        cn(
          "block px-3 py-2 rounded-md text-sm border-l-2",
          isActive
            ? "bg-blue-50 dark:bg-blue-950/40 border-blue-600"
            : "border-transparent hover:bg-gray-100 dark:hover:bg-gray-900",
        )
      }
    >
      <div className="flex items-center gap-2">
        <StatusIcon status={session.status} />
        <span className="font-mono text-xs text-gray-600 dark:text-gray-400 truncate">
          {session.owner}/{session.repo}#{session.number}
        </span>
        <span className="ml-auto text-xs text-gray-500">
          {relativeTime(session.updatedAt)}
        </span>
      </div>
      <div className="mt-1 text-sm truncate text-gray-900 dark:text-gray-100">
        {session.title ?? "(no title)"}
      </div>
    </NavLink>
  );
}

export function Sidebar() {
  const qc = useQueryClient();
  const { data: sessions = [] } = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: api.listSessions,
  });
  useSSE("/api/events", (e) => {
    if (
      e.type === "status-changed" ||
      e.type === "done" ||
      e.type === "error" ||
      e.type === "finding-added" ||
      e.type === "finding-updated"
    ) {
      void qc.invalidateQueries({ queryKey: queryKeys.sessions });
    }
  });

  const grouped = new Map<SessionStatus, PRSession[]>();
  for (const s of sessions) {
    const arr = grouped.get(s.status) ?? [];
    arr.push(s);
    grouped.set(s.status, arr);
  }
  for (const arr of grouped.values()) arr.sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <aside className="w-72 lg:w-[280px] shrink-0 border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 flex flex-col">
      <NewPRInput />
      <nav className="flex-1 overflow-y-auto p-2 space-y-3" aria-label="Sessions">
        {sessions.length === 0 && (
          <div className="text-xs text-gray-500 px-3 py-4">
            No sessions yet. Enter a PR above to start.
          </div>
        )}
        {STATUS_ORDER.map((status) => {
          const items = grouped.get(status);
          if (!items || items.length === 0) return null;
          return (
            <section key={status} className="space-y-1">
              <h3 className="px-3 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {STATUS_LABEL[status]}
              </h3>
              <div className="space-y-1">
                {items.map((s) => (
                  <SessionRow key={s.id} session={s} />
                ))}
              </div>
            </section>
          );
        })}
      </nav>
      <footer className="p-3 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-500 flex gap-3">
        <Link to="/prompt" className="hover:underline">Prompt</Link>
        <Link to="/settings" className="hover:underline">Settings</Link>
      </footer>
    </aside>
  );
}
