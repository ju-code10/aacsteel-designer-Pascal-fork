import { beforeEach, describe, expect, it } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import { ssmaLibraryJson } from '../../library/load-ssma'
import { useCFS } from '../../store/use-cfs'
import { processDirtyWalls, sweepWallsForFraming } from '../wall-watcher-logic'

const SITE_ID = 'site_test_root'

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
}

function seedSite(): void {
  useScene.setState((s) => ({
    nodes: {
      ...s.nodes,
      [SITE_ID]: { type: 'site', id: SITE_ID, parentId: null, children: [] } as never,
    },
    rootNodeIds: [SITE_ID as never],
  }))
}

function seedWall(id: string, opts: { length_m?: number } = {}): void {
  useScene.setState((s) => ({
    nodes: {
      ...s.nodes,
      [id]: {
        type: 'wall',
        id,
        parentId: SITE_ID,
        children: [],
        start: [0, 0],
        end: [opts.length_m ?? 3.6, 0],
        height: 2.7,
      } as never,
    },
  }))
}

function framingsForWall(wallId: string): AnyNode[] {
  const out: AnyNode[] = []
  for (const n of Object.values(useScene.getState().nodes)) {
    if (
      (n as { type?: string }).type === 'cfs_wall_framing' &&
      (n as { parentId?: string }).parentId === wallId
    ) {
      out.push(n)
    }
  }
  return out
}

describe('wall-watcher', () => {
  beforeEach(() => resetAll())

  it('sweepWallsForFraming: no-op when CFS mode is off', () => {
    seedSite()
    seedWall('wall_a')
    const result = sweepWallsForFraming()
    expect(result.framingsCreated).toHaveLength(0)
    expect(framingsForWall('wall_a')).toHaveLength(0)
  })

  it('sweepWallsForFraming: creates a framing per existing wall when CFS mode is on', () => {
    seedSite()
    seedWall('wall_a')
    seedWall('wall_b')
    useCFS.setState({ isCFSMode: true })
    const result = sweepWallsForFraming()
    expect(result.framingsCreated).toHaveLength(2)
    expect(framingsForWall('wall_a')).toHaveLength(1)
    expect(framingsForWall('wall_b')).toHaveLength(1)
  })

  it('sweepWallsForFraming: idempotent — does not duplicate existing framings', () => {
    seedSite()
    seedWall('wall_a')
    useCFS.setState({ isCFSMode: true })
    sweepWallsForFraming()
    const before = framingsForWall('wall_a').length
    const second = sweepWallsForFraming()
    expect(second.framingsCreated).toHaveLength(0)
    expect(framingsForWall('wall_a').length).toBe(before)
  })

  it('processDirtyWalls: only processes dirty walls', async () => {
    await useCFS.getState().loadLibrary(ssmaLibraryJson)
    useCFS.setState({ isCFSMode: true })
    seedSite()
    seedWall('wall_a')
    seedWall('wall_b')
    // Only wall_a is dirty.
    useScene.getState().dirtyNodes.clear()
    useScene.getState().dirtyNodes.add('wall_a' as never)
    const result = processDirtyWalls()
    expect(result.wallsConsidered).toBe(1)
    expect(result.framingsCreated).toHaveLength(1)
    expect(framingsForWall('wall_a')).toHaveLength(1)
    expect(framingsForWall('wall_b')).toHaveLength(0)
  })

  it('processDirtyWalls: existing framing on a dirty wall gets re-dirtied (cascade trigger)', () => {
    seedSite()
    seedWall('wall_a')
    useCFS.setState({ isCFSMode: true })
    sweepWallsForFraming()
    const framingId = framingsForWall('wall_a')[0]!.id
    useScene.getState().dirtyNodes.clear()
    useScene.getState().dirtyNodes.add('wall_a' as never)
    const result = processDirtyWalls()
    expect(result.wallsRedirtied).toContain(framingId as unknown as string)
    expect(useScene.getState().dirtyNodes.has(framingId as never)).toBe(true)
  })
})
