import { useQuery } from '@tanstack/react-query'

import { api, queryKeys } from '@/lib/api'

export function HealthBanner() {
  const { data } = useQuery({
    queryKey: queryKeys.health,
    queryFn: api.health,
    refetchInterval: 30_000,
  })
  if (!data) return null
  const issues: string[] = []
  if (!data.claude.found) issues.push('`claude` CLI not found in PATH')
  if (!data.gh.found) issues.push('`gh` CLI not found in PATH')
  else if (!data.gh.authed) issues.push('`gh` is not authenticated — run `gh auth login`')
  if (issues.length === 0) return null
  return (
    <div role="alert" className="bg-red-600 text-white px-4 py-2 text-sm font-medium">
      {issues.join(' · ')}
    </div>
  )
}
