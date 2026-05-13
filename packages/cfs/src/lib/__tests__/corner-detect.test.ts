import { describe, expect, it } from 'bun:test'
import {
  CHORD_ELEVATION_TOLERANCE_MM,
  CHORD_PLAN_TOLERANCE_MM,
  isCornerOwned,
  wallDirection,
} from '../corner-detect'

const origin = { x_mm: 0, y_mm: 0, z_mm: 0 }
const east = { x: 1, z: 0 } // wall running along +x
const north = { x: 0, z: 1 } // wall running along +z (perpendicular to east)
const westReversed = { x: -1, z: 0 } // east antiparallel — still "same axis"

describe('isCornerOwned', () => {
  it('framing with no peers always owns its chord', () => {
    expect(isCornerOwned('a', origin, east, [])).toBe(true)
  })

  it('two collinear walls sharing an endpoint: smaller id wins', () => {
    const peer = { framingId: 'b', position: origin, direction: east }
    expect(isCornerOwned('a', origin, east, [peer])).toBe(true)
    expect(
      isCornerOwned('b', origin, east, [
        { framingId: 'a', position: origin, direction: east },
      ]),
    ).toBe(false)
  })

  it('perpendicular walls at an L-corner each keep their own chord (doubled)', () => {
    // east-running wall and north-running wall meeting at origin.
    // Neither should lose its chord — that is the doubled-chord configuration.
    const peer = { framingId: 'a', position: origin, direction: north }
    expect(isCornerOwned('z', origin, east, [peer])).toBe(true)
  })

  it('antiparallel walls (drawn in opposite directions) still merge', () => {
    // Same physical wall axis, drawn east vs. west. Should merge.
    const peer = { framingId: 'a', position: origin, direction: westReversed }
    expect(isCornerOwned('z', origin, east, [peer])).toBe(false)
  })

  it('peer at a different plan position does not affect ownership', () => {
    const peer = {
      framingId: 'a',
      position: { x_mm: 5000, y_mm: 0, z_mm: 0 },
      direction: east,
    }
    expect(isCornerOwned('z', origin, east, [peer])).toBe(true)
  })

  it('peers within plan tolerance and same direction merge', () => {
    const peer = {
      framingId: 'a',
      position: { x_mm: 50, y_mm: 0, z_mm: 0 },
      direction: east,
    }
    expect(isCornerOwned('z', origin, east, [peer])).toBe(false)
  })

  it('peers just past the plan tolerance are NOT the same corner', () => {
    const peer = {
      framingId: 'a',
      position: {
        x_mm: CHORD_PLAN_TOLERANCE_MM + 10,
        y_mm: 0,
        z_mm: 0,
      },
      direction: east,
    }
    expect(isCornerOwned('z', origin, east, [peer])).toBe(true)
  })

  it('peers on a different LEVEL (different y) do not steal corner ownership', () => {
    const peerOnLevelAbove = {
      framingId: 'a',
      position: { x_mm: 0, y_mm: 2700, z_mm: 0 },
      direction: east,
    }
    expect(isCornerOwned('z', origin, east, [peerOnLevelAbove])).toBe(true)
  })

  it('y-axis match still requires the elevation tolerance to hold', () => {
    const peer = {
      framingId: 'a',
      position: {
        x_mm: 0,
        y_mm: CHORD_ELEVATION_TOLERANCE_MM,
        z_mm: 0,
      },
      direction: east,
    }
    expect(isCornerOwned('z', origin, east, [peer])).toBe(false)
  })

  it('T-junction: parallel split-walls merge, perpendicular wall stays separate', () => {
    // Two collinear stem walls meet at the T point, plus a perpendicular cap.
    // Only the smaller-id stem wins; the cap keeps its own chord.
    const stemA = { framingId: 'a', position: origin, direction: north }
    const stemB = { framingId: 'b', position: origin, direction: north }
    // Cap perpendicular to the stems — keeps its own chord.
    expect(isCornerOwned('cap', origin, east, [stemA, stemB])).toBe(true)
    // Stem b loses to stem a (smaller id).
    expect(isCornerOwned('b', origin, north, [stemA])).toBe(false)
  })

  it('three-way perpendicular intersection: each direction independent', () => {
    // The cap (east) keeps its chord regardless of stems (north).
    const stems = [
      { framingId: 'a', position: origin, direction: north },
      { framingId: 'b', position: origin, direction: north },
    ]
    expect(isCornerOwned('z-cap', origin, east, stems)).toBe(true)
  })
})

describe('wallDirection', () => {
  it('returns unit vector from start to end in (x, z)', () => {
    const d = wallDirection({ start: [0, 0], end: [3, 0] })
    expect(d.x).toBeCloseTo(1)
    expect(d.z).toBeCloseTo(0)
  })

  it('handles diagonal walls', () => {
    const d = wallDirection({ start: [0, 0], end: [3, 4] })
    expect(d.x).toBeCloseTo(0.6)
    expect(d.z).toBeCloseTo(0.8)
  })

  it('returns a default unit vector for zero-length walls', () => {
    const d = wallDirection({ start: [1, 1], end: [1, 1] })
    expect(d.x).toBe(1)
    expect(d.z).toBe(0)
  })
})
