'use client'

import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import { useCFS } from '../store/use-cfs'
import { withBatchedUndo } from '../store/with-batched-undo'
import { CFSWallFraming } from '../schema/cfs-wall-framing'
import type { CFSWallFramingId } from '../schema/ids'

function generateUuid(): string {
  const c: { randomUUID?: () => string } = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto ?? {}
  if (typeof c.randomUUID === 'function') return c.randomUUID()
  const hex = (n: number) => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, '0')
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`
}

function findFramingForWall(
  nodes: Record<string, AnyNode>,
  wallId: string,
): CFSWallFraming | undefined {
  for (const n of Object.values(nodes)) {
    const t = (n as { type?: string }).type
    if (t !== 'cfs_wall_framing') continue
    if ((n as { parentId?: string }).parentId === wallId) {
      return n as unknown as CFSWallFraming
    }
  }
  return undefined
}

interface SweepResult {
  wallsConsidered: number
  framingsCreated: string[]
  wallsRedirtied: string[]
}

/**
 * For every Pascal `wall` node in the scene, ensure a `cfs_wall_framing` child
 * exists when CFS mode is on. Idempotent. Returns a summary of the changes.
 *
 * Trigger pattern §5.1 dirty-trigger table row 1: "Pascal Wall becomes dirty
 * → if no framing child exists, create one." We additionally backfill for
 * walls that exist *before* CFS mode is toggled on (per §7.1's first-toggle
 * behavior) by sweeping every wall in the scene.
 */
export function sweepWallsForFraming(): SweepResult {
  const result: SweepResult = {
    wallsConsidered: 0,
    framingsCreated: [],
    wallsRedirtied: [],
  }
  if (!useCFS.getState().isCFSMode) return result

  const scene = useScene.getState()
  const wallIds: string[] = []
  for (const n of Object.values(scene.nodes)) {
    if ((n as { type?: string }).type === 'wall') wallIds.push((n as { id: string }).id)
  }
  result.wallsConsidered = wallIds.length

  const toCreate: { framing: CFSWallFraming; wallId: string }[] = []
  const toDirty: string[] = []
  for (const wallId of wallIds) {
    const existing = findFramingForWall(scene.nodes, wallId)
    if (existing) {
      // Re-dirty so the framing pass picks up wall changes.
      if (scene.dirtyNodes.has(wallId as unknown as AnyNodeId)) {
        toDirty.push(existing.id as unknown as string)
      }
      continue
    }
    const framing = CFSWallFraming.parse({
      type: 'cfs_wall_framing',
      id: generateUuid(),
      parentId: wallId,
    })
    toCreate.push({ framing, wallId })
  }

  if (toCreate.length === 0 && toDirty.length === 0) return result

  withBatchedUndo('cfs:wall-watcher-sweep', () => {
    const live = useScene.getState()
    for (const { framing, wallId } of toCreate) {
      live.createNode(framing as unknown as AnyNode, wallId as unknown as AnyNodeId)
      result.framingsCreated.push(framing.id as unknown as string)
    }
    for (const id of toDirty) {
      live.markDirty(id as unknown as AnyNodeId)
      result.wallsRedirtied.push(id)
    }
  })

  return result
}

/**
 * Process the dirty set: any dirty `wall` node spawns or re-dirties its
 * framing. Cheaper than the full sweep — used as the per-mutation reactor.
 */
export function processDirtyWalls(): SweepResult {
  const result: SweepResult = {
    wallsConsidered: 0,
    framingsCreated: [],
    wallsRedirtied: [],
  }
  if (!useCFS.getState().isCFSMode) return result

  const scene = useScene.getState()
  const dirtyWallIds: string[] = []
  for (const id of scene.dirtyNodes) {
    const node = scene.nodes[id]
    if (!node) continue
    if ((node as { type?: string }).type === 'wall') dirtyWallIds.push(node.id as unknown as string)
  }
  result.wallsConsidered = dirtyWallIds.length
  if (dirtyWallIds.length === 0) return result

  const toCreate: { framing: CFSWallFraming; wallId: string }[] = []
  const toDirty: CFSWallFramingId[] = []
  for (const wallId of dirtyWallIds) {
    const existing = findFramingForWall(scene.nodes, wallId)
    if (existing) {
      toDirty.push(existing.id as unknown as CFSWallFramingId)
    } else {
      const framing = CFSWallFraming.parse({
        type: 'cfs_wall_framing',
        id: generateUuid(),
        parentId: wallId,
      })
      toCreate.push({ framing, wallId })
    }
  }

  withBatchedUndo('cfs:wall-watcher-dirty', () => {
    const live = useScene.getState()
    for (const { framing, wallId } of toCreate) {
      live.createNode(framing as unknown as AnyNode, wallId as unknown as AnyNodeId)
      result.framingsCreated.push(framing.id as unknown as string)
    }
    for (const id of toDirty) {
      live.markDirty(id as unknown as AnyNodeId)
      result.wallsRedirtied.push(id as unknown as string)
    }
  })

  return result
}
