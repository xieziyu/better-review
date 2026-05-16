import {
  findChangeByNewLineNumber,
  parseDiff,
  type ChangeData,
  type FileData,
  type HunkData,
} from 'react-diff-view'

export type FileChangeStatus = 'add' | 'delete' | 'modify' | 'rename' | 'copy'

export interface FileSummary {
  /** Display path: newPath unless the file was deleted, then oldPath. */
  path: string
  oldPath: string
  newPath: string
  status: FileChangeStatus
  additions: number
  deletions: number
  hunks: HunkData[]
  fileData: FileData
}

function displayPath(file: FileData): string {
  if (file.type === 'delete') return file.oldPath
  return file.newPath || file.oldPath
}

function countChanges(hunks: HunkData[]): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const h of hunks) {
    for (const c of h.changes) {
      if (c.type === 'insert') additions++
      else if (c.type === 'delete') deletions++
    }
  }
  return { additions, deletions }
}

/**
 * Parse a unified diff into a flat per-file summary. Used by the Files Changed
 * tab to render the left rail. Files are returned in the order the diff emits
 * them (i.e. the order `gh pr diff` produced — usually alphabetical-ish).
 */
export function parseFileList(diff: string): FileSummary[] {
  if (!diff) return []
  let files: FileData[] = []
  try {
    files = parseDiff(diff)
  } catch {
    return []
  }
  return files.map((f) => {
    const { additions, deletions } = countChanges(f.hunks)
    return {
      path: displayPath(f),
      oldPath: f.oldPath,
      newPath: f.newPath,
      status: f.type as FileChangeStatus,
      additions,
      deletions,
      hunks: f.hunks,
      fileData: f,
    }
  })
}

/** Look up hunks for a specific file path (matches either old or new path). */
export function getFileHunks(diff: string, path: string): HunkData[] {
  const list = parseFileList(diff)
  const hit = list.find((f) => f.path === path || f.newPath === path || f.oldPath === path)
  return hit?.hunks ?? []
}

/**
 * Strict anchor check: is the given new-side line number rendered as part of
 * any hunk in `hunks`? Returns the change so callers can use it to look up
 * react-diff-view's `getChangeKey` for widget mounting; null otherwise.
 *
 * Both `insert` (added) and `normal` (context) changes count — they're both
 * visible in the new-side rendering. `delete` lines don't qualify because they
 * have no new-side line number.
 */
export function findNewSideChange(hunks: HunkData[], line: number): ChangeData | null {
  if (hunks.length === 0) return null
  const found = findChangeByNewLineNumber(hunks, line)
  return found ?? null
}

export function isLineOnNewSide(hunks: HunkData[], line: number): boolean {
  return findNewSideChange(hunks, line) !== null
}
