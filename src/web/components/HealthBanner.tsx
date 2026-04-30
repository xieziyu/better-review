import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { api, queryKeys } from '@/lib/api'

export function HealthBanner() {
  const { data } = useQuery({
    queryKey: queryKeys.health,
    queryFn: api.health,
    refetchInterval: 30_000,
  })
  if (!data) return null
  const issues: string[] = []
  const def = data.defaultAgent
  if (!data.agents[def].found) {
    issues.push(`default agent \`${def}\` not found in PATH`)
  }
  if (!data.gh.found) issues.push('`gh` CLI not found in PATH')
  else if (!data.gh.authed) issues.push('`gh` is not authenticated, run `gh auth login`')
  if (issues.length === 0) return null
  return (
    <div
      role="alert"
      className="flex items-center gap-3 px-4 py-2 bg-brand text-brand-ink text-meta"
    >
      <span className="text-caps tracking-caps font-bold uppercase shrink-0">Blocker</span>
      <span className="flex-1 truncate">{issues.join(' · ')}</span>
      <Link
        to="/settings"
        className="text-caps tracking-caps font-bold uppercase underline-offset-4 hover:underline shrink-0"
      >
        open settings
      </Link>
    </div>
  )
}
