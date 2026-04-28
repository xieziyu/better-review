import { useMemo, useState } from "react";
import { parseDiff, Diff, Hunk, type HunkData, type FileData } from "react-diff-view";
import "react-diff-view/style/index.css";

interface Props {
  unifiedDiff: string | null;
  file: string;
  line: number | null;
  findingId: string;
}

type ExpandLevel = "narrow" | "wide" | "full";

const NARROW_CTX = 3;
const WIDE_CTX = 10;

function fileMatches(f: FileData, target: string): boolean {
  return (f.newPath ?? "") === target || (f.oldPath ?? "") === target;
}

function sliceHunks(hunks: HunkData[], anchor: number, ctx: number): HunkData[] {
  return hunks
    .filter((h) => {
      const start = h.newStart - ctx;
      const end = h.newStart + h.newLines + ctx;
      return anchor >= start && anchor <= end;
    })
    .map((h) => ({
      ...h,
      changes: h.changes.filter((c) => {
        const ln = (c as { newLineNumber?: number; oldLineNumber?: number }).newLineNumber
          ?? (c as { oldLineNumber?: number }).oldLineNumber
          ?? 0;
        return ln >= anchor - ctx && ln <= anchor + ctx;
      }),
    }));
}

export function DiffViewer({ unifiedDiff, file, line, findingId }: Props) {
  const [level, setLevel] = useState<ExpandLevel>("narrow");

  const fileDiff = useMemo<FileData | undefined>(() => {
    if (!unifiedDiff) return undefined;
    try {
      const files = parseDiff(unifiedDiff);
      return files.find((f) => fileMatches(f, file));
    } catch {
      return undefined;
    }
  }, [unifiedDiff, file]);

  if (!unifiedDiff) {
    return (
      <div
        role="region"
        aria-label={`Code context for finding ${findingId}`}
        className="rounded-md border border-dashed border-gray-300 dark:border-gray-700 px-3 py-2 text-xs text-gray-500"
      >
        Loading diff…
      </div>
    );
  }

  if (!fileDiff) {
    return (
      <div
        role="region"
        aria-label={`Code context for finding ${findingId}`}
        className="rounded-md border border-dashed border-gray-300 dark:border-gray-700 px-3 py-2 text-xs text-gray-500"
      >
        File not in diff: <span className="font-mono">{file}</span>
      </div>
    );
  }

  const anchor = line ?? 0;
  const hunks: HunkData[] =
    level === "full" ? fileDiff.hunks : sliceHunks(fileDiff.hunks, anchor, level === "wide" ? WIDE_CTX : NARROW_CTX);

  return (
    <div
      role="region"
      aria-label={`Code context for finding ${findingId}`}
      className="rounded-md border border-gray-200 dark:border-gray-800 overflow-hidden"
    >
      <header className="flex items-center justify-between px-3 py-1.5 bg-gray-50 dark:bg-gray-900 text-xs font-mono border-b border-gray-200 dark:border-gray-800">
        <span className="text-gray-600 dark:text-gray-400">
          {file}
          {line ? `:${line}` : ""}
        </span>
        <div className="flex items-center gap-2">
          {level === "narrow" && (
            <button
              type="button"
              onClick={() => setLevel("wide")}
              className="text-blue-600 hover:underline"
            >
              Expand
            </button>
          )}
          {level === "wide" && (
            <button
              type="button"
              onClick={() => setLevel("full")}
              className="text-blue-600 hover:underline"
            >
              Expand full hunk
            </button>
          )}
          {level === "full" && (
            <button
              type="button"
              onClick={() => setLevel("narrow")}
              className="text-gray-500 hover:underline"
            >
              Collapse
            </button>
          )}
        </div>
      </header>
      {hunks.length === 0 ? (
        <div className="px-3 py-2 text-xs text-gray-500">No diff context near line {line}.</div>
      ) : (
        <Diff viewType="unified" diffType={fileDiff.type} hunks={hunks}>
          {(hs: HunkData[]) => hs.map((h) => <Hunk key={`${h.oldStart}-${h.newStart}`} hunk={h} />)}
        </Diff>
      )}
    </div>
  );
}
