/**
 * Stud-role coalescing for opening framing (§1.4).
 *
 * Takes the per-opening "rough" king/jamb x-positions computed by the layout
 * pass (kings are placed half a flange outboard of the rough opening edge,
 * jambs are placed half a flange inboard), and applies:
 *
 *   1. Shared-king collapse: if two adjacent openings have kings whose
 *      distance is ≤ `studSpacing_mm`, they collapse to a single king at the
 *      midpoint. Both openings reference that king.
 *   2. Edge collapse: if a king position lies at or past the wall start (≤ 0)
 *      or at or past the wall end (≥ wallLength), the king is dropped and the
 *      chord at that wall end is promoted from `chord-stud` to `king-stud`.
 *
 * Field-stud removal ranges are also returned so the layout pass can filter
 * the field-stud candidate list. Each range is [startX, endX] inclusive in
 * wall-local x-mm.
 */

const EDGE_EPSILON_MM = 1
const SHARING_EPSILON_MM = 1e-3

export interface OpeningFrameInput {
  /** Stable opening id (used so the layout can track which kings belong to which opening). */
  openingId: string
  /** Wall-local x of the rough opening's left edge. */
  ropLeftX_mm: number
  /** Wall-local x of the rough opening's right edge. */
  ropRightX_mm: number
  /** King x outboard of the rough left edge (= ropLeftX - half-flange). */
  kingLeftX_mm: number
  /** King x outboard of the rough right edge (= ropRightX + half-flange). */
  kingRightX_mm: number
  /** Jamb x just inside the rough opening on the left (= ropLeftX + half-flange). */
  jambLeftX_mm: number
  /** Jamb x just inside the rough opening on the right (= ropRightX - half-flange). */
  jambRightX_mm: number
}

export interface CoalescedKing {
  x_mm: number
  /** All opening ids that share this king. Length 1 for solo kings; ≥2 for shared kings. */
  openingIds: string[]
}

export interface CoalescedJamb {
  openingId: string
  /** Side of the opening this jamb is on. Useful for cripple bookkeeping. */
  side: 'left' | 'right'
  x_mm: number
}

export interface FieldStudExclusionRange {
  startX_mm: number
  endX_mm: number
}

export interface CoalesceResult {
  kings: CoalescedKing[]
  jambs: CoalescedJamb[]
  /**
   * If a left king was dropped onto the wall start, the chord at x=0 should be
   * emitted with role `king-stud` instead of `chord-stud`. The chord position
   * itself is unchanged.
   */
  promoteStartChordToKing: boolean
  /**
   * Same for the wall-end chord at x=wallLength.
   */
  promoteEndChordToKing: boolean
  /** Field-stud candidate positions falling in any of these ranges are removed. */
  fieldStudExclusionRanges: FieldStudExclusionRange[]
}

export interface CoalesceInput {
  /** Sorted by ropLeftX_mm ascending. The function does not re-sort. */
  openings: OpeningFrameInput[]
  wallLength_mm: number
  studSpacing_mm: number
}

export function coalesceOpenings(input: CoalesceInput): CoalesceResult {
  const { openings, wallLength_mm, studSpacing_mm } = input

  const kings: CoalescedKing[] = []
  const jambs: CoalescedJamb[] = []
  let promoteStartChordToKing = false
  let promoteEndChordToKing = false

  // Pre-compute a "left king" entry per opening, then walk them and merge
  // adjacent left/right pairs that fall within the sharing threshold.
  // We track each king as it's emitted so we can attach further opening ids
  // when a subsequent opening's left king collapses into the prior right king.

  let prevRightKingIndex: number | null = null

  for (let i = 0; i < openings.length; i += 1) {
    const op = openings[i]!

    // Left king: drop if at/past wall start; promote start chord instead.
    if (op.kingLeftX_mm <= EDGE_EPSILON_MM) {
      promoteStartChordToKing = true
    } else if (
      prevRightKingIndex !== null &&
      op.kingLeftX_mm - kings[prevRightKingIndex]!.x_mm <= studSpacing_mm + SHARING_EPSILON_MM
    ) {
      // Shared with previous opening's right king. Move the existing king to the
      // midpoint of the two and add this opening to its membership.
      const existing = kings[prevRightKingIndex]!
      const midpoint = (existing.x_mm + op.kingLeftX_mm) / 2
      existing.x_mm = midpoint
      existing.openingIds.push(op.openingId)
    } else {
      kings.push({ x_mm: op.kingLeftX_mm, openingIds: [op.openingId] })
    }

    // Right king: drop if at/past wall end; promote end chord instead.
    if (op.kingRightX_mm >= wallLength_mm - EDGE_EPSILON_MM) {
      promoteEndChordToKing = true
      prevRightKingIndex = null
    } else {
      kings.push({ x_mm: op.kingRightX_mm, openingIds: [op.openingId] })
      prevRightKingIndex = kings.length - 1
    }

    jambs.push({ openingId: op.openingId, side: 'left', x_mm: op.jambLeftX_mm })
    jambs.push({ openingId: op.openingId, side: 'right', x_mm: op.jambRightX_mm })
  }

  // Field-stud exclusion: anything inside a king-or-jamb zone for an opening.
  // The simplest correct rule is to forbid field studs anywhere between the
  // king-left and king-right of every opening. After coalescing, kings may be
  // shared; field-stud removal still uses the per-opening original ranges.
  const fieldStudExclusionRanges: FieldStudExclusionRange[] = openings.map((op) => ({
    startX_mm: op.kingLeftX_mm,
    endX_mm: op.kingRightX_mm,
  }))

  return {
    kings,
    jambs,
    promoteStartChordToKing,
    promoteEndChordToKing,
    fieldStudExclusionRanges,
  }
}

/**
 * Returns true when a candidate field-stud position falls inside any
 * exclusion range. Tolerant by `EDGE_EPSILON_MM` on each side so a stud
 * exactly at the king position counts as excluded.
 */
export function fieldStudExcluded(
  candidateX_mm: number,
  ranges: ReadonlyArray<FieldStudExclusionRange>,
): boolean {
  for (const r of ranges) {
    if (
      candidateX_mm >= r.startX_mm - EDGE_EPSILON_MM &&
      candidateX_mm <= r.endX_mm + EDGE_EPSILON_MM
    ) {
      return true
    }
  }
  return false
}
