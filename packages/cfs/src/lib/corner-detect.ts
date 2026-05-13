// Corner-stud ownership.
//
// When two CFSWallFramings' chord candidates land at the same world
// position AND their walls run in (anti)parallel directions, the chord
// is shared: only the smallest-id framing emits at that position
// (§5.1 step 3). Perpendicular walls meeting at an L-corner each keep
// their own chord — that is the **doubled-chord** configuration in
// §1.4, "the chord stud may be shared with the adjacent wall, doubled
// up (back-to-back chords), or boxed."
//
// The match is 3D + directional:
//   - plan match within `CHORD_PLAN_TOLERANCE_MM`  (drift-tolerant)
//   - elevation match within `CHORD_ELEVATION_TOLERANCE_MM`  (level-tight)
//   - dot product of wall direction vectors |·| >= `CHORD_PARALLEL_DOT`
//     (cos 26° — walls within ~26° of the same axis count as parallel).

import type { CFSPoint3D } from '../schema/primitives'

export const CHORD_PLAN_TOLERANCE_MM = 100
export const CHORD_ELEVATION_TOLERANCE_MM = 1
export const CHORD_PARALLEL_DOT = 0.9

export interface ChordCandidate {
  framingId: string
  /** World-space position of the chord stud's base. */
  position: { x_mm: number; y_mm: number; z_mm: number }
  /** Wall direction unit vector in plan (x, z). Used to distinguish
   *  perpendicular L-corners (doubled chord) from collinear chord
   *  coincidences (merge to single chord). */
  direction: { x: number; z: number }
}

export function isCornerOwned(
  ownFramingId: string,
  position: { x_mm: number; y_mm: number; z_mm: number },
  direction: { x: number; z: number },
  peers: ChordCandidate[],
): boolean {
  const me: ChordCandidate = {
    framingId: ownFramingId,
    position,
    direction,
  }
  const ownerCandidates = [
    ownFramingId,
    ...peers.filter((p) => coincides(p, me)).map((p) => p.framingId),
  ]
  ownerCandidates.sort()
  return ownerCandidates[0] === ownFramingId
}

function coincides(a: ChordCandidate, b: ChordCandidate): boolean {
  if (Math.abs(a.position.x_mm - b.position.x_mm) > CHORD_PLAN_TOLERANCE_MM) return false
  if (Math.abs(a.position.z_mm - b.position.z_mm) > CHORD_PLAN_TOLERANCE_MM) return false
  if (Math.abs(a.position.y_mm - b.position.y_mm) > CHORD_ELEVATION_TOLERANCE_MM) return false
  const dot = a.direction.x * b.direction.x + a.direction.z * b.direction.z
  return Math.abs(dot) >= CHORD_PARALLEL_DOT
}

export function chordPositionFromWorld(p: CFSPoint3D): {
  x_mm: number
  y_mm: number
  z_mm: number
} {
  return { x_mm: p.x_mm, y_mm: p.y_mm, z_mm: p.z_mm }
}

/** Plan-direction unit vector for a wall, from `start` to `end`. */
export function wallDirection(
  wall: { start: readonly [number, number]; end: readonly [number, number] },
): { x: number; z: number } {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const len = Math.hypot(dx, dz)
  if (len === 0) return { x: 1, z: 0 }
  return { x: dx / len, z: dz / len }
}
