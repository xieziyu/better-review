import type { PRSession, SessionStatus } from '@shared/types'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { api, queryKeys, ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'

const STATUS_BADGE: Record<SessionStatus, string> = {
  running: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  pending: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  ready: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  failed: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  submitted: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  archived: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
}

interface SessionCardProps {
  session: PRSession
}

function SessionCard({ session }: SessionCardProps) {
  return (
    <Link
      to={`/pr/${session.id}`}
      className="block rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-blue-500 dark:hover:border-blue-400 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-xs text-gray-500">
          {session.owner}/{session.repo}#{session.number}
        </span>
        <span
          className={cn(
            'text-xs px-2 py-0.5 rounded-full font-medium',
            STATUS_BADGE[session.status],
          )}
        >
          {session.status}
        </span>
      </div>
      <h3 className="mt-2 text-sm font-medium line-clamp-2 text-gray-900 dark:text-gray-100">
        {session.title ?? '(no title)'}
      </h3>
      {session.author && <div className="mt-2 text-xs text-gray-500">@{session.author}</div>}
    </Link>
  )
}

export function Home() {
  const [input, setInput] = useState('')
  const nav = useNavigate()
  const qc = useQueryClient()
  const { data: sessions = [] } = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: api.listSessions,
  })
  const create = useMutation({
    mutationFn: api.createSession,
    onSuccess: ({ id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.sessions })
      nav(`/pr/${id}`)
    },
  })

  const trimmed = input.trim()
  const recent = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12)

  return (
    <div className="max-w-5xl mx-auto p-8 space-y-12">
      <header className="space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight">
          Review GitHub PRs with claude — locally
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Enter a PR number, <code className="font-mono">owner/repo#NN</code>, or a GitHub URL.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (trimmed && !create.isPending) create.mutate({ prInput: trimmed })
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="123  ·  acme/web#42  ·  https://github.com/..."
            className="flex-1 px-4 py-2.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="PR target"
          />
          <button
            type="submit"
            disabled={!trimmed || create.isPending}
            className="px-5 py-2.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed"
          >
            {create.isPending ? 'Starting…' : 'Start review'}
          </button>
        </form>
        {create.isError && (
          <div className="text-sm text-red-600 dark:text-red-400">
            {create.error instanceof ApiError ? create.error.message : 'Failed to start review'}
          </div>
        )}
      </header>

      <section>
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-3">
          Recent sessions
        </h2>
        {recent.length === 0 ? (
          <div className="text-sm text-gray-500 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-6 text-center">
            No sessions yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {recent.map((s) => (
              <SessionCard key={s.id} session={s} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
