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
// face is half-a-web inside (toward us), so trim = half-web puts the
// butt's track end at that face — the two tracks form a clean L with
// no gap. The chord studs sit web-to-web at the corner; the C
// orientation flip on the start chord (orientation_deg = 180) keeps the
// flanges facing inward so the chord profiles don't visually invade
// each other.
//
// A full-web trim leaves a visible gap between the two walls and reads
// as "the walls are separated"; a zero trim puts both chord studs at
// the architectural corner with significant volume overlap. Half-web
// is the geometric "walls together, no gap, edge contact" position.
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
 *  shortened by — 1.0 puts the butt's end at the through wall's far
 *  face, so the butt wall's framing bbox starts exactly where the
 *  through wall's framing bbox ends (zero volume overlap). Combined
 *  with the lateral offset (also half-web toward the peer's body),
 *  the building outer faces snap to the architectural perimeter and
 *  every junction is a clean face-to-face touch. */
export const TRIM_FRACTION_OF_THROUGH_WEB = 1.0

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
  /** Peer's stud flange width in mm — the cross-section bbox width in plan,
   *  used as the lateral-offset magnitude so the butt chord sits flush
   *  against the through chord's edge instead of leaving a hairline gap. */
  studFlangeWidth_mm: number
}

export type EndJunctionKind =
  | 'free'
  | 'collinear-shared'
  | 'L-through'
  | 'L-butt'
  | 'T-butt'

export interface EndJunction {
  kind: EndJunctionKind
  /** Set for L-butt and T-butt — describes which peer this end butts into.
   *  `lateralOffsetDirection` is set only for L-butt and is the unit vector
   *  in plan (x, z) pointing from the corner toward the through wall's body
   *  — the direction the butting wall's framing should be shifted so its
   *  outer face aligns with the through wall's outer face. */
  butt?: {
    peerFramingId: string
    trim_mm: number
    lateralOffsetDirection?: { x: number; z: number }
    /** Magnitude of the lateral offset along `lateralOffsetDirection`.
     *  Decoupled from `trim_mm` because the trim is half-web (track
     *  butts the through-wall face) while the offset is one flange
     *  width (chord-stud edges sit flush). */
    lateralOffsetMagnitude_mm?: number
  }
  /** Unit vector (x, z) from this end toward the perpendicular peer wall's
   *  body — set for L-butt and L-through. The chord-stud at this end has
   *  its C-section rotated so the open mouth faces this direction, so the
   *  two chord-studs at a corner end up with their Cs facing the building
   *  interior across the corner instead of opening along their own walls
   *  past each other. */
  peerBodyDirection?: { x: number; z: number }
  /** Perpendicular peer wall's stud web depth in mm — used as the lateral
   *  offset magnitude for THROUGH walls (so the through wall's framing
   *  shifts toward its perpendicular peer's body by half-web, matching
   *  what butt walls already do at the same corner). Set for L-butt and
   *  L-through. */
  peerWebDepth_mm?: number
}

export interface InteriorJunction {
  /** Local x along *this* wall (0..length_mm) where a peer butts into us. */
  positionAlongWall_mm: number
  /** Peer framing id that butts here. */
  peerFramingId: string
  /** Unit direction (x, z) from the T-point toward the butting peer's
   *  body — used to rotate the T-post's C-section so its open mouth
   *  faces the butt wall (same convention as L-corner chord rotation). */
  buttBodyDirection: { x: number; z: number }
}

export interface WallTrim {
  startTrim_mm: number
  endTrim_mm: number
  startJunction: EndJunction
  endJunction: EndJunction
  /** Through-wall T-post positions (interior x's on this wall). */
  tPosts: InteriorJunction[]
  /** Plan offset to apply uniformly to every member in this wall, in mm.
   *  Aggregates the lateralOffsetDirection contributions from butt ends.
   *  Always zero for walls with no L-butt ends. */
  lateralOffsetX_mm: number
  lateralOffsetZ_mm: number
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
      // For both L-butt and L-through, "toward the peer's body" is the
      // direction from this corner into the peer wall (used for the chord
      // C-section's open direction). The peer's endpoint coincides with
      // this corner; whichever of its endpoints is closer marks the
      // corner, and the further one points into the body.
      const dStart = Math.hypot(
        earliest.start.x_mm - endPos.x_mm,
        earliest.start.z_mm - endPos.z_mm,
      )
      const dEnd = Math.hypot(
        earliest.end.x_mm - endPos.x_mm,
        earliest.end.z_mm - endPos.z_mm,
      )
      const peerBodyDirection = dStart <= dEnd
        ? { x: earliest.direction.x, z: earliest.direction.z }
        : { x: -earliest.direction.x, z: -earliest.direction.z }
      if (earliest.sceneIndex < ownSceneIndex) {
        // Peer placed first → peer is through, we butt.
        // Lateral offset = half the through wall's web depth: aligns the
        // butt wall's outer face with the through wall's outer face. The
        // chord stud is in its default orient_180/0 (web on outside along
        // wall axis), so its bbox in plan is one *full* web wide — and
        // half-web is the right offset for outer-face alignment. (The
        // shorter "flange-width" offset was only correct when the chord
        // was rotated 90°, which has been reverted.)
        return {
          kind: 'L-butt',
          butt: {
            peerFramingId: earliest.framingId,
            trim_mm: earliest.studWebDepth_mm * TRIM_FRACTION_OF_THROUGH_WEB,
            lateralOffsetDirection: peerBodyDirection,
          },
          peerBodyDirection,
          peerWebDepth_mm: earliest.studWebDepth_mm,
        }
      }
      // L-through: we are the through wall here. We don't carry a `butt`
      // record (we're not butting), but we still need a lateral offset so
      // our framing shifts toward the perpendicular peer's body — without
      // this, the through wall's outer face sticks out half-a-web past
      // the architectural corner while butt walls at the same corner are
      // already shifted in.
      return {
        kind: 'L-through',
        peerBodyDirection,
        peerWebDepth_mm: earliest.studWebDepth_mm,
      }
    }
    if (parallelPeers.length > 0) {
      return { kind: 'collinear-shared' }
    }
  }

  // 2. T-butt: this wall's endpoint lies on a peer's interior.
  for (const peer of peers) {
    const hit = pointOnSegmentInterior(endPos, peer.start, peer.end)
    if (hit && isPerpendicularish(peer.direction, ownDirection)) {
      // The through wall extends both ways from the T-point so either
      // direction along peer is geometrically valid; we pick +peer.direction
      // so the butt's chord C rotates to face perpendicular to itself
      // (matching the L-corner convention).
      return {
        kind: 'T-butt',
        butt: {
          peerFramingId: peer.framingId,
          trim_mm: peer.studWebDepth_mm * TRIM_FRACTION_OF_THROUGH_WEB,
        },
        peerBodyDirection: { x: peer.direction.x, z: peer.direction.z },
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
  // The butt's body extends away from `peerEnd` along its own axis: when
  // peerEnd is the peer's start, the body extends in +peer.direction;
  // when peerEnd is the peer's end, it extends in -peer.direction. We
  // store that direction so the T-post can rotate to face the butt.
  const tPosts: InteriorJunction[] = []
  for (const peer of peers) {
    if (!isPerpendicularish(peer.direction, ownDirection)) continue
    const peerEnds: ReadonlyArray<readonly [{ x_mm: number; y_mm: number; z_mm: number }, 1 | -1]> = [
      [peer.start, +1] as const,
      [peer.end, -1] as const,
    ]
    for (const [peerEnd, sign] of peerEnds) {
      const hit = pointOnSegmentInterior(peerEnd, ownStart, ownEnd)
      if (hit) {
        tPosts.push({
          positionAlongWall_mm: hit.along_mm,
          peerFramingId: peer.framingId,
          buttBodyDirection: {
            x: peer.direction.x * sign,
            z: peer.direction.z * sign,
          },
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

  // Aggregate lateral offset from L-butt AND L-through ends. Each L
  // junction votes a direction × magnitude in plan; magnitude is
  // half the perpendicular peer's web depth so the wall's outer face
  // snaps to the architectural drawn line. Combined with the full-web
  // longitudinal trim (TRIM_FRACTION_OF_THROUGH_WEB = 1.0), perpendicular
  // walls touch at the through wall's far face with zero volume overlap.
  const HALF_WEB = 0.5
  const offsetVotes: { x: number; z: number }[] = []
  for (const j of [startJunction, endJunction]) {
    if (j.kind === 'L-butt') {
      const dir = j.butt?.lateralOffsetDirection ?? j.peerBodyDirection
      const peerWeb = j.peerWebDepth_mm ?? j.butt?.trim_mm
      if (!dir || peerWeb == null) continue
      const mag = peerWeb * HALF_WEB
      offsetVotes.push({ x: dir.x * mag, z: dir.z * mag })
    } else if (j.kind === 'L-through') {
      const dir = j.peerBodyDirection
      const peerWeb = j.peerWebDepth_mm
      if (!dir || peerWeb == null) continue
      const mag = peerWeb * HALF_WEB
      offsetVotes.push({ x: dir.x * mag, z: dir.z * mag })
    }
  }
  let lateralOffsetX_mm = 0
  let lateralOffsetZ_mm = 0
  if (offsetVotes.length > 0) {
    for (const v of offsetVotes) {
      lateralOffsetX_mm += v.x
      lateralOffsetZ_mm += v.z
    }
    lateralOffsetX_mm /= offsetVotes.length
    lateralOffsetZ_mm /= offsetVotes.length
  }

  return {
    startTrim_mm: startJunction.butt?.trim_mm ?? 0,
    endTrim_mm: endJunction.butt?.trim_mm ?? 0,
    startJunction,
    endJunction,
    tPosts: dedupedTPosts,
    lateralOffsetX_mm,
    lateralOffsetZ_mm,
  }
}
