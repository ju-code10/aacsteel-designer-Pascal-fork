// L/T-corner lap convention.
//
// Pascal stores both walls in an L-corner as architectural centerlines
// of equal length. In real CFS construction one wall runs through and
// the other butts into its side, so the butting wall's stud-layout
// extent has to stop short or chord studs from both walls collide in
// the corner volume.
//
// Trim amount: HALF the through wall's stud web depth. The architectural
// corner is at the through wall's centerline; the through wall's near
// face is half-a-web-depth inside (toward us). The butt wall's track
// ends at that face. The butt chord sits at the same x as the track end,
// so its flange overlaps the through-wall chord's flange — the standard
// "back-to-back" L-corner detail in CFS practice. Using the *full* web
// depth would leave a visible gap between the chord studs.
//
// "First-placed runs through" rule (chosen by the user): peers are
// compared by their scene insertion index. A wall with a smaller index
// (placed earlier) wins the through role; the later wall is the butt
// and gets its end shortened.
//
// At T-junctions (one wall's endpoint lands on another wall's interior)
// the geometry decides — there is no symmetry — so the placement order
// is irrelevant. The through wall additionally gets a "T-post" chord
// stud at the junction's local-x position for the butting wall to
// fasten into.

import { CHORD_PLAN_TOLERANCE_MM, CHORD_PARALLEL_DOT } from './corner-detect'

/** Fraction of the through wall's stud web depth that the butt wall is
 *  shortened by — 0.5 puts the butt's end at the through wall's near face
 *  (the architectural centerline is at half-web in either direction).
 *  Exported so tests and the inspector can reason about the trim. */
export const TRIM_FRACTION_OF_THROUGH_WEB = 0.5

export interface JunctionPeer {
  framingId: string
  /** Scene insertion index for the peer's framing node. Smaller = placed first. */
  sceneIndex: number
  /** Peer wall endpoints in world mm (start/end). */
  start: { x_mm: number; y_mm: number; z_mm: number }
  end: { x_mm: number; y_mm: number; z_mm: number }
  /** Unit direction (start → end) in plan. */
  direction: { x: number; z: number }
  /** Peer's stud web depth in mm — the amount we trim by when butting into it. */
  studWebDepth_mm: number
}

export type EndJunctionKind =
  | 'free'
  | 'collinear-shared'
  | 'L-through'
  | 'L-butt'
  | 'T-butt'

export interface EndJunction {
  kind: EndJunctionKind
  /** Set for L-butt and T-butt — describes which peer this end butts into. */
  butt?: { peerFramingId: string; trim_mm: number }
}

export interface InteriorJunction {
  /** Local x along *this* wall (0..length_mm) where a peer butts into us. */
  positionAlongWall_mm: number
  /** Peer framing id that butts here. */
  peerFramingId: string
}

export interface WallTrim {
  startTrim_mm: number
  endTrim_mm: number
  startJunction: EndJunction
  endJunction: EndJunction
  /** Through-wall T-post positions (interior x's on this wall). */
  tPosts: InteriorJunction[]
}

const ELEVATION_TOLERANCE_MM = 1
const PLAN_TOLERANCE_MM = CHORD_PLAN_TOLERANCE_MM
/** When |dot| is below this the two walls are treated as perpendicular-ish
 *  (anything within ~26° of perpendicular). Mirrors the inverse of
 *  CHORD_PARALLEL_DOT so the merge / lap classifications are consistent. */
const PERPENDICULAR_DOT_MAX = CHORD_PARALLEL_DOT

interface PointMM {
  x_mm: number
  y_mm: number
  z_mm: number
}

function dot2D(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return a.x * b.x + a.z * b.z
}

function isParallel(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  return Math.abs(dot2D(a, b)) >= CHORD_PARALLEL_DOT
}

function isPerpendicularish(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  return Math.abs(dot2D(a, b)) < PERPENDICULAR_DOT_MAX
}

function planDistance(a: PointMM, b: PointMM): number {
  const dx = a.x_mm - b.x_mm
  const dz = a.z_mm - b.z_mm
  return Math.hypot(dx, dz)
}

function sameElevation(a: PointMM, b: PointMM): boolean {
  return Math.abs(a.y_mm - b.y_mm) <= ELEVATION_TOLERANCE_MM
}

function coincides(a: PointMM, b: PointMM): boolean {
  return planDistance(a, b) <= PLAN_TOLERANCE_MM && sameElevation(a, b)
}

/**
 * Project `p` onto the segment from `a` to `b` and return (t, perpDistance_mm)
 * where t ∈ [0, 1] is the normalized position along the segment. If the
 * segment has zero length both values are undefined.
 */
function projectOnSegment(
  p: PointMM,
  a: PointMM,
  b: PointMM,
): { t: number; perp_mm: number; along_mm: number } | null {
  const dx = b.x_mm - a.x_mm
  const dz = b.z_mm - a.z_mm
  const segLen2 = dx * dx + dz * dz
  if (segLen2 === 0) return null
  const segLen = Math.sqrt(segLen2)
  const px = p.x_mm - a.x_mm
  const pz = p.z_mm - a.z_mm
  const along = (px * dx + pz * dz) / segLen
  const t = along / segLen
  // Perpendicular distance using cross magnitude in the plane.
  const cross = px * (dz / segLen) - pz * (dx / segLen)
  return { t, perp_mm: Math.abs(cross), along_mm: along }
}

/**
 * Is `p` on the *interior* of segment a→b (strictly between endpoints, within
 * plan + elevation tolerance)? "Strictly" means it isn't within tolerance of
 * either endpoint — otherwise an L-corner would be misclassified as a T.
 */
function pointOnSegmentInterior(p: PointMM, a: PointMM, b: PointMM): { along_mm: number } | null {
  if (!sameElevation(p, a)) return null
  const proj = projectOnSegment(p, a, b)
  if (!proj) return null
  if (proj.perp_mm > PLAN_TOLERANCE_MM) return null
  if (proj.along_mm <= PLAN_TOLERANCE_MM) return null
  const segLen = planDistance(a, b)
  if (proj.along_mm >= segLen - PLAN_TOLERANCE_MM) return null
  return { along_mm: proj.along_mm }
}

export interface ClassifyArgs {
  ownFramingId: string
  ownSceneIndex: number
  ownStart: PointMM
  ownEnd: PointMM
  ownDirection: { x: number; z: number }
  peers: JunctionPeer[]
}

/** Classify one wall end against the peer list. */
function classifyOneEnd(
  endPos: PointMM,
  ownDirection: { x: number; z: number },
  ownSceneIndex: number,
  peers: JunctionPeer[],
): EndJunction {
  // 1. L-corner: a peer endpoint coincides with this end.
  const coincidentPeers = peers.filter(
    (p) => coincides(p.start, endPos) || coincides(p.end, endPos),
  )
  if (coincidentPeers.length > 0) {
    // Split by direction: collinear peers merge the chord (handled by
    // isCornerOwned upstream); perpendicular peers are L-corner candidates.
    const perpPeers = coincidentPeers.filter((p) => isPerpendicularish(p.direction, ownDirection))
    const parallelPeers = coincidentPeers.filter((p) => isParallel(p.direction, ownDirection))
    if (perpPeers.length > 0) {
      // First-placed (smallest sceneIndex) runs through.
      const earliest = perpPeers.reduce(
        (best, p) => (p.sceneIndex < best.sceneIndex ? p : best),
        perpPeers[0]!,
      )
      if (earliest.sceneIndex < ownSceneIndex) {
        // Peer placed first → peer is through, we butt.
        return {
          kind: 'L-butt',
          butt: {
            peerFramingId: earliest.framingId,
            trim_mm: earliest.studWebDepth_mm * TRIM_FRACTION_OF_THROUGH_WEB,
          },
        }
      }
      return { kind: 'L-through' }
    }
    if (parallelPeers.length > 0) {
      return { kind: 'collinear-shared' }
    }
  }

  // 2. T-butt: this wall's endpoint lies on a peer's interior.
  for (const peer of peers) {
    const hit = pointOnSegmentInterior(endPos, peer.start, peer.end)
    if (hit && isPerpendicularish(peer.direction, ownDirection)) {
      return {
        kind: 'T-butt',
        butt: {
          peerFramingId: peer.framingId,
          trim_mm: peer.studWebDepth_mm * TRIM_FRACTION_OF_THROUGH_WEB,
        },
      }
    }
  }

  return { kind: 'free' }
}

/** Compute trim, junction classification, and T-post list for one wall. */
export function computeWallTrim(args: ClassifyArgs): WallTrim {
  const { ownStart, ownEnd, ownDirection, ownSceneIndex, peers } = args

  const startJunction = classifyOneEnd(ownStart, ownDirection, ownSceneIndex, peers)
  const endJunction = classifyOneEnd(ownEnd, ownDirection, ownSceneIndex, peers)

  // T-through: walk peers and detect any whose endpoint lands on *our* interior.
  const tPosts: InteriorJunction[] = []
  for (const peer of peers) {
    if (!isPerpendicularish(peer.direction, ownDirection)) continue
    for (const peerEnd of [peer.start, peer.end] as const) {
      const hit = pointOnSegmentInterior(peerEnd, ownStart, ownEnd)
      if (hit) {
        tPosts.push({
          positionAlongWall_mm: hit.along_mm,
          peerFramingId: peer.framingId,
        })
      }
    }
  }
  // Deduplicate near-duplicates (peer touches us at two ends from same axis,
  // or floating-point drift): collapse anything within plan tolerance.
  tPosts.sort((a, b) => a.positionAlongWall_mm - b.positionAlongWall_mm)
  const dedupedTPosts: InteriorJunction[] = []
  for (const t of tPosts) {
    const prev = dedupedTPosts[dedupedTPosts.length - 1]
    if (prev && Math.abs(prev.positionAlongWall_mm - t.positionAlongWall_mm) <= PLAN_TOLERANCE_MM) {
      continue
    }
    dedupedTPosts.push(t)
  }

  return {
    startTrim_mm: startJunction.butt?.trim_mm ?? 0,
    endTrim_mm: endJunction.butt?.trim_mm ?? 0,
    startJunction,
    endJunction,
    tPosts: dedupedTPosts,
  }
}
