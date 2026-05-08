import type { CFSSection } from '../../schema/cfs-member-library'
import type { CFSSectionId } from '../../schema/ids'
import { useCFS } from '../use-cfs'

export function getSectionById(
  state: ReturnType<typeof useCFS.getState>,
  id: CFSSectionId,
): CFSSection | null {
  const { activeLibraryId, memberLibraries } = state
  if (!activeLibraryId) return null
  const lib = memberLibraries[activeLibraryId]
  if (!lib) return null
  return lib.sections.find((s) => s.id === id) ?? null
}

export function useSectionById(id: CFSSectionId | null): CFSSection | null {
  return useCFS((s) => {
    if (!id || !s.activeLibraryId) return null
    const lib = s.memberLibraries[s.activeLibraryId]
    if (!lib) return null
    return lib.sections.find((sec) => sec.id === id) ?? null
  })
}
