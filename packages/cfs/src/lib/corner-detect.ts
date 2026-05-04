import type { CFSPoint3D } from '../schema/primitives'

const POS_TOLERANCE_MM = 1

export interface ChordCandidate {
  framingId: string
  /** World-space position of the chord stud's base (y=0). */
  position: { x_mm: number; z_mm: number }
}

/**
 * Decide whether this framing should emit a chord stud at the given world
 * position. The first-created framing wins shared corners (§5.1 step 3): a
 * deterministic ordering by `framingId` gives stable ownership across reloads.
 *
 * `peers` is every other CFSWallFraming in the scene with their currently
 * desired chord positions. Returns true iff this framing has the smallest
 * id among all framings whose chord candidates coincide with `position`.
 */
export function isCornerOwned(
  ownFramingId: string,
  position: { x_mm: number; z_mm: number },
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

function coincides(a: { x_mm: number; z_mm: number }, b: { x_mm: number; z_mm: number }): boolean {
  return Math.abs(a.x_mm - b.x_mm) <= POS_TOLERANCE_MM && Math.abs(a.z_mm - b.z_mm) <= POS_TOLERANCE_MM
}

export function chordPositionFromWorld(p: CFSPoint3D): { x_mm: number; z_mm: number } {
  return { x_mm: p.x_mm, z_mm: p.z_mm }
}
