import { useQuery } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";

const CONFIG_SNIPPET = `{
  "port": 0,
  "idleShutdownMinutes": 240,
  "maxConcurrentReviews": 4,
  "claudeStallMinutes": 3,
  "perPRGCDays": 7
}`;

export function Settings() {
  const { data: health } = useQuery({ queryKey: queryKeys.health, queryFn: api.health });

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <header>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          better-review reads its configuration from{" "}
          <code className="font-mono text-xs px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-900">
            ~/.better-review/config.json
          </code>
          . Edit that file and restart the daemon to apply changes.
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Defaults
        </h2>
        <pre
          data-testid="config-snippet"
          className="text-xs font-mono p-3 rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 overflow-auto"
        >
          {CONFIG_SNIPPET}
        </pre>
        <dl className="text-xs text-gray-600 dark:text-gray-400 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
          <dt className="font-mono">idleShutdownMinutes</dt>
          <dd>Auto-shutdown when no browser tab is connected for this many minutes.</dd>
          <dt className="font-mono">maxConcurrentReviews</dt>
          <dd>How many claude processes may run in parallel.</dd>
          <dt className="font-mono">claudeStallMinutes</dt>
          <dd>Watchdog kills a claude run with no stdout for this many minutes.</dd>
          <dt className="font-mono">perPRGCDays</dt>
          <dd>Garbage-collect per-PR workdirs after this many days.</dd>
        </dl>
      </section>

      {health && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Daemon
          </h2>
          <dl className="text-sm grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
            <dt className="text-gray-500">pid</dt>
            <dd data-testid="daemon-pid" className="font-mono text-xs">
              {health.daemon.pid}
            </dd>
            <dt className="text-gray-500">port</dt>
            <dd data-testid="daemon-port" className="font-mono text-xs">
              {health.daemon.port}
            </dd>
            <dt className="text-gray-500">started</dt>
            <dd className="text-xs">
              {new Date(health.daemon.startedAt).toLocaleString()}
            </dd>
            <dt className="text-gray-500">claude</dt>
            <dd data-testid="claude-path" className="font-mono text-xs">
              {health.claude.path ?? "(not found)"}
            </dd>
            <dt className="text-gray-500">gh</dt>
            <dd data-testid="gh-path" className="font-mono text-xs">
              {health.gh.path ?? "(not found)"} ·{" "}
              <span
                className={
                  health.gh.authed
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }
              >
                {health.gh.authed ? "authed" : "not authed"}
              </span>
            </dd>
          </dl>
        </section>
      )}
    </div>
  );
}
