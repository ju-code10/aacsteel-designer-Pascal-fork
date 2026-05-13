// Corner-stud ownership: when two CFSWallFramings' chord candidates
// land at the same world position, only ONE of them emits a chord
// stud at that position (the smallest-id wins per §5.1 step 3).
//
// The match is 3D (x, z plan + y elevation) so two walls stacked on
// different levels at the same plan position are correctly treated
// as INDEPENDENT (each emits its own chord) rather than collapsing
// into one. Plan tolerance is wide (100 mm) to absorb a single
// snap-grid miss when the user draws an L-corner; elevation tolerance
// is tight (1 mm) because levels are always cleanly separated.

import type { CFSPoint3D } from '../schema/primitives'

/**
 * Maximum allowed plan offset (mm) between two chord candidates for
 * them to be considered the same corner. Wide enough to catch a
 * single snap-grid miss; tight enough not to match unrelated walls.
 */
export const CHORD_PLAN_TOLERANCE_MM = 100

/**
 * Elevation tolerance (mm). Stays tight because level base elevations
 * are always cleanly separated by the level's stack height.
 */
export const CHORD_ELEVATION_TOLERANCE_MM = 1

export interface ChordCandidate {
  framingId: string
  /** World-space position of the chord stud's base. */
  position: { x_mm: number; y_mm: number; z_mm: number }
}

/**
 * Decide whether this framing should emit a chord stud at the given
 * world position. The first-created framing wins shared corners
 * (§5.1 step 3): a deterministic ordering by `framingId` gives stable
 * ownership across reloads.
 *
 * `peers` is every other CFSWallFraming in the scene with their
 * currently desired chord positions. Returns true iff this framing
 * has the smallest id among all framings whose chord candidates
 * coincide with `position`.
 */
export function isCornerOwned(
  ownFramingId: string,
  position: { x_mm: number; y_mm: number; z_mm: number },
  peers: ChordCandidate[],
): boolean {
  const ownerCandidates = [
    ownFramingId,
    ...peers
      .filter((p) => coincides(p.position, position))
      .map((p) => p.framingId),
  ]
  ownerCandidates.sort()
  return ownerCandidates[0] === ownFramingId
}

function coincides(
  a: { x_mm: number; y_mm: number; z_mm: number },
  b: { x_mm: number; y_mm: number; z_mm: number },
): boolean {
  return (
    Math.abs(a.x_mm - b.x_mm) <= CHORD_PLAN_TOLERANCE_MM &&
    Math.abs(a.z_mm - b.z_mm) <= CHORD_PLAN_TOLERANCE_MM &&
    Math.abs(a.y_mm - b.y_mm) <= CHORD_ELEVATION_TOLERANCE_MM
  )
}

export function chordPositionFromWorld(p: CFSPoint3D): {
  x_mm: number
  y_mm: number
  z_mm: number
} {
  return { x_mm: p.x_mm, y_mm: p.y_mm, z_mm: p.z_mm }
}
