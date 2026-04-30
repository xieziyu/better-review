import type { Severity } from '@shared/findings-schema'
import type { Finding, PRSession } from '@shared/types'
import { useMemo } from 'react'

import { FindingCard } from '@/components/FindingCard'
import { EmptyState } from '@/components/ui'

const SEVERITY_ORDER: Record<Severity, number> = { must: 0, should: 1, nit: 2 }

interface Props {
  findings: Finding[]
  session: PRSession
  unifiedDiff: string | null
}

interface FileGroup {
  file: string
  items: Finding[]
}

function groupByFile(findings: Finding[]): { fileGroups: FileGroup[]; prWide: Finding[] } {
  const fileMap = new Map<string, Finding[]>()
  const prWide: Finding[] = []
  for (const f of findings) {
    if (f.file === null) {
      prWide.push(f)
    } else {
      const arr = fileMap.get(f.file) ?? []
      arr.push(f)
      fileMap.set(f.file, arr)
    }
  }
  for (const arr of fileMap.values()) {
    arr.sort(
      (a, b) =>
        (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99) || a.ord - b.ord,
    )
  }
  prWide.sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99) || a.ord - b.ord,
  )
  const fileGroups: FileGroup[] = [...fileMap.entries()]
    .map(([file, items]) => ({ file, items }))
    .sort(
      (a, b) =>
        (SEVERITY_ORDER[a.items[0]!.severity] ?? 99) -
          (SEVERITY_ORDER[b.items[0]!.severity] ?? 99) || a.file.localeCompare(b.file),
    )
  return { fileGroups, prWide }
}

export function FindingList({ findings, session, unifiedDiff }: Props) {
  const { fileGroups, prWide } = useMemo(() => groupByFile(findings), [findings])

  if (findings.length === 0) {
    return (
      <EmptyState
        eyebrow="No findings"
        title="Nothing to review"
        body="Either the agent ran cleanly, or it had nothing to say. Rerun to give it another pass."
      />
    )
  }

  return (
    <div role="list">
      {fileGroups.map((g) => (
        <section key={g.file} role="listitem" className="border-t border-rule first:border-t-0">
          <h2 className="sticky top-0 z-10 bg-canvas/95 backdrop-blur-sm py-3 flex items-baseline gap-3">
            <span className="text-caps tracking-caps text-ink-muted uppercase">File</span>
            <span className="font-mono text-meta text-ink-secondary tabular-nums truncate">
              {g.file}
            </span>
            <span className="font-mono text-meta text-ink-muted tabular-nums">
              {g.items.length}
            </span>
          </h2>
          <div className="divide-y divide-rule">
            {g.items.map((f) => (
              <FindingCard key={f.dbId} finding={f} session={session} unifiedDiff={unifiedDiff} />
            ))}
          </div>
        </section>
      ))}
      {prWide.length > 0 ? (
        <section role="listitem" className="border-t border-rule">
          <h2 className="sticky top-0 z-10 bg-canvas/95 backdrop-blur-sm py-3 flex items-baseline gap-3">
            <span className="text-caps tracking-caps text-ink-muted uppercase">PR-wide</span>
            <span className="text-meta text-ink-secondary">added to review body on submit</span>
            <span className="ml-auto font-mono text-meta text-ink-muted tabular-nums">
              {prWide.length}
            </span>
          </h2>
          <div className="divide-y divide-rule">
            {prWide.map((f) => (
              <FindingCard key={f.dbId} finding={f} session={session} unifiedDiff={unifiedDiff} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
