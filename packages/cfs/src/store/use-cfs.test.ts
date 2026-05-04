import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { useScene } from '@pascal-app/core'
import { useCFS } from './use-cfs'
import { ssmaLibraryJson } from '../library/load-ssma'

function resetCFS(): void {
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

function resetScene(): void {
  useScene.setState({
    nodes: {},
    rootNodeIds: [],
    dirtyNodes: new Set(),
    collections: {},
  })
  useScene.temporal.getState().clear()
}

describe('useCFS — slice 1 invariants (preserved)', () => {
  beforeEach(() => {
    resetCFS()
    resetScene()
  })

  it('defaults to isCFSMode === false', () => {
    expect(useCFS.getState().isCFSMode).toBe(false)
  })

  it('flips back via setCFSMode(false)', () => {
    useCFS.getState().setCFSMode(true)
    useCFS.getState().setCFSMode(false)
    expect(useCFS.getState().isCFSMode).toBe(false)
  })

  it('exposes setCFSMode as a stable function reference across reads', () => {
    const a = useCFS.getState().setCFSMode
    const b = useCFS.getState().setCFSMode
    expect(a).toBe(b)
  })
})

describe('useCFS — UI/preference actions', () => {
  beforeEach(() => {
    resetCFS()
    resetScene()
  })

  it('setInspectorTab updates only inspectorTab', () => {
    useCFS.getState().setInspectorTab('panel')
    expect(useCFS.getState().inspectorTab).toBe('panel')
    expect(useCFS.getState().isCFSMode).toBe(false)
  })

  it('setHoveredMember and setSelectedPanel work', () => {
    useCFS.getState().setHoveredMember('mem-1')
    useCFS.getState().setSelectedPanel('pan-1')
    expect(useCFS.getState().hoveredMemberId).toBe('mem-1')
    expect(useCFS.getState().selectedPanelId).toBe('pan-1')
  })

  it('setUnitsDisplay and setPreferredHeaderType update state', () => {
    useCFS.getState().setUnitsDisplay('metric')
    useCFS.getState().setPreferredHeaderType('back-to-back')
    expect(useCFS.getState().unitsDisplay).toBe('metric')
    expect(useCFS.getState().preferredHeaderType).toBe('back-to-back')
  })
})

describe('useCFS — library hydration', () => {
  beforeEach(() => {
    resetCFS()
    resetScene()
  })

  it('loadLibrary registers a valid library and sets activeLibraryId', async () => {
    await useCFS.getState().loadLibrary(ssmaLibraryJson)
    const s = useCFS.getState()
    expect(s.isLibraryLoading).toBe(false)
    expect(s.libraryLoadError).toBeNull()
    expect(Object.keys(s.memberLibraries).length).toBe(1)
    expect(s.activeLibraryId).not.toBeNull()
  })

  it('loadLibrary on bad JSON sets libraryLoadError and leaves catalog empty', async () => {
    await useCFS.getState().loadLibrary({ name: 'bad' })
    const s = useCFS.getState()
    expect(s.isLibraryLoading).toBe(false)
    expect(s.libraryLoadError).not.toBeNull()
    expect(Object.keys(s.memberLibraries).length).toBe(0)
    expect(s.activeLibraryId).toBeNull()
  })

  it('loadLibrary twice does not duplicate but keeps the latest', async () => {
    await useCFS.getState().loadLibrary(ssmaLibraryJson)
    const firstActive = useCFS.getState().activeLibraryId
    await useCFS.getState().loadLibrary(ssmaLibraryJson)
    const s = useCFS.getState()
    expect(Object.keys(s.memberLibraries).length).toBe(1)
    expect(s.activeLibraryId).toBe(firstActive)
  })
})

describe('useCFS — setActiveLibrary cross-store dirty sweep', () => {
  beforeEach(() => {
    resetCFS()
    resetScene()
  })

  it('marks every cfs_wall_framing and cfs_member dirty when active library changes', async () => {
    await useCFS.getState().loadLibrary(ssmaLibraryJson)
    const initialActive = useCFS.getState().activeLibraryId
    expect(initialActive).not.toBeNull()

    // Seed scene with two CFS framings, two CFS members, and one Pascal wall.
    const framingA = '22222222-2222-4222-a222-22222222a001'
    const framingB = '22222222-2222-4222-a222-22222222a002'
    const memberA = '44444444-4444-4444-a444-44444444a001'
    const memberB = '44444444-4444-4444-a444-44444444a002'
    const wallId = 'wall_pascal_001'

    useScene.setState((s) => ({
      nodes: {
        ...s.nodes,
        [framingA]: { type: 'cfs_wall_framing', id: framingA, parentId: wallId } as never,
        [framingB]: { type: 'cfs_wall_framing', id: framingB, parentId: wallId } as never,
        [memberA]: { type: 'cfs_member', id: memberA, parentId: framingA } as never,
        [memberB]: { type: 'cfs_member', id: memberB, parentId: framingB } as never,
        [wallId]: { type: 'wall', id: wallId } as never,
      },
    }))
    useScene.getState().dirtyNodes.clear()

    // Register a second library so we have somewhere to switch to.
    const secondLibId = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
    useCFS.setState((s) => ({
      memberLibraries: {
        ...s.memberLibraries,
        [secondLibId]: { ...s.memberLibraries[initialActive as string]!, id: secondLibId } as never,
      },
    }))

    useCFS.getState().setActiveLibrary(secondLibId as never)

    const dirty = useScene.getState().dirtyNodes
    expect(dirty.has(framingA as never)).toBe(true)
    expect(dirty.has(framingB as never)).toBe(true)
    expect(dirty.has(memberA as never)).toBe(true)
    expect(dirty.has(memberB as never)).toBe(true)
    expect(dirty.has(wallId as never)).toBe(false)
  })

  it('switching to the same id is a no-op', async () => {
    await useCFS.getState().loadLibrary(ssmaLibraryJson)
    const id = useCFS.getState().activeLibraryId as string
    useScene.getState().dirtyNodes.clear()
    useCFS.getState().setActiveLibrary(id as never)
    expect(useScene.getState().dirtyNodes.size).toBe(0)
  })

  it('switching to an unregistered library sets libraryLoadError and does not change activeLibraryId', async () => {
    await useCFS.getState().loadLibrary(ssmaLibraryJson)
    const before = useCFS.getState().activeLibraryId
    useCFS.getState().setActiveLibrary('cccccccc-cccc-4ccc-accc-cccccccccccc' as never)
    expect(useCFS.getState().activeLibraryId).toBe(before)
    expect(useCFS.getState().libraryLoadError).toMatch(/not registered/)
  })
})

describe('useCFS — setCFSMode project lifecycle', () => {
  beforeEach(() => {
    resetCFS()
    resetScene()
  })

  afterEach(() => {
    resetScene()
  })

  it('first activation creates exactly one cfs_project node and one undo step', async () => {
    await useCFS.getState().loadLibrary(ssmaLibraryJson)
    // Seed Pascal site root so findSiteRootId returns a value.
    const siteId = 'site_test_root'
    useScene.setState((s) => ({
      nodes: {
        ...s.nodes,
        [siteId]: { type: 'site', id: siteId } as never,
      },
      rootNodeIds: [siteId as never],
    }))
    useScene.temporal.getState().clear()

    const before = useScene.temporal.getState().pastStates.length
    useCFS.getState().setCFSMode(true)
    const after = useScene.temporal.getState().pastStates.length

    const projects = Object.values(useScene.getState().nodes).filter(
      (n) => (n as { type?: string }).type === 'cfs_project',
    )
    expect(projects.length).toBe(1)
    expect(after - before).toBe(1)
  })

  it('toggling off then back on does not create a second project', async () => {
    await useCFS.getState().loadLibrary(ssmaLibraryJson)
    const siteId = 'site_test_root_2'
    useScene.setState((s) => ({
      nodes: {
        ...s.nodes,
        [siteId]: { type: 'site', id: siteId } as never,
      },
      rootNodeIds: [siteId as never],
    }))

    useCFS.getState().setCFSMode(true)
    useCFS.getState().setCFSMode(false)
    useCFS.getState().setCFSMode(true)

    const projects = Object.values(useScene.getState().nodes).filter(
      (n) => (n as { type?: string }).type === 'cfs_project',
    )
    expect(projects.length).toBe(1)
  })

  it('without a loaded library, setCFSMode(true) sets isCFSMode but does not create a project', () => {
    useCFS.getState().setCFSMode(true)
    expect(useCFS.getState().isCFSMode).toBe(true)
    const projects = Object.values(useScene.getState().nodes).filter(
      (n) => (n as { type?: string }).type === 'cfs_project',
    )
    expect(projects.length).toBe(0)
    expect(useCFS.getState().libraryLoadError).not.toBeNull()
  })
})
