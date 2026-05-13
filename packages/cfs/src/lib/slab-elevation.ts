// Per-wall slab-top elevation, in millimetres.
//
// Pascal's wall-system positions each wall mesh at
// `mesh.position.y = slabElevation` (see
// `packages/core/src/systems/wall/wall-system.tsx` and
// `spatialGridManager.getSlabElevationForWall`). When a slab sits under a
// wall, Pascal shifts the wall *up* by the slab thickness so the wall
// rests on top of the slab; framing studs must follow that shift or
// they pierce the slab from below.
//
// This module is the bridge between Pascal's runtime spatial-grid
// manager (meters) and the CFS framing math (millimetres). It is
// deliberately separated from `level-elevation.ts` so that unit tests
// of the level-stacking math can stay headless — they inject a stub
// `SlabElevationForWallFn` instead of pulling in `@pascal-app/core`.
//
// At runtime, `framing-pass.ts` uses `slabElevationFromManager` so the
// framing matches Pascal's wall placement exactly.

import { spatialGridManager } from '@pascal-app/core'
import { levelOf, type SceneLike } from './scene-walk'

const M_TO_MM = 1000

/** Function that returns a wall's slab-top elevation in mm. */
export type SlabElevationForWallFn = (wallId: string) => number

/**
 * Bind the production slab source to a specific scene. Returns a
 * `SlabElevationForWallFn` (1-arg, takes a wallId) suitable for
 * `wallLevelElevation_mm` / `levelHeight_mm` / `levelElevation_mm`,
 * which close over the scene once and then call by id repeatedly.
 */
export function makeSlabElevationFn(scene: SceneLike): SlabElevationForWallFn {
  return (wallId) => slabElevationFromManager(scene, wallId)
}

/**
 * Production source of slab elevations: read from Pascal's
 * `spatialGridManager` for the given scene and convert m → mm.
 * Returns 0 when the wall is missing geometry or no slab overlaps it.
 *
 * Pascal's `getSlabElevationForWall` returns 0 when no slab is found.
 * We propagate the same default so a slab-less scene behaves exactly
 * as it did before this module was introduced.
 */
export function slabElevationFromManager(
  scene: SceneLike,
  wallId: string,
): number {
  const wall = scene.nodes[wallId] as
    | { start?: readonly [number, number]; end?: readonly [number, number] }
    | undefined
  if (!wall || !wall.start || !wall.end) return 0
  const levelId = levelOf(scene, wallId)
  if (!levelId) return 0
  try {
    const elevation_m = spatialGridManager.getSlabElevationForWall(
      levelId,
      wall.start as [number, number],
      wall.end as [number, number],
    )
    return elevation_m * M_TO_MM
  } catch {
    // Manager not initialised (e.g., during early hydration). Treat as no slab.
    return 0
  }
}
