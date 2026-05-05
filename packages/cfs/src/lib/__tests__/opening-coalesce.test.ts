import { describe, expect, it } from 'bun:test'
import {
  coalesceOpenings,
  fieldStudExcluded,
  type OpeningFrameInput,
} from '../opening-coalesce'

const HALF_FLANGE = 20

function frame(id: string, ropLeft: number, width: number): OpeningFrameInput {
  return {
    openingId: id,
    ropLeftX_mm: ropLeft,
    ropRightX_mm: ropLeft + width,
    kingLeftX_mm: ropLeft - HALF_FLANGE,
    kingRightX_mm: ropLeft + width + HALF_FLANGE,
    jambLeftX_mm: ropLeft + HALF_FLANGE,
    jambRightX_mm: ropLeft + width - HALF_FLANGE,
  }
}

describe('coalesceOpenings — single opening, no edges, no sharing', () => {
  const result = coalesceOpenings({
    openings: [frame('o1', 600, 900)],
    wallLength_mm: 3600,
    studSpacing_mm: 600,
  })

  it('emits two solo kings flanking the rough opening', () => {
    expect(result.kings.length).toBe(2)
    expect(result.kings[0]!.x_mm).toBeCloseTo(600 - HALF_FLANGE, 6)
    expect(result.kings[1]!.x_mm).toBeCloseTo(1500 + HALF_FLANGE, 6)
    expect(result.kings[0]!.openingIds).toEqual(['o1'])
    expect(result.kings[1]!.openingIds).toEqual(['o1'])
  })

  it('emits two jambs labeled left/right', () => {
    expect(result.jambs.length).toBe(2)
    expect(result.jambs[0]!).toMatchObject({ openingId: 'o1', side: 'left' })
    expect(result.jambs[1]!).toMatchObject({ openingId: 'o1', side: 'right' })
  })

  it('does not promote either chord', () => {
    expect(result.promoteStartChordToKing).toBe(false)
    expect(result.promoteEndChordToKing).toBe(false)
  })
})

describe('coalesceOpenings — opening at wall start (rop_left = 0)', () => {
  const result = coalesceOpenings({
    openings: [frame('o1', 0, 900)],
    wallLength_mm: 3600,
    studSpacing_mm: 600,
  })

  it('drops the left king and promotes the start chord', () => {
    expect(result.promoteStartChordToKing).toBe(true)
    expect(result.kings.length).toBe(1)
    expect(result.kings[0]!.x_mm).toBeCloseTo(900 + HALF_FLANGE, 6)
  })

  it('does not promote the end chord', () => {
    expect(result.promoteEndChordToKing).toBe(false)
  })
})

describe('coalesceOpenings — opening at wall end', () => {
  const wallLength = 3600
  const width = 900
  const ropLeft = wallLength - width
  const result = coalesceOpenings({
    openings: [frame('o1', ropLeft, width)],
    wallLength_mm: wallLength,
    studSpacing_mm: 600,
  })

  it('drops the right king and promotes the end chord', () => {
    expect(result.promoteEndChordToKing).toBe(true)
    expect(result.promoteStartChordToKing).toBe(false)
    expect(result.kings.length).toBe(1)
    expect(result.kings[0]!.x_mm).toBeCloseTo(ropLeft - HALF_FLANGE, 6)
  })
})

describe('coalesceOpenings — shared king between adjacent openings', () => {
  it('collapses kings within studSpacing into one shared king at the midpoint', () => {
    // o1 right king at 1500 + 20 = 1520
    // o2 left king at 1900 - 20 = 1880
    // distance = 360 ≤ 600 spacing → share
    const result = coalesceOpenings({
      openings: [frame('o1', 600, 900), frame('o2', 1900, 900)],
      wallLength_mm: 4000,
      studSpacing_mm: 600,
    })
    expect(result.kings.length).toBe(3) // o1-left + shared + o2-right
    const shared = result.kings[1]!
    expect(shared.x_mm).toBeCloseTo((1520 + 1880) / 2, 6)
    expect(new Set(shared.openingIds)).toEqual(new Set(['o1', 'o2']))
  })

  it('does not collapse when distance exceeds studSpacing', () => {
    // o1 right king at 1520; o2 left king at 2300 - 20 = 2280; distance = 760 > 600 → no share.
    const result = coalesceOpenings({
      openings: [frame('o1', 600, 900), frame('o2', 2300, 900)],
      wallLength_mm: 4500,
      studSpacing_mm: 600,
    })
    expect(result.kings.length).toBe(4)
  })

  it('collapses at the boundary (distance == studSpacing)', () => {
    // Choose ropLefts so distance is exactly 600.
    // o1 right king at xR1; o2 left king at xL2 with xL2 - xR1 = 600.
    // o1 right king = 1500 + 20 = 1520, want o2 left king = 2120 → ropLeft2 = 2140.
    const result = coalesceOpenings({
      openings: [frame('o1', 600, 900), frame('o2', 2140, 900)],
      wallLength_mm: 5000,
      studSpacing_mm: 600,
    })
    expect(result.kings.length).toBe(3)
    expect(result.kings[1]!.openingIds).toEqual(['o1', 'o2'])
  })
})

describe('coalesceOpenings — three adjacent openings, mixed sharing', () => {
  it('shares A↔B, keeps C separate', () => {
    // A right king 1520; B left king 1880 (share); B right king at ?
    // B is from ropLeft 1900 width 900 → ropRight 2800 → kingRight 2820
    // C from ropLeft 4000 → kingLeft 3980. distance from B-right (2820) to C-left (3980) = 1160 > 600
    const result = coalesceOpenings({
      openings: [frame('A', 600, 900), frame('B', 1900, 900), frame('C', 4000, 900)],
      wallLength_mm: 5500,
      studSpacing_mm: 600,
    })
    // Expect: A-left + shared(A,B) + B-right + C-left + C-right = 5
    expect(result.kings.length).toBe(5)
    expect(result.kings[1]!.openingIds.sort()).toEqual(['A', 'B'])
    expect(result.kings[3]!.openingIds).toEqual(['C'])
  })
})

describe('fieldStudExcluded', () => {
  it('returns true for a candidate inside any range', () => {
    expect(
      fieldStudExcluded(700, [{ startX_mm: 580, endX_mm: 1520 }]),
    ).toBe(true)
  })
  it('returns true for a candidate exactly at a range boundary (within tolerance)', () => {
    expect(
      fieldStudExcluded(580, [{ startX_mm: 580, endX_mm: 1520 }]),
    ).toBe(true)
    expect(
      fieldStudExcluded(1520, [{ startX_mm: 580, endX_mm: 1520 }]),
    ).toBe(true)
  })
  it('returns false for a candidate outside every range', () => {
    expect(
      fieldStudExcluded(2000, [{ startX_mm: 580, endX_mm: 1520 }]),
    ).toBe(false)
  })
  it('returns true if any of multiple ranges contains the candidate', () => {
    expect(
      fieldStudExcluded(2300, [
        { startX_mm: 580, endX_mm: 1520 },
        { startX_mm: 2280, endX_mm: 3220 },
      ]),
    ).toBe(true)
  })
})
