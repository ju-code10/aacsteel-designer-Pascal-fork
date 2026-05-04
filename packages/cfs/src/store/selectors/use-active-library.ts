import type { CFSMemberLibrary } from '../../schema/cfs-member-library'
import { useCFS } from '../use-cfs'

export function getActiveLibrary(state: ReturnType<typeof useCFS.getState>): CFSMemberLibrary | null {
  const { activeLibraryId, memberLibraries } = state
  if (!activeLibraryId) return null
  return memberLibraries[activeLibraryId] ?? null
}

export function useActiveLibrary(): CFSMemberLibrary | null {
  return useCFS((s) =>
    s.activeLibraryId ? s.memberLibraries[s.activeLibraryId] ?? null : null,
  )
}
