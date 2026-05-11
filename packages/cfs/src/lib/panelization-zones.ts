import type { CFSMember } from '../schema/cfs-member'
import type { CFSOpening } from '../schema/cfs-opening'
import type { CFSSection } from '../schema/cfs-member-library'
import { cfsMemberLength_mm } from '../schema/cfs-member'
import type { PascalWallLike } from './wall-frame'
import { wallLengthFromPascalWall } from './wall-frame'

const M_TO_MM = 1000

/** Closed interval along the wall in mm. start ≤ end. */
export interface Interval {
  start_mm: number
  end_mm: number
}

/**
 * Project a world-coordinate point onto the wall's local x-axis. Used by
 * panelization to ask "at what along-wall position is this member's
 * midpoint?" — independent of how the member was placed in world space.
 *
 * Pascal walls live in level-coordinates (x, z); y is vertical. The wall's
 * along-axis runs from `start` to `end` in mm. A point not exactly on the
 * wall line is projected perpendicularly; this is intentional for members
 * whose offsets from the wall centerline are larger than zero (e.g.,
 * jamb studs that sit a flange-width inside the king).
 */
export function worldPointToWallLocalX_mm(
  point: { x_mm: number; z_mm: number },
  wall: PascalWallLike,
): number {
  const length_mm = wallLengthFromPascalWall(wall)
  if (length_mm === 0) return 0
  const dx_mm = (wall.end[0] - wall.start[0]) * M_TO_MM
  const dz_mm = (wall.end[1] - wall.start[1]) * M_TO_MM
  const ux = dx_mm / length_mm
  const uz = dz_mm / length_mm
  const px = point.x_mm - wall.start[0] * M_TO_MM
  const pz = point.z_mm - wall.start[1] * M_TO_MM
  return px * ux + pz * uz
}

/** Member midpoint projected onto the wall's local x-axis. */
export function memberMidAlongWall_mm(
  member: CFSMember,
  wall: PascalWallLike,
): number {
  const midX = (member.start.x_mm + member.end.x_mm) / 2
  const midZ = (member.start.z_mm + member.end.z_mm) / 2
  return worldPointToWallLocalX_mm({ x_mm: midX, z_mm: midZ }, wall)
}

/**
 * Compute the union of forbidden break zones along a wall. Zones come from:
 *
 *   FZ-OPEN:         opening span ± king-flange buffer on each side.
 *   FZ-CORNER-START: [0, defaultStudSpacing] at the wall start.
 *   FZ-CORNER-END:   [wallLength - defaultStudSpacing, wallLength] at the
 *                    wall end.
 *
 * Returned intervals are sorted by start_mm and merged so overlapping
 * zones become one interval. The greedy break-walk algorithm uses this
 * merged set to find the latest non-forbidden position.
 *
 * §5.5 + §1.6.
 */
export function computeForbiddenZones(
  openings: readonly CFSOpening[],
  wallLength_mm: number,
  kingFlangeWidth_mm: number,
  defaultStudSpacing_mm: number,
): Interval[] {
  const zones: Interval[] = []

  for (const o of openings) {
    const start = Math.max(0, o.positionAlongWall_mm - kingFlangeWidth_mm)
    const end = Math.min(
      wallLength_mm,
      o.positionAlongWall_mm + o.roughDimensions.width_mm + kingFlangeWidth_mm,
    )
    if (end > start) zones.push({ start_mm: start, end_mm: end })
  }

  // Corner clearance — one stud spacing at each wall end.
  if (defaultStudSpacing_mm > 0 && wallLength_mm > 0) {
    zones.push({
      start_mm: 0,
      end_mm: Math.min(defaultStudSpacing_mm, wallLength_mm),
    })
    zones.push({
      start_mm: Math.max(0, wallLength_mm - defaultStudSpacing_mm),
      end_mm: wallLength_mm,
    })
  }

  return mergeIntervals(zones)
}

/**
 * Sort and merge a set of intervals so the result has no overlaps and is
 * monotonically increasing in start_mm. Adjacent intervals (touch at a
 * single point) are merged too.
 */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  if (intervals.length === 0) return []
  const sorted = [...intervals].sort((a, b) => a.start_mm - b.start_mm)
  const out: Interval[] = []
  let curr = { ...sorted[0]! }
  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i]!
    if (next.start_mm <= curr.end_mm) {
      curr.end_mm = Math.max(curr.end_mm, next.end_mm)
    } else {
      out.push(curr)
      curr = { ...next }
    }
  }
  out.push(curr)
  return out
}

/** True if x falls inside any forbidden zone (closed intervals). */
export function isInForbiddenZone(x_mm: number, zones: readonly Interval[]): boolean {
  for (const z of zones) {
    if (x_mm >= z.start_mm && x_mm <= z.end_mm) return true
  }
  return false
}

/**
 * Find the latest non-forbidden position in [floor_mm, ceiling_mm]. Used by
 * the greedy break-walk: when the cumulative budget says "break before
 * member at x", we need the rightmost x in [lastSafeBreak, x] that isn't
 * inside a forbidden zone. Returns null if every position in the range is
 * forbidden — caller throws PanelizationError.
 *
 * Strategy: walk zones in reverse from the rightmost zone that starts ≤
 * ceiling; if `ceiling` itself isn't forbidden, return it; otherwise return
 * `min(floor, zone.start_mm)` of the zone covering `ceiling` (i.e., snap to
 * just before the zone). Iterate left until either the candidate is ≥
 * floor or we've exhausted zones.
 */
export function latestNonForbiddenPositionBefore(
  ceiling_mm: number,
  floor_mm: number,
  zones: readonly Interval[],
): number | null {
  if (ceiling_mm < floor_mm) return null
  let candidate = ceiling_mm
  // Sort zones descending by end_mm so we walk right-to-left.
  const desc = [...zones].sort((a, b) => b.end_mm - a.end_mm)
  for (const z of desc) {
    if (z.start_mm > candidate) continue // entirely above candidate; skip
    if (z.end_mm < floor_mm) break // entirely below floor; stop walking
    if (candidate < z.start_mm) continue // landed below this zone already
    if (candidate >= z.start_mm && candidate <= z.end_mm) {
      // Hop just below the zone's start; if that lands below floor, fail.
      candidate = z.start_mm - 0.001
    }
  }
  if (candidate < floor_mm) return null
  return candidate
}

/**
 * Snap a candidate break position to the nearest multiple of `spacing_mm`
 * that still falls inside [floor_mm, ceiling_mm]. If no multiple fits, the
 * unsnapped candidate is returned. Per §5.5: "prefer breaks closer to a
 * stud spacing multiple."
 */
export function snapToStudSpacing(
  candidate_mm: number,
  spacing_mm: number,
  floor_mm: number,
  ceiling_mm: number,
): number {
  if (spacing_mm <= 0) return candidate_mm
  const nearestMultiple = Math.round(candidate_mm / spacing_mm) * spacing_mm
  if (nearestMultiple >= floor_mm && nearestMultiple <= ceiling_mm) {
    return nearestMultiple
  }
  // Try the floor and ceiling of the multiple as fallbacks within bounds.
  const floorMultiple = Math.floor(candidate_mm / spacing_mm) * spacing_mm
  if (floorMultiple >= floor_mm && floorMultiple <= ceiling_mm) {
    return floorMultiple
  }
  return candidate_mm
}

/**
 * King-stud flange width from a section, with a v1 fallback. The
 * forbidden-zone buffer around an opening uses this so a break can't fall
 * within the structural king/jamb cluster.
 */
export function kingFlangeBuffer_mm(studSection: CFSSection | null): number {
  if (!studSection) return 0
  return studSection.properties.flangeWidth_mm
}

/** Linear mass × length lookup for a single member, in kg. Returns 0 if the
 * section is missing from the library — caller decides whether that's
 * tolerable. */
export function memberWeight_kg(
  member: CFSMember,
  sectionsById: ReadonlyMap<string, CFSSection>,
): number {
  const section = sectionsById.get(member.sectionId)
  if (!section) return 0
  return (cfsMemberLength_mm(member) / M_TO_MM) * section.linearMass_kgPerM
}
