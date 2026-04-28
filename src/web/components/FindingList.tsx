import { useMemo } from "react";
import { FindingCard } from "@/components/FindingCard";
import type { Finding, PRSession } from "@shared/types";
import type { Severity } from "@shared/findings-schema";

const SEVERITY_ORDER: Record<Severity, number> = { must: 0, should: 1, nit: 2 };

interface Props {
  findings: Finding[];
  session: PRSession;
  unifiedDiff: string | null;
}

interface FileGroup {
  file: string;
  items: Finding[];
}

function groupByFile(findings: Finding[]): { fileGroups: FileGroup[]; prWide: Finding[] } {
  const fileMap = new Map<string, Finding[]>();
  const prWide: Finding[] = [];
  for (const f of findings) {
    if (f.file === null) {
      prWide.push(f);
    } else {
      const arr = fileMap.get(f.file) ?? [];
      arr.push(f);
      fileMap.set(f.file, arr);
    }
  }
  for (const arr of fileMap.values()) {
    arr.sort(
      (a, b) =>
        (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99) ||
        a.ord - b.ord,
    );
  }
  prWide.sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99) || a.ord - b.ord,
  );
  const fileGroups: FileGroup[] = [...fileMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, items]) => ({ file, items }));
  return { fileGroups, prWide };
}

export function FindingList({ findings, session, unifiedDiff }: Props) {
  const { fileGroups, prWide } = useMemo(() => groupByFile(findings), [findings]);

  if (findings.length === 0) {
    return (
      <div className="text-sm text-gray-500 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-8 text-center">
        No findings.
      </div>
    );
  }

  return (
    <div className="space-y-8" role="list">
      {fileGroups.map((g) => (
        <section key={g.file} className="space-y-3" role="listitem">
          <h2 className="sticky top-0 z-10 bg-white dark:bg-gray-950 py-2 text-sm font-mono text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-800">
            {g.file}
            <span className="ml-2 text-xs text-gray-500 font-sans">
              ({g.items.length} finding{g.items.length === 1 ? "" : "s"})
            </span>
          </h2>
          <div className="space-y-3">
            {g.items.map((f) => (
              <FindingCard key={f.dbId} finding={f} session={session} unifiedDiff={unifiedDiff} />
            ))}
          </div>
        </section>
      ))}
      {prWide.length > 0 && (
        <section className="space-y-3" role="listitem">
          <h2 className="sticky top-0 z-10 bg-white dark:bg-gray-950 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-800">
            PR-wide
            <span className="ml-2 text-xs text-gray-500 font-normal">
              ({prWide.length} finding{prWide.length === 1 ? "" : "s"} · added to review body on submit)
            </span>
          </h2>
          <div className="space-y-3">
            {prWide.map((f) => (
              <FindingCard key={f.dbId} finding={f} session={session} unifiedDiff={unifiedDiff} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
