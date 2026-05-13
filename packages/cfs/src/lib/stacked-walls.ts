// Stud-position inheritance for stacked walls (CFS detailing best
// practice: studs on an upper-level wall sit directly above studs on
// the wall below so axial load transfers straight down through the
// stack rather than bearing on track only).
//
// When the framing pass runs for a wall, it asks this module:
//   "Is there a wall directly below me with the same plan footprint?
//    If so, what are its field-stud positions in MY coordinate system?"
//
// The returned positions replace the default
// `findStudCandidatesAlongWall` output. If no lower wall is found,
// or no match within tolerance, the caller falls back to the default.
//
// "Plan footprint match" tolerates small offsets in `start`/`end`
// (default 100 mm) because users often re-draw walls on a new level
// with mouse precision rather than copying coordinates exactly — and
// Pascal does not yet have a "stack wall on level above" convenience.

import type { SceneLike } from './scene-walk'
import { levelOf } from './scene-walk'
import { findStudCandidatesAlongWall } from './stud-candidates'
import type { PascalWallLike } from './wall-frame'
import { wallLengthFromPascalWall } from './wall-frame'

const M_TO_MM = 1000

/**
 * Maximum allowed offset (mm) between two walls' start/end coordinates
 * for them to be considered "stacked". 100 mm is generous enough to
 * catch a single snap-unit miss but tight enough to never match an
 * unrelated wall on the floor below.
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

function closeEnough_m(
  a: readonly [number, number],
  b: readonly [number, number],
  tolerance_m: number,
): boolean {
  return Math.abs(a[0] - b[0]) <= tolerance_m && Math.abs(a[1] - b[1]) <= tolerance_m
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

/**
 * Find a wall in `level` whose plan footprint matches `wall` within
 * tolerance. Returns the first match (in case multiple, which is rare).
 * Matches in either direction — the lower wall's start may correspond
 * to the upper wall's start *or* its end.
 */
function findMatchingWall(
  scene: SceneLike,
  level: LevelLike,
  wall: PascalWallLike,
): { wall: WallLike; reversed: boolean } | null {
  if (!level.children) return null
  const tolerance_m = STACKED_FOOTPRINT_TOLERANCE_MM / M_TO_MM
  for (const childId of level.children) {
    const w = scene.nodes[childId] as WallLike | undefined
    if (w?.type !== 'wall') continue
    if (!Array.isArray(w.start) || !Array.isArray(w.end)) continue
    const forward =
      closeEnough_m(w.start, wall.start, tolerance_m) &&
      closeEnough_m(w.end, wall.end, tolerance_m)
    const reversed =
      closeEnough_m(w.start, wall.end, tolerance_m) &&
      closeEnough_m(w.end, wall.start, tolerance_m)
    if (forward) return { wall: w, reversed: false }
    if (reversed) return { wall: w, reversed: true }
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
 * Compute stud positions of the wall directly below `currentWall`,
 * translated into `currentWall`'s wall-local coordinate system. Returns
 * `null` when no matching lower wall exists. The caller falls back to
 * the default `findStudCandidatesAlongWall` in that case.
 *
 * `defaultSpacing_mm` is used when the lower wall has no framing yet
 * (rare but possible during scene construction). When the lower wall
 * has a framing, its own `studSpacing_mm` is used so any wall-level
 * override propagates up the stack.
 */
export function getInheritedStudPositions_mm(
  scene: SceneLike,
  currentWall: PascalWallLike,
  defaultSpacing_mm: number,
): number[] | null {
  const lowerLevel = findLevelBelow(scene, currentWall.id)
  if (!lowerLevel) return null

  const match = findMatchingWall(scene, lowerLevel, currentWall)
  if (!match) return null

  const lower = match.wall
  const lowerFraming = findFramingForWall(scene, lower.id)
  const lowerSpacing_mm = lowerFraming?.studSpacing_mm ?? defaultSpacing_mm
  const lowerLength_mm = wallLengthFromPascalWall(
    lower as unknown as PascalWallLike,
  )
  if (lowerLength_mm === 0) return null

  const lowerPositions = findStudCandidatesAlongWall(
    lowerSpacing_mm,
    lowerLength_mm,
  )

  const currentLength_mm = wallLengthFromPascalWall(currentWall)
  if (currentLength_mm === 0) return null

  // Translate lower-wall-local positions into current-wall-local.
  //
  // For straight walls of the same direction, currentLocalX equals
  // lowerLocalX + projection_along_current_axis_of(lowerStart - currentStart).
  // When `reversed` is true, the lower wall's positions are measured
  // from its end (which corresponds to current's start) — mirror them.
  const cs = currentWall.start
  const ce = currentWall.end
  const dx_m = ce[0] - cs[0]
  const dz_m = ce[1] - cs[1]
  const length_m = Math.hypot(dx_m, dz_m)
  if (length_m === 0) return null
  const ux = dx_m / length_m
  const uz = dz_m / length_m

  const lowerAnchor = match.reversed ? lower.end : lower.start
  const offsetAlong_mm =
    ((lowerAnchor[0] - cs[0]) * ux + (lowerAnchor[1] - cs[1]) * uz) *
    M_TO_MM

  const out: number[] = []
  for (const lx of lowerPositions) {
    const cx = lx + offsetAlong_mm
    // Drop positions that fall outside the current wall, or so close to
    // either end that they would collide with the chord stud.
    if (cx <= 0 || cx >= currentLength_mm) continue
    out.push(cx)
  }
  return out
}
