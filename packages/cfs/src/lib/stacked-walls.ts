// Stud-position inheritance for stacked walls.
//
// CFS detailing best practice: studs on an upper-level wall sit directly
// above studs on the wall below so axial load transfers straight down
// through the stack rather than bearing on the track only. To express
// this in CFS the framing pass asks this module:
//
//   "For an upper wall, what stud positions should it use so its
//    framing aligns with whatever sits below it?"
//
// **Collinear partial overlap.** Pascal often splits a perimeter wall
// at every interior-wall junction, so a single upper wall (`(-6,-5.5)
// → (-6, 0)`) sits above two or more lower walls (`(-6,-5.5)→(-6,-3.5)`
// plus `(-6,-3.5)→(-6, 0)`). We walk every wall in the level below,
// keep the ones lying on the same plan line as the upper wall (within
// `STACKED_FOOTPRINT_TOLERANCE_MM` perpendicular distance), compute
// each one's chord + field stud positions in world space, and project
// those into the upper wall's local coordinate frame. Positions outside
// the upper wall's range, or coinciding with its chord endpoints
// (handled separately by the framing pass), are dropped.
//
// If no lower wall is collinear, the function returns `null` and the
// caller falls back to the default `findStudCandidatesAlongWall`.

import type { SceneLike } from './scene-walk'
import { levelOf } from './scene-walk'
import { findStudCandidatesAlongWall } from './stud-candidates'
import type { PascalWallLike } from './wall-frame'
import { wallLengthFromPascalWall } from './wall-frame'

const M_TO_MM = 1000

/**
 * Maximum allowed perpendicular distance from the upper wall's plan
 * line for a lower wall to count as "collinear" (and therefore a
 * candidate for stud inheritance). 100 mm absorbs typical snap-grid
 * drift between hand-drawn walls while staying narrow enough to reject
 * unrelated walls on the floor below.
 */
export const STACKED_FOOTPRINT_TOLERANCE_MM = 100

interface LevelLike {
  type?: 'level'
  id: string
  parentId?: string | null
  level?: number
  children?: string[]
}

interface WallLike {
  type?: 'wall'
  id: string
  parentId?: string
  start: readonly [number, number]
  end: readonly [number, number]
}

interface FramingLike {
  type?: 'cfs_wall_framing'
  id: string
  parentId: string
  studSpacing_mm?: number | null
}

/** Find the level directly below the level that owns `wallId`. */
function findLevelBelow(scene: SceneLike, wallId: string): LevelLike | null {
  const currentLevelId = levelOf(scene, wallId)
  if (!currentLevelId) return null
  const currentLevel = scene.nodes[currentLevelId] as LevelLike | undefined
  if (!currentLevel || currentLevel.parentId == null) return null
  const building = scene.nodes[currentLevel.parentId] as
    | { children?: string[] }
    | undefined
  if (!building?.children) return null

  const currentIndex = currentLevel.level ?? 0
  const targetIndex = currentIndex - 1
  if (targetIndex < 0) return null

  for (const childId of building.children) {
    const sib = scene.nodes[childId] as LevelLike | undefined
    if (sib?.type === 'level' && (sib.level ?? 0) === targetIndex) {
      return sib
    }
  }
  return null
}

/** Find the CFS wall framing whose `parentId` is the given wall id. */
function findFramingForWall(
  scene: SceneLike,
  wallId: string,
): FramingLike | null {
  for (const n of Object.values(scene.nodes)) {
    const f = n as FramingLike | undefined
    if (f?.type === 'cfs_wall_framing' && f.parentId === wallId) return f
  }
  return null
}

/**
 * Project a 2-D level-plane point onto the wall's infinite line.
 * Returns the signed projection (`t_mm`) along the wall axis measured
 * from `wall.start`, plus the signed perpendicular distance from the
 * wall's line (`perp_mm`). All in mm.
 */
function projectOntoWallLine(
  pt: readonly [number, number],
  wall: PascalWallLike,
): { t_mm: number; perp_mm: number } {
  const dx_m = wall.end[0] - wall.start[0]
  const dz_m = wall.end[1] - wall.start[1]
  const length_m = Math.hypot(dx_m, dz_m)
  if (length_m === 0) return { t_mm: 0, perp_mm: 0 }
  const ux = dx_m / length_m
  const uz = dz_m / length_m
  const px = pt[0] - wall.start[0]
  const pz = pt[1] - wall.start[1]
  const t = px * ux + pz * uz
  const perp = px * -uz + pz * ux
  return { t_mm: t * M_TO_MM, perp_mm: perp * M_TO_MM }
}

/** Is `other` on the same plan line as `reference` (within tolerance) AND
 *  do their projections overlap on that line? */
function isCollinearOverlapping(
  reference: PascalWallLike,
  other: PascalWallLike,
  tolerance_mm: number,
): boolean {
  const startProj = projectOntoWallLine(other.start, reference)
  const endProj = projectOntoWallLine(other.end, reference)
  if (Math.abs(startProj.perp_mm) > tolerance_mm) return false
  if (Math.abs(endProj.perp_mm) > tolerance_mm) return false
  const refLength_mm = wallLengthFromPascalWall(reference)
  const minT = Math.min(startProj.t_mm, endProj.t_mm)
  const maxT = Math.max(startProj.t_mm, endProj.t_mm)
  if (maxT < -tolerance_mm) return false
  if (minT > refLength_mm + tolerance_mm) return false
  return true
}

function findCollinearLowerWalls(
  scene: SceneLike,
  level: LevelLike,
  currentWall: PascalWallLike,
): WallLike[] {
  if (!level.children) return []
  const out: WallLike[] = []
  for (const childId of level.children) {
    const w = scene.nodes[childId] as WallLike | undefined
    if (w?.type !== 'wall') continue
    if (!Array.isArray(w.start) || !Array.isArray(w.end)) continue
    if (
      isCollinearOverlapping(
        currentWall,
        w as unknown as PascalWallLike,
        STACKED_FOOTPRINT_TOLERANCE_MM,
      )
    ) {
      out.push(w)
    }
  }
  return out
}

/** Stud positions of one lower wall, translated into the upper wall's
 *  local coordinate frame. Chord positions (0 and lower-length) are
 *  included alongside field studs — they are stud locations the upper
 *  wall should align with for load transfer. */
function inheritFromLowerWall(
  scene: SceneLike,
  lower: WallLike,
  currentWall: PascalWallLike,
  defaultSpacing_mm: number,
  currentLength_mm: number,
): number[] {
  const lowerFraming = findFramingForWall(scene, lower.id)
  const lowerSpacing_mm = lowerFraming?.studSpacing_mm ?? defaultSpacing_mm
  const lowerLength_mm = wallLengthFromPascalWall(
    lower as unknown as PascalWallLike,
  )
  if (lowerLength_mm === 0) return []

  const lowerLocalXs: number[] = [0, lowerLength_mm]
  for (const x of findStudCandidatesAlongWall(lowerSpacing_mm, lowerLength_mm)) {
    lowerLocalXs.push(x)
  }

  const dx_m = lower.end[0] - lower.start[0]
  const dz_m = lower.end[1] - lower.start[1]
  const lowerLength_m = Math.hypot(dx_m, dz_m)
  if (lowerLength_m === 0) return []
  const ux = dx_m / lowerLength_m
  const uz = dz_m / lowerLength_m

  const out: number[] = []
  for (const lx of lowerLocalXs) {
    const worldX_m = lower.start[0] + (lx / M_TO_MM) * ux
    const worldZ_m = lower.start[1] + (lx / M_TO_MM) * uz
    const proj = projectOntoWallLine([worldX_m, worldZ_m], currentWall)
    if (Math.abs(proj.perp_mm) > STACKED_FOOTPRINT_TOLERANCE_MM) continue
    // Drop positions at or near the upper wall's chord endpoints — those
    // are emitted as chord studs by the upper wall itself. The dead-zone
    // width is the same `STACKED_FOOTPRINT_TOLERANCE_MM` we use elsewhere,
    // so a lower-wall chord that lands within tolerance of the upper's
    // start (or end) is not duplicated as a stray field stud right next
    // to the upper's chord. T-junction positions in the interior remain
    // (e.g., upper-local 2000 mm for a wall sitting above two stacked
    // lower walls that share an endpoint).
    if (proj.t_mm < STACKED_FOOTPRINT_TOLERANCE_MM) continue
    if (proj.t_mm > currentLength_mm - STACKED_FOOTPRINT_TOLERANCE_MM) continue
    // Round to nearest mm — the projection math accumulates float drift
    // (e.g., 3.65 - 0.05 ≠ 3.6 in IEEE 754) that would otherwise show
    // up as 1200.0000000000002 instead of 1200.
    out.push(Math.round(proj.t_mm))
  }
  return out
}

/**
 * Field-stud positions for the upper wall, inherited from every
 * collinear wall on the level below. Returns `null` when there is no
 * level below or no collinear lower wall — the caller falls back to
 * the default `findStudCandidatesAlongWall` in that case.
 */
export function getInheritedStudPositions_mm(
  scene: SceneLike,
  currentWall: PascalWallLike,
  defaultSpacing_mm: number,
): number[] | null {
  const lowerLevel = findLevelBelow(scene, currentWall.id)
  if (!lowerLevel) return null

  const collinear = findCollinearLowerWalls(scene, lowerLevel, currentWall)
  if (collinear.length === 0) return null

  const currentLength_mm = wallLengthFromPascalWall(currentWall)
  if (currentLength_mm === 0) return null

  const all: number[] = []
  for (const lower of collinear) {
    for (const x of inheritFromLowerWall(
      scene,
      lower,
      currentWall,
      defaultSpacing_mm,
      currentLength_mm,
    )) {
      all.push(x)
    }
  }
  if (all.length === 0) return null

  // Sort + dedupe within 1 mm (T-junction shared endpoints land at the
  // same upper-local x from two lower walls).
  all.sort((a, b) => a - b)
  const out: number[] = []
  for (const x of all) {
    if (out.length === 0 || x - out[out.length - 1]! > 1) out.push(x)
  }
  return out
}
