import type { Severity } from '@shared/findings-schema'

import type { FileSummary } from './diff-utils'

export interface Aggregate {
  count: number
  severities: Set<Severity>
  additions: number
  deletions: number
}

interface BaseNode {
  path: string
  displaySegments: string[]
  depth: number
  aggregate: Aggregate
}

export interface FolderNode extends BaseNode {
  kind: 'folder'
  children: TreeNode[]
}

export interface FileNode extends BaseNode {
  kind: 'file'
  file: FileSummary
}

export type TreeNode = FolderNode | FileNode

export interface BuildTreeContext {
  countsByFile: Map<string, number>
  severitiesByFile: Map<string, Set<Severity>>
}

function emptyAggregate(): Aggregate {
  return { count: 0, severities: new Set(), additions: 0, deletions: 0 }
}

interface RawFolder {
  kind: 'folder'
  segment: string
  path: string
  // Two separate namespaces — a file and a folder may share the same segment
  // within a single PR diff (e.g. a refactor that deletes `Makefile` and adds
  // `Makefile/something.mk`). Keeping them in the same Map would silently
  // overwrite one with the other.
  folders: Map<string, RawFolder>
  files: Map<string, RawFile>
  aggregate: Aggregate
}

interface RawFile {
  kind: 'file'
  segment: string
  path: string
  file: FileSummary
  aggregate: Aggregate
}

type RawNode = RawFolder | RawFile

function mergeAggregate(into: Aggregate, file: FileSummary, ctx: BuildTreeContext): void {
  into.additions += file.additions
  into.deletions += file.deletions
  into.count += ctx.countsByFile.get(file.path) ?? 0
  const sevs = ctx.severitiesByFile.get(file.path)
  if (sevs) for (const s of sevs) into.severities.add(s)
}

function getOrCreateFolder(
  parentFolders: Map<string, RawFolder>,
  segment: string,
  path: string,
): RawFolder {
  const existing = parentFolders.get(segment)
  if (existing) return existing
  const next: RawFolder = {
    kind: 'folder',
    segment,
    path,
    folders: new Map(),
    files: new Map(),
    aggregate: emptyAggregate(),
  }
  parentFolders.set(segment, next)
  return next
}

interface Roots {
  folders: Map<string, RawFolder>
  files: Map<string, RawFile>
}

function insertFile(roots: Roots, file: FileSummary, ctx: BuildTreeContext): void {
  const segments = file.path.split('/').filter((s) => s.length > 0)
  if (segments.length === 0) return
  let parentFolders = roots.folders
  let parentFiles = roots.files
  let pathSoFar = ''
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!
    pathSoFar = pathSoFar ? `${pathSoFar}/${seg}` : seg
    const folder = getOrCreateFolder(parentFolders, seg, pathSoFar)
    mergeAggregate(folder.aggregate, file, ctx)
    parentFolders = folder.folders
    parentFiles = folder.files
  }
  const leafSeg = segments[segments.length - 1]!
  const leafPath = pathSoFar ? `${pathSoFar}/${leafSeg}` : leafSeg
  const leafAgg = emptyAggregate()
  mergeAggregate(leafAgg, file, ctx)
  parentFiles.set(leafSeg, {
    kind: 'file',
    segment: leafSeg,
    path: leafPath,
    file,
    aggregate: leafAgg,
  })
}

function singleChild(folder: RawFolder): RawNode | undefined {
  if (folder.folders.size + folder.files.size !== 1) return undefined
  const subfolder = folder.folders.values().next()
  if (!subfolder.done) return subfolder.value
  const subfile = folder.files.values().next()
  if (!subfile.done) return subfile.value
  return undefined
}

function emitChildren(folder: RawFolder, depth: number): TreeNode[] {
  const folderChildren = [...folder.folders.values()].sort((a, b) =>
    a.segment.localeCompare(b.segment),
  )
  const fileChildren = [...folder.files.values()].sort((a, b) =>
    a.segment.localeCompare(b.segment),
  )
  return [...folderChildren, ...fileChildren].map((c) => compress(c, depth, []))
}

function compress(raw: RawNode, depth: number, prefixSegments: string[]): TreeNode {
  const merged = [...prefixSegments, raw.segment]
  if (raw.kind === 'file') {
    return {
      kind: 'file',
      path: raw.path,
      displaySegments: merged,
      depth,
      aggregate: raw.aggregate,
      file: raw.file,
    }
  }
  const sole = singleChild(raw)
  if (sole) {
    // Absorb segment into the chain and recurse on the sole child. The
    // resulting node uses the deepest node's `path` (file or folder leaf of
    // the chain) so React keys, selection, and collapse state align with
    // what's actually visible.
    return compress(sole, depth, merged)
  }
  return {
    kind: 'folder',
    path: raw.path,
    displaySegments: merged,
    depth,
    aggregate: raw.aggregate,
    children: emitChildren(raw, depth + 1),
  }
}

/**
 * Build a path-compressed file tree from the flat `FileSummary[]`.
 *
 * Compression rule: any folder whose direct-children count is exactly 1 is
 * merged with its sole child into a single row. The merge walks until it
 * hits either a folder with multiple children or a file. The resulting
 * `displaySegments` array lets the UI render absorbed parent segments dimmed
 * and the terminal segment bright.
 *
 * Aggregates (count of findings, set of severities, total +/-) are computed
 * in a single descent pass and preserved through compression.
 */
export function buildFileTree(files: FileSummary[], ctx: BuildTreeContext): TreeNode[] {
  const roots: Roots = { folders: new Map(), files: new Map() }
  for (const f of files) insertFile(roots, f, ctx)
  const folderRoots = [...roots.folders.values()].sort((a, b) =>
    a.segment.localeCompare(b.segment),
  )
  const fileRoots = [...roots.files.values()].sort((a, b) => a.segment.localeCompare(b.segment))
  return [...folderRoots, ...fileRoots].map((r) => compress(r, 0, []))
}

/**
 * Walk a tree and collect every folder path that is an ancestor of a file
 * node matching `predicate`. Used by the FileTree to force-expand ancestors
 * of search-matching files without mutating the persisted collapse set.
 */
export function collectAncestorsOfMatches(
  tree: TreeNode[],
  predicate: (file: FileSummary) => boolean,
): Set<string> {
  const out = new Set<string>()
  function walk(node: TreeNode, ancestorPaths: string[]): boolean {
    if (node.kind === 'file') {
      if (predicate(node.file)) {
        for (const p of ancestorPaths) out.add(p)
        return true
      }
      return false
    }
    let anyMatch = false
    const next = [...ancestorPaths, node.path]
    for (const c of node.children) if (walk(c, next)) anyMatch = true
    return anyMatch
  }
  for (const n of tree) walk(n, [])
  return out
}

interface FlattenContext {
  isFolderOpen: (path: string) => boolean
}

export type VisibleRow =
  | { kind: 'folder'; node: FolderNode; isOpen: boolean }
  | { kind: 'file'; node: FileNode }

export function flattenVisible(tree: TreeNode[], ctx: FlattenContext): VisibleRow[] {
  const rows: VisibleRow[] = []
  function walk(node: TreeNode): void {
    if (node.kind === 'file') {
      rows.push({ kind: 'file', node })
      return
    }
    const isOpen = ctx.isFolderOpen(node.path)
    rows.push({ kind: 'folder', node, isOpen })
    if (!isOpen) return
    for (const c of node.children) walk(c)
  }
  for (const n of tree) walk(n)
  return rows
}
