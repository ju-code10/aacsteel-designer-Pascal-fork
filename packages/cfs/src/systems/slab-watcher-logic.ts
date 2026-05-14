'use client'

// Re-runs the CFS framing pass when Pascal slabs are created, updated, or
// deleted. Closes two gaps in Pascal's built-in dirty propagation:
//
//   1. `spatial-grid-sync.ts` only marks walls dirty when they geometrically
//      overlap the slab polygon. Walls that sit on the slab boundary (typical
//      for an auto-generated slab traced from a closed wall loop) can miss
//      the overlap check and stay clean — so the CFS framing pass never re-
//      runs and studs stay at the pre-slab elevation while Pascal renders
//      the slab above them. Symptom: slab visibly pierces stud bottoms.
//
//   2. A slab on level N changes the cumulative stacked height of every
//      level N+1, N+2, … Pascal's overlap check only dirties walls on the
//      slab's own level, so upper-level framings keep their stale
//      level-base offset. Symptom: studs on level 2 sit below the wall
//      mesh after a level-0 slab is added/edited.
//
// This watcher works directly off slab node mutations and dirties every
// `cfs_wall_framing` whose wall sits on the slab's level or any higher
// level. The framing-pass subscriber, which fires on the same scene
// notification but mounted later, then picks them up and recomputes.

import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import { useCFS } from '../store/use-cfs'
import { ancestorOfType, type SceneLike } from '../lib/scene-walk'
import type { CFSWallFraming } from '../schema/cfs-wall-framing'

export interface SlabChangeResult {
  slabsChanged: number
  framingsDirtied: string[]
}

interface SlabSnapshot {
  parentId: string | null | undefined
  polygon: unknown
  elevation: number | undefined
  holes: unknown
}

interface MaybeSlab {
  type?: string
  parentId?: string | null
  polygon?: unknown
  elevation?: number
  holes?: unknown
}

function isSlab(n: unknown): n is MaybeSlab & { type: 'slab' } {
  return typeof n === 'object' && n !== null && (n as { type?: string }).type === 'slab'
}

function snapshot(node: MaybeSlab): SlabSnapshot {
  return {
    parentId: node.parentId,
    polygon: node.polygon,
    elevation: node.elevation,
    holes: node.holes,
  }
}

function equalSnapshots(a: SlabSnapshot, b: SlabSnapshot): boolean {
  return (
    a.parentId === b.parentId &&
    a.polygon === b.polygon &&
    a.elevation === b.elevation &&
    a.holes === b.holes
  )
}

/**
 * Returns the set of slab ids that changed between two scene snapshots.
 * A change = created, deleted, or differing parentId / polygon / elevation
 * / holes by reference. Reference equality is enough because Pascal's
 * scene store rebuilds the field on every mutation.
 */
export function detectSlabChanges(
  current: Record<string, AnyNode>,
  previous: Record<string, AnyNode>,
): Set<string> {
  const changed = new Set<string>()
  for (const [id, node] of Object.entries(current)) {
    if (!isSlab(node)) continue
    const prev = previous[id as AnyNodeId]
    if (!prev || !isSlab(prev)) {
      changed.add(id)
      continue
    }
    if (!equalSnapshots(snapshot(node), snapshot(prev as MaybeSlab))) {
      changed.add(id)
    }
  }
  for (const [id, node] of Object.entries(previous)) {
    if (!isSlab(node)) continue
    if (!current[id as AnyNodeId]) changed.add(id)
  }
  return changed
}

function levelIdOfSlab(
  current: Record<string, AnyNode>,
  previous: Record<string, AnyNode>,
  slabId: string,
): string | null {
  // The slab may have been deleted from `current`; resolve via whichever
  // snapshot still contains it.
  const scene: SceneLike = current[slabId as AnyNodeId]
    ? { nodes: current as unknown as Record<string, unknown> }
    : { nodes: previous as unknown as Record<string, unknown> }
  return ancestorOfType(scene, slabId, 'level')
}

function levelIndex(
  nodes: Record<string, AnyNode>,
  levelId: string,
): number | null {
  const node = nodes[levelId as AnyNodeId] as { level?: number } | undefined
  if (!node) return null
  return node.level ?? 0
}

/**
 * Collect every level id at or above the given level under the same
 * building. Caller passes the lower-bound level; we walk that level's
 * parent building and pick siblings with `level >= bound.level`.
 */
function levelsAtOrAbove(
  nodes: Record<string, AnyNode>,
  boundLevelId: string,
): Set<string> {
  const out = new Set<string>([boundLevelId])
  const bound = nodes[boundLevelId as AnyNodeId] as
    | { parentId?: string | null; level?: number }
    | undefined
  if (!bound) return out
  const boundIdx = bound.level ?? 0
  const buildingId = bound.parentId
  if (!buildingId) return out
  const building = nodes[buildingId as AnyNodeId] as
    | { children?: string[] }
    | undefined
  if (!building?.children) return out
  for (const childId of building.children) {
    const sib = nodes[childId as AnyNodeId] as
      | { type?: string; level?: number }
      | undefined
    if (sib?.type !== 'level') continue
    if ((sib.level ?? 0) >= boundIdx) out.add(childId)
  }
  return out
}

/**
 * For each changed slab, mark every `cfs_wall_framing` whose wall sits on
 * the slab's level or any level above as dirty. `markDirty` mutates the
 * scene store's dirty set in place without triggering subscribers — but
 * the calling subscriber runs synchronously alongside the framing-system's
 * subscriber on the same `set()` notification, so the later subscriber
 * sees our dirty marks.
 */
export function processSlabChanges(
  current: Record<string, AnyNode>,
  previous: Record<string, AnyNode>,
): SlabChangeResult {
  const result: SlabChangeResult = { slabsChanged: 0, framingsDirtied: [] }
  if (!useCFS.getState().isCFSMode) return result

  const changedSlabIds = detectSlabChanges(current, previous)
  result.slabsChanged = changedSlabIds.size
  if (changedSlabIds.size === 0) return result

  const affectedLevelIds = new Set<string>()
  for (const slabId of changedSlabIds) {
    const levelId = levelIdOfSlab(current, previous, slabId)
    if (!levelId) continue
    // Use the current scene for the lookup so siblings reflect the latest
    // building layout; if the level itself was deleted, fall back to the
    // previous scene.
    const haveLevel = (current[levelId as AnyNodeId] !== undefined)
    const nodes = haveLevel ? current : previous
    if (!haveLevel && !previous[levelId as AnyNodeId]) continue
    const idx = levelIndex(nodes, levelId)
    if (idx === null) {
      affectedLevelIds.add(levelId)
      continue
    }
    for (const id of levelsAtOrAbove(nodes, levelId)) {
      affectedLevelIds.add(id)
    }
  }
  if (affectedLevelIds.size === 0) return result

  const sceneLike: SceneLike = {
    nodes: current as unknown as Record<string, unknown>,
  }
  const framingsToDirty: string[] = []
  for (const n of Object.values(current)) {
    if ((n as { type?: string }).type !== 'cfs_wall_framing') continue
    const framing = n as unknown as CFSWallFraming
    const wallLevelId = ancestorOfType(sceneLike, framing.parentId, 'level')
    if (wallLevelId && affectedLevelIds.has(wallLevelId)) {
      framingsToDirty.push(framing.id as unknown as string)
    }
  }
  if (framingsToDirty.length === 0) return result

  const live = useScene.getState()
  for (const fid of framingsToDirty) {
    live.markDirty(fid as unknown as AnyNodeId)
    result.framingsDirtied.push(fid)
  }
  return result
}
