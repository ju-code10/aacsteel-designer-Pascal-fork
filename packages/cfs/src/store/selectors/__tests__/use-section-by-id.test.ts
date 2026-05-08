import { beforeEach, describe, expect, it } from 'bun:test'
import { ssmaLibraryJson } from '../../../library/load-ssma'
import { useCFS } from '../../use-cfs'
import { getActiveLibrary } from '../use-active-library'
import { getSectionById } from '../use-section-by-id'

function reset(): void {
  useCFS.setState({
    isCFSMode: false,
    inspectorTab: 'wall',
    hoveredMemberId: null,
    selectedPanelId: null,
    memberLibraries: {},
    activeLibraryId: null,
    unitsDisplay: 'imperial',
    preferredHeaderType: 'box',
    isLibraryLoading: false,
    libraryLoadError: null,
  })
}

describe('library selectors', () => {
  beforeEach(reset)

  it('getActiveLibrary returns null before hydrate, the library after', async () => {
    expect(getActiveLibrary(useCFS.getState())).toBeNull()
    await useCFS.getState().loadLibrary(ssmaLibraryJson)
    const lib = getActiveLibrary(useCFS.getState())
    expect(lib?.name).toBe('SSMA')
  })

  it('getSectionById resolves the canonical 362S162-54 stud', async () => {
    await useCFS.getState().loadLibrary(ssmaLibraryJson)
    const lib = getActiveLibrary(useCFS.getState())!
    const stud = lib.sections.find((s) => s.designation === '362S162-54')!
    const found = getSectionById(useCFS.getState(), stud.id)
    expect(found?.id).toBe(stud.id)
  })

  it('getSectionById returns null for unknown ids', async () => {
    await useCFS.getState().loadLibrary(ssmaLibraryJson)
    const found = getSectionById(
      useCFS.getState(),
      'ffffffff-ffff-4fff-afff-ffffffffffff' as never,
    )
    expect(found).toBeNull()
  })
})
