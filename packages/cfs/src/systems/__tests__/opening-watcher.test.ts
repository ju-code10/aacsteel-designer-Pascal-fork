import { beforeEach, describe, expect, it } from 'bun:test'
import { useScene } from '@pascal-app/core'
import { useCFS } from '../../store/use-cfs'
import { ssmaLibraryJson } from '../../library/load-ssma'
import { CFSOpening } from '../../schema/cfs-opening'
import {
  propagateDeletedOpenings,
  propagateDirtyOpenings,
} from '../opening-watcher-logic'

const SITE_ID = 'site_test_root'
let nextUuid = 0
function uuid(): string {
  nextUuid += 1
  const seg = nextUuid.toString(16).padStart(12, '0')
  return `00000000-0000-4000-8a00-${seg}`
}

function resetAll(): void {
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
  useScene.setState({
    nodes: {},
    rootNodeIds: [],
    dirtyNodes: new Set(),
    collections: {},
  })
  useScene.temporal.getState().clear()
  nextUuid = 0
}

async function seed(): Promise<{ framingId: string; wallId: string }> {
  await useCFS.getState().loadLibrary(ssmaLibraryJson)
  useCFS.setState({ isCFSMode: true })
  const framingId = uuid()
  const wallId = `wall_${nextUuid}`
  useScene.setState((s) => ({
    nodes: {
      ...s.nodes,
      [SITE_ID]: { type: 'site', id: SITE_ID, parentId: null, children: [] } as never,
      [wallId]: {
        type: 'wall',
        id: wallId,
        parentId: SITE_ID,
        start: [0, 0],
        end: [3.6, 0],
        height: 2.7,
      } as never,
      [framingId]: {
        type: 'cfs_wall_framing',
        id: framingId,
        parentId: wallId,
        studSpacing_mm: 600,
        studSectionId: null,
        trackSectionId: null,
        defaultHeaderType: null,
        wallHeight_mm: null,
      } as never,
    },
    rootNodeIds: [SITE_ID as never],
  }))
  useScene.temporal.getState().clear()
  // Clear dirty markers seeded by the writes above.
  useScene.getState().dirtyNodes.clear()
  return { framingId, wallId }
}

function makeOpening(framingId: string, id: string) {
  return CFSOpening.parse({
    type: 'cfs_opening',
    id,
    parentId: framingId,
    openingType: 'door',
    positionAlongWall_mm: 600,
    roughDimensions: { width_mm: 900, height_mm: 2100 },
    headerTypeOverride: null,
    generatedMemberIds: [],
  })
}

describe('opening-watcher-logic — propagateDirtyOpenings', () => {
  beforeEach(() => resetAll())

  it('marks the parent framing dirty when an opening id is dirty', async () => {
    const { framingId } = await seed()
    const oid = uuid()
    const opening = makeOpening(framingId, oid)
    useScene.setState((s) => ({
      nodes: { ...s.nodes, [oid]: opening as unknown as never },
    }))
    useScene.getState().dirtyNodes.add(oid as never)
    useScene.getState().dirtyNodes.delete(framingId as never)

    const r = propagateDirtyOpenings()
    expect(r.framingsDirtied).toEqual([framingId])
    expect(useScene.getState().dirtyNodes.has(framingId as never)).toBe(true)
  })

  it('is a no-op when CFS mode is off', async () => {
    const { framingId } = await seed()
    useCFS.setState({ isCFSMode: false })
    const oid = uuid()
    useScene.setState((s) => ({
      nodes: {
        ...s.nodes,
        [oid]: makeOpening(framingId, oid) as unknown as never,
      },
    }))
    useScene.getState().dirtyNodes.add(oid as never)

    const r = propagateDirtyOpenings()
    expect(r.framingsDirtied).toEqual([])
  })

  it('coalesces multiple dirty openings on the same framing into a single dirty mark', async () => {
    const { framingId } = await seed()
    const o1 = uuid()
    const o2 = uuid()
    useScene.setState((s) => ({
      nodes: {
        ...s.nodes,
        [o1]: makeOpening(framingId, o1) as unknown as never,
        [o2]: makeOpening(framingId, o2) as unknown as never,
      },
    }))
    useScene.getState().dirtyNodes.add(o1 as never)
    useScene.getState().dirtyNodes.add(o2 as never)

    const r = propagateDirtyOpenings()
    expect(r.framingsDirtied.length).toBe(1)
    expect(r.framingsDirtied[0]).toBe(framingId)
    expect(r.openingsConsidered).toBe(2)
  })

  it('does nothing when no openings are dirty', async () => {
    await seed()
    const r = propagateDirtyOpenings()
    expect(r.openingsConsidered).toBe(0)
    expect(r.framingsDirtied).toEqual([])
  })
})

describe('opening-watcher-logic — propagateDeletedOpenings', () => {
  beforeEach(() => resetAll())

  it('dirties the framing when an opening was removed from the scene', async () => {
    const { framingId } = await seed()
    const oid = uuid()
    const opening = makeOpening(framingId, oid)
    const prev = {
      ...useScene.getState().nodes,
      [oid]: opening as unknown as never,
    }
    // Current does NOT contain the opening.
    const current = useScene.getState().nodes

    const r = propagateDeletedOpenings(
      current as unknown as Parameters<typeof propagateDeletedOpenings>[0],
      prev as unknown as Parameters<typeof propagateDeletedOpenings>[0],
    )
    expect(r.framingsDirtied).toEqual([framingId])
  })

  it('skips the dirty mark when the framing was deleted alongside the opening', async () => {
    const { framingId } = await seed()
    const oid = uuid()
    const opening = makeOpening(framingId, oid)
    const prev = {
      ...useScene.getState().nodes,
      [oid]: opening as unknown as never,
    }
    // Now remove both opening and framing.
    useScene.setState((s) => {
      const next = { ...s.nodes }
      delete (next as Record<string, unknown>)[framingId]
      return { nodes: next }
    })
    const current = useScene.getState().nodes

    const r = propagateDeletedOpenings(
      current as unknown as Parameters<typeof propagateDeletedOpenings>[0],
      prev as unknown as Parameters<typeof propagateDeletedOpenings>[0],
    )
    // Opening was considered but framing is gone, so no dirty mark.
    expect(r.openingsConsidered).toBe(1)
    expect(r.framingsDirtied).toEqual([])
  })
})
