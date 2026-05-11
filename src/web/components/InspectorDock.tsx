import { useEffect, useState } from 'react'

import { Inspector } from '@/components/Inspector'

const QUERY = '(min-width: 1280px)'

function readMatch(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia(QUERY).matches
}

export function InspectorDock() {
  const [wide, setWide] = useState<boolean>(() => readMatch())
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(QUERY)
    const onChange = (e: MediaQueryListEvent) => setWide(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  if (!wide) return null
  return <Inspector />
}
