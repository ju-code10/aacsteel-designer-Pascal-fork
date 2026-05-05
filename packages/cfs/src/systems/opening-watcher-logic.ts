'use client'

import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import { useCFS } from '../store/use-cfs'
import type { CFSOpening } from '../schema/cfs-opening'

interface PropagateResult {
  openingsConsidered: number
  framingsDirtied: string[]
}

/**
 * For every dirty `cfs_opening` node, mark its parent `cfs_wall_framing` dirty
 * so the framing pass re-lays out the wall. Idempotent. Returns a per-tick
 * summary so tests can assert on the propagation.
 *
 * Mirrors the wall-watcher contract (§5.1 dirty-trigger): an opening that
 * changes implies its host framing must re-run.
 */
export function propagateDirtyOpenings(): PropagateResult {
  const result: PropagateResult = { openingsConsidered: 0, framingsDirtied: [] }
  if (!useCFS.getState().isCFSMode) return result

  const scene = useScene.getState()
  const sceneNodes = scene.nodes as unknown as Record<string, AnyNode | undefined>
  const dirtyOpeningIds: string[] = []
  for (const id of scene.dirtyNodes) {
    const node = sceneNodes[id as unknown as string]
    if (!node) continue
    if ((node as { type?: string }).type === 'cfs_opening') {
      dirtyOpeningIds.push((node as { id: string }).id)
    }
  }
  result.openingsConsidered = dirtyOpeningIds.length
  if (dirtyOpeningIds.length === 0) return result

  const framingIdsToDirty = new Set<string>()
  for (const oid of dirtyOpeningIds) {
    const opening = sceneNodes[oid] as unknown as CFSOpening | undefined
    if (!opening) continue
    framingIdsToDirty.add(opening.parentId as unknown as string)
  }

  // markDirty is idempotent. We do not wrap in withBatchedUndo because
  // dirty-marking is not a node mutation and never enters Zundo history.
  const live = useScene.getState()
  for (const fid of framingIdsToDirty) {
    live.markDirty(fid as unknown as AnyNodeId)
    result.framingsDirtied.push(fid)
  }
  return result
}

/**
 * When a `cfs_opening` is deleted by the user, it leaves the scene before
 * `propagateDirtyOpenings` can read it. The deletion already calls
 * `set(nodes)` which triggers the scene subscriber; we reach this function
 * with the opening already gone. Solution: when the watcher sees that an id
 * has dropped out of `nodes` between this tick and the previous, and that id
 * was an opening, dirty its previously-known framing.
 *
 * This relies on Zustand passing both `state` and `prev` to the subscriber.
 */
export function propagateDeletedOpenings(
  current: Record<string, AnyNode>,
  previous: Record<string, AnyNode>,
): PropagateResult {
  const result: PropagateResult = { openingsConsidered: 0, framingsDirtied: [] }
  if (!useCFS.getState().isCFSMode) return result

  const removedFramingIds = new Set<string>()
  for (const id of Object.keys(previous)) {
    if (current[id]) continue
    const wasOpening = previous[id] as unknown as CFSOpening | undefined
    if (!wasOpening || (wasOpening as { type?: string }).type !== 'cfs_opening') continue
    result.openingsConsidered += 1
    // The framing may also have been deleted (cascading). Only dirty it if
    // it still exists in the current scene.
    const framingId = wasOpening.parentId as unknown as string
    if (current[framingId]) removedFramingIds.add(framingId)
  }

  if (removedFramingIds.size === 0) return result
  const live = useScene.getState()
  for (const fid of removedFramingIds) {
    live.markDirty(fid as unknown as AnyNodeId)
    result.framingsDirtied.push(fid)
  }
  return result
}
