import { beforeEach, describe, expect, it } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import { useCFS } from '../../store/use-cfs'
import {
  detectSlabChanges,
  processSlabChanges,
} from '../slab-watcher-logic'

function resetStores(): void {
  useCFS.setState({
    isCFSMode: true,
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
  useScene.setState({
    nodes: {},
    rootNodeIds: [],
    dirtyNodes: new Set(),
    collections: {},
  })
}

/**
 * Hand-built scene avoids the `useScene.createNode` path so we can control
 * exactly which nodes the watcher sees as "previous" vs "current" without
 * tripping Pascal's auto-dirty logic. Node objects (including their polygon
 * and holes arrays) are shared across scene snapshots so reference-equality
 * on unchanged fields matches Pascal's real-world store behaviour, where
 * untouched nodes keep their identity.
 */
const SHARED_POLY: ReadonlyArray<readonly [number, number]> = [
  [0, -0.1],
  [3.6, -0.1],
  [3.6, 0.1],
  [0, 0.1],
] as const
const SHARED_EMPTY_HOLES: ReadonlyArray<unknown> = []
const SHARED_NODES = {
  bldg: { id: 'bldg', type: 'building', parentId: null, children: ['lv0', 'lv1'] },
  lv0_with_slab: {
    id: 'lv0',
    type: 'level',
    parentId: 'bldg',
    level: 0,
    children: ['w0', 'fr0', 'slab0'],
  },
  lv1_no_slab: {
    id: 'lv1',
    type: 'level',
    parentId: 'bldg',
    level: 1,
    children: ['w1', 'fr1'],
  },
  lv1_with_slab: {
    id: 'lv1',
    type: 'level',
    parentId: 'bldg',
    level: 1,
    children: ['w1', 'fr1', 'slab1'],
  },
  w0: {
    id: 'w0',
    type: 'wall',
    parentId: 'lv0',
    start: [0, 0],
    end: [3.6, 0],
    height: 2.7,
    children: ['fr0'],
  },
  fr0: {
    id: 'fr0',
    type: 'cfs_wall_framing',
    parentId: 'w0',
    studSpacing_mm: null,
    wallHeight_mm: null,
    studSectionId: null,
    trackSectionId: null,
    defaultHeaderType: null,
    cachedTotalWeight_kg: null,
    cachedMemberCount: null,
    children: [],
  },
  w1: {
    id: 'w1',
    type: 'wall',
    parentId: 'lv1',
    start: [0, 0],
    end: [3.6, 0],
    height: 2.7,
    children: ['fr1'],
  },
  fr1: {
    id: 'fr1',
    type: 'cfs_wall_framing',
    parentId: 'w1',
    studSpacing_mm: null,
    wallHeight_mm: null,
    studSectionId: null,
    trackSectionId: null,
    defaultHeaderType: null,
    cachedTotalWeight_kg: null,
    cachedMemberCount: null,
    children: [],
  },
  slab0: {
    id: 'slab0',
    type: 'slab',
    parentId: 'lv0',
    polygon: SHARED_POLY,
    elevation: 0.05,
    holes: SHARED_EMPTY_HOLES,
  },
  slab1: {
    id: 'slab1',
    type: 'slab',
    parentId: 'lv1',
    polygon: SHARED_POLY,
    elevation: 0.05,
    holes: SHARED_EMPTY_HOLES,
  },
} as const

function twoLevelBuilding(opts: { slabOnLv1?: boolean } = {}): Record<string, AnyNode> {
  const nodes: Record<string, unknown> = {
    bldg: SHARED_NODES.bldg,
    lv0: SHARED_NODES.lv0_with_slab,
    lv1: opts.slabOnLv1 ? SHARED_NODES.lv1_with_slab : SHARED_NODES.lv1_no_slab,
    w0: SHARED_NODES.w0,
    fr0: SHARED_NODES.fr0,
    w1: SHARED_NODES.w1,
    fr1: SHARED_NODES.fr1,
    slab0: SHARED_NODES.slab0,
  }
  if (opts.slabOnLv1) nodes.slab1 = SHARED_NODES.slab1
  return nodes as Record<string, AnyNode>
}

beforeEach(() => {
  resetStores()
})

describe('detectSlabChanges', () => {
  it('finds a newly added slab', () => {
    const prev = twoLevelBuilding()
    const cur = twoLevelBuilding({ slabOnLv1: true })
    expect([...detectSlabChanges(cur, prev)]).toEqual(['slab1'])
  })

  it('finds a removed slab', () => {
    const prev = twoLevelBuilding({ slabOnLv1: true })
    const cur = twoLevelBuilding()
    expect([...detectSlabChanges(cur, prev)]).toEqual(['slab1'])
  })

  it('finds a slab whose elevation changed', () => {
    const prev = twoLevelBuilding({ slabOnLv1: true })
    const cur = twoLevelBuilding({ slabOnLv1: true })
    cur.slab1 = { ...(cur.slab1 as object), elevation: 0.15 } as never
    expect([...detectSlabChanges(cur, prev)]).toEqual(['slab1'])
    expect((prev.slab1 as unknown as { elevation: number }).elevation).toBe(0.05)
  })

  it('finds a slab whose polygon reference changed', () => {
    const prev = twoLevelBuilding({ slabOnLv1: true })
    const cur = twoLevelBuilding({ slabOnLv1: true })
    cur.slab1 = {
      ...(cur.slab1 as object),
      polygon: [[0, -0.2], [3.6, -0.2], [3.6, 0.2], [0, 0.2]],
    } as never
    expect([...detectSlabChanges(cur, prev)]).toEqual(['slab1'])
  })

  it('returns empty when no slabs changed', () => {
    const prev = twoLevelBuilding({ slabOnLv1: true })
    const cur = twoLevelBuilding({ slabOnLv1: true })
    expect([...detectSlabChanges(cur, prev)]).toEqual([])
  })
})

describe('processSlabChanges', () => {
  it('dirties framings on the slab\'s level and every level above', () => {
    const prev = twoLevelBuilding()
    const cur = twoLevelBuilding({ slabOnLv1: true })
    useScene.setState({ nodes: cur, dirtyNodes: new Set() } as never)

    const result = processSlabChanges(cur, prev)
    expect(result.slabsChanged).toBe(1)
    // Slab on level-1 → only framings on level-1 affected; no levels above.
    expect(result.framingsDirtied.sort()).toEqual(['fr1'])
    expect(useScene.getState().dirtyNodes.has('fr1' as never)).toBe(true)
    expect(useScene.getState().dirtyNodes.has('fr0' as never)).toBe(false)
  })

  it('dirties upper-level framings when a lower-level slab changes', () => {
    const start = twoLevelBuilding()
    // slab0 elevation goes from 0.05 to 0.30. lv0's stacked height changes,
    // so lv1's framing has to recompute too.
    const after = twoLevelBuilding()
    after.slab0 = { ...(after.slab0 as object), elevation: 0.30 } as never
    useScene.setState({ nodes: after, dirtyNodes: new Set() } as never)

    const result = processSlabChanges(after, start)
    expect(result.slabsChanged).toBe(1)
    expect(result.framingsDirtied.sort()).toEqual(['fr0', 'fr1'])
  })

  it('is a no-op when CFS mode is off', () => {
    useCFS.setState({ isCFSMode: false } as never)
    const prev = twoLevelBuilding()
    const cur = twoLevelBuilding({ slabOnLv1: true })
    useScene.setState({ nodes: cur, dirtyNodes: new Set() } as never)
    const result = processSlabChanges(cur, prev)
    expect(result.slabsChanged).toBe(0)
    expect(result.framingsDirtied).toEqual([])
    expect(useScene.getState().dirtyNodes.size).toBe(0)
  })

  it('is a no-op when no slabs changed', () => {
    const prev = twoLevelBuilding({ slabOnLv1: true })
    const cur = twoLevelBuilding({ slabOnLv1: true })
    useScene.setState({ nodes: cur, dirtyNodes: new Set() } as never)
    const result = processSlabChanges(cur, prev)
    expect(result.slabsChanged).toBe(0)
    expect(result.framingsDirtied).toEqual([])
  })

  it('handles slab deletion by dirtying the same framings', () => {
    const prev = twoLevelBuilding({ slabOnLv1: true })
    const cur = twoLevelBuilding()
    useScene.setState({ nodes: cur, dirtyNodes: new Set() } as never)
    const result = processSlabChanges(cur, prev)
    expect(result.slabsChanged).toBe(1)
    expect(result.framingsDirtied.sort()).toEqual(['fr1'])
  })
})
