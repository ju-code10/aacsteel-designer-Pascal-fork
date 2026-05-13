import type { CFSPoint3D } from '../schema/primitives'

/**
 * Pascal's WallNode shape we depend on. We type it locally instead of importing
 * from `@pascal-app/core` to keep the library headless and unit-testable.
 *
 * Pascal stores `start` / `end` as `[x_m, y_m]` in level coordinates (meters)
 * and `height` in meters as well. The wall's local frame:
 *   - x along (end - start), 0 at start
 *   - y vertical, 0 at the wall base
 *   - z perpendicular to the wall (unused by framing math; geometry uses it in §5.3)
 */
export interface PascalWallLike {
  id: string
  start: readonly [number, number]
  end: readonly [number, number]
  height?: number
}

const M_TO_MM = 1000

/**
 * Pascal's default wall height when `wall.height` is undefined. Mirrors
 * `DEFAULT_WALL_HEIGHT = 2.5` in
 * `packages/core/src/systems/wall/wall-footprint.ts`. We hard-mirror the
 * constant here instead of importing from `@pascal-app/core` so this
 * library stays headless and unit-testable; changes to the upstream
 * constant should be reflected here.
 */
const PASCAL_DEFAULT_WALL_HEIGHT_MM = 2500

export function wallLengthFromPascalWall(wall: PascalWallLike): number {
  const dx = wall.end[0] - wall.start[0]
  const dy = wall.end[1] - wall.start[1]
  return Math.hypot(dx, dy) * M_TO_MM
}

/**
 * Returns the wall's height in mm, falling back to Pascal's default
 * when `wall.height` is undefined. Pascal's wall-system renders the
 * wall at that default too (`wall-system.tsx:426`), so CFS framing
 * stays flush with the Pascal wall mesh and members don't poke into
 * the slab of the level above.
 */
export function wallHeightFromPascalWall(wall: PascalWallLike): number {
  return typeof wall.height === 'number'
    ? wall.height * M_TO_MM
    : PASCAL_DEFAULT_WALL_HEIGHT_MM
}

export interface WallLocalPoint {
  x_mm: number
  y_mm: number
  z_mm: number
}

/**
 * Transform a wall-local point into Pascal world coordinates (mm). The wall's
 * local x-axis runs from `start` to `end`; z is perpendicular in the level
 * plane (right-hand rule about +y); y is vertical.
 *
 * Pascal level coords are 2D (x, z in three-space convention), with y always
 * vertical. We emit a CFSPoint3D in millimetres, in the same level basis the
 * other CFS nodes use.
 *
 * `levelElevation_mm` (default 0) lifts the world y by the wall's parent
 * level's stacked elevation. The framing pass computes it via
 * `wallLevelElevation_mm`; without this offset, upper-level walls produce
 * CFS members at the ground floor — the Slice 9 multi-story bug.
 */
export function localToWorld(
  wall: PascalWallLike,
  p: WallLocalPoint,
  levelElevation_mm: number = 0,
): CFSPoint3D {
  const length_mm = wallLengthFromPascalWall(wall)
  if (length_mm === 0) {
    return {
      x_mm: wall.start[0] * M_TO_MM,
      y_mm: p.y_mm + levelElevation_mm,
      z_mm: wall.start[1] * M_TO_MM,
    }
  }
  const dx = (wall.end[0] - wall.start[0]) * M_TO_MM
  const dz = (wall.end[1] - wall.start[1]) * M_TO_MM
  const ux = dx / length_mm
  const uz = dz / length_mm
  // Perpendicular in the level plane (rotate (ux, uz) by +90° around y).
  const px = -uz
  const pz = ux
  return {
    x_mm: wall.start[0] * M_TO_MM + ux * p.x_mm + px * p.z_mm,
    y_mm: p.y_mm + levelElevation_mm,
    z_mm: wall.start[1] * M_TO_MM + uz * p.x_mm + pz * p.z_mm,
  }
}
