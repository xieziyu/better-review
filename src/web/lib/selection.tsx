import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

interface SelectionContextValue {
  selectedFindingDbId: string | null
  setSelectedFindingDbId: (id: string | null) => void
}

const SelectionContext = createContext<SelectionContextValue | null>(null)

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selectedFindingDbId, setSelectedFindingDbId] = useState<string | null>(null)
  const value = useMemo<SelectionContextValue>(
    () => ({ selectedFindingDbId, setSelectedFindingDbId }),
    [selectedFindingDbId],
  )
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}

export function useSelectedFinding(): SelectionContextValue {
  const ctx = useContext(SelectionContext)
  if (!ctx) throw new Error('useSelectedFinding must be used within SelectionProvider')
  return ctx
}
