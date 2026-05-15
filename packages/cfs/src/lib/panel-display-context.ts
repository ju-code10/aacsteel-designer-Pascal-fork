// Resolve the parent wall + cumulative level elevation a panel belongs to.
//
// Both shop-drawing exporters (PDF §6.4 and DXF §6.3) project member
// world coordinates back into panel-local coordinates before drawing.
// That projection needs:
//   - the parent wall (to project world (x, z) onto the wall's along-axis)
//   - the wall's level elevation in world y (to recover local y within the
//     panel's [0, panelHeight] range when the wall sits above level 0)
//
// The slab manager is wired in lazily so the exporters stay safely
// callable from unit tests with a synthetic SceneLike — when the
// production manager has no slab data it returns 0, matching the test
// fallback.

import { wallLevelElevation_mm } from './level-elevation'
import { makeSlabElevationFn } from './slab-elevation'
import type { CFSPanel } from '../schema/cfs-panel'
import type { CFSWallFraming } from '../schema/cfs-wall-framing'
import type { PascalWallLike } from './wall-frame'
import { wallOf, type SceneLike } from './scene-walk'

export interface PanelDisplayContext {
  wall: PascalWallLike
  levelElevation_mm: number
}

/**
 * Look up the wall the panel sits on, plus the level elevation the
 * framing pass baked into every member's world y. Returns null when the
 * panel's framing → wall chain can't be resolved (defensive — panels
 * always have a framing parent in v1).
 */
export function panelDisplayContext(
  scene: SceneLike,
  panel: CFSPanel,
): PanelDisplayContext | null {
  const framingId = panel.parentId as unknown as string
  const framing = scene.nodes[framingId] as CFSWallFraming | undefined
  if (!framing) return null
  const wallId = wallOf(scene, framingId)
  if (!wallId) return null
  const wall = scene.nodes[wallId] as PascalWallLike | undefined
  if (!wall || !Array.isArray(wall.start) || !Array.isArray(wall.end)) {
    return null
  }
  const slabFn = makeSlabElevationFn(scene)
  const levelBase_mm = wallLevelElevation_mm(scene, wallId, slabFn)
  const thisWallSlab_mm = Math.max(0, slabFn(wallId))
  return {
    wall,
    levelElevation_mm: levelBase_mm + thisWallSlab_mm,
  }
}
