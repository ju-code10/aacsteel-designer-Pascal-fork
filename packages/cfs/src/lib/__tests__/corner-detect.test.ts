import { describe, expect, it } from 'bun:test'
import {
  CHORD_ELEVATION_TOLERANCE_MM,
  CHORD_PLAN_TOLERANCE_MM,
  isCornerOwned,
} from '../corner-detect'

const origin = { x_mm: 0, y_mm: 0, z_mm: 0 }

describe('corner-detect', () => {
  it('framing with no peers always owns its chord', () => {
    expect(isCornerOwned('a', origin, [])).toBe(true)
  })

  it('two framings sharing a corner: lexicographically smaller id wins', () => {
    const peer = { framingId: 'b', position: origin }
    expect(isCornerOwned('a', origin, [peer])).toBe(true)
    expect(
      isCornerOwned('b', origin, [{ framingId: 'a', position: origin }]),
    ).toBe(false)
  })

  it('peer at a different plan position does not affect ownership', () => {
    const peer = {
      framingId: 'a',
      position: { x_mm: 5000, y_mm: 0, z_mm: 0 },
    }
    expect(isCornerOwned('z', origin, [peer])).toBe(true)
  })

  it('peers within the plan tolerance count as the same corner', () => {
    // 100 mm tolerance — a peer 50 mm off in plan still coincides, so the
    // smaller id wins and the larger id loses.
    const peer = {
      framingId: 'a',
      position: { x_mm: 50, y_mm: 0, z_mm: 0 },
    }
    expect(isCornerOwned('z', origin, [peer])).toBe(false)
  })

  it('peers just past the plan tolerance are NOT the same corner', () => {
    const peer = {
      framingId: 'a',
      position: {
        x_mm: CHORD_PLAN_TOLERANCE_MM + 10,
        y_mm: 0,
        z_mm: 0,
      },
    }
    expect(isCornerOwned('z', origin, [peer])).toBe(true)
  })

  it('peers on a different LEVEL (different y) do not steal corner ownership', () => {
    // Two walls stacked on different levels at the same plan position.
    // Per the level-elevation memory-note carry-forward, this previously
    // false-merged in 2-D corner detection; now y separates them.
    const peerOnLevelAbove = {
      framingId: 'a',
      position: { x_mm: 0, y_mm: 2700, z_mm: 0 },
    }
    expect(isCornerOwned('z', origin, [peerOnLevelAbove])).toBe(true)
  })

  it('y-axis match still requires the elevation tolerance to hold', () => {
    // Walls "on the same level" — y differs by less than 1 mm — still
    // coincide and the smaller-id rule applies.
    const peer = {
      framingId: 'a',
      position: {
        x_mm: 0,
        y_mm: CHORD_ELEVATION_TOLERANCE_MM,
        z_mm: 0,
      },
    }
    expect(isCornerOwned('z', origin, [peer])).toBe(false)
  })

  it('three-way intersection picks the smallest of the three', () => {
    const peers = [
      { framingId: 'b', position: origin },
      { framingId: 'c', position: origin },
    ]
    expect(isCornerOwned('a', origin, peers)).toBe(true)
    expect(
      isCornerOwned('b', origin, [
        { framingId: 'a', position: origin },
        { framingId: 'c', position: origin },
      ]),
    ).toBe(false)
  })
})
