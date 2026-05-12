import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

interface SelectionContextValue {
  selectedFindingDbId: string | null
  setSelectedFindingDbId: (id: string | null) => void
  submitDrawerOpen: boolean
  setSubmitDrawerOpen: (open: boolean) => void
}

const SelectionContext = createContext<SelectionContextValue | null>(null)

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selectedFindingDbId, setSelectedFindingDbId] = useState<string | null>(null)
  const [submitDrawerOpen, setSubmitDrawerOpen] = useState(false)
  const value = useMemo<SelectionContextValue>(
    () => ({
      selectedFindingDbId,
      setSelectedFindingDbId,
      submitDrawerOpen,
      setSubmitDrawerOpen,
    }),
    [selectedFindingDbId, submitDrawerOpen],
  )
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}

export function useSelectedFinding(): SelectionContextValue {
  const ctx = useContext(SelectionContext)
  if (!ctx) throw new Error('useSelectedFinding must be used within SelectionProvider')
  return ctx
}

interface SubmitDrawerControls {
  isOpen: boolean
  open: () => void
  close: () => void
}

export function useSubmitDrawer(): SubmitDrawerControls {
  const { submitDrawerOpen, setSubmitDrawerOpen } = useSelectedFinding()
  return {
    isOpen: submitDrawerOpen,
    open: () => setSubmitDrawerOpen(true),
    close: () => setSubmitDrawerOpen(false),
  }
}
