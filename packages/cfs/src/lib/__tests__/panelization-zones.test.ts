import { describe, expect, it } from 'bun:test'
import {
  computeForbiddenZones,
  isInForbiddenZone,
  latestNonForbiddenPositionBefore,
  mergeIntervals,
  snapToStudSpacing,
} from '../panelization-zones'
import type { CFSOpening } from '../../schema/cfs-opening'

const FRAMING = '22222222-2222-4222-a222-222222222222'

function opening(positionAlongWall_mm: number, width_mm: number): CFSOpening {
  return {
    type: 'cfs_opening',
    id: `op-${positionAlongWall_mm}-${width_mm}` as unknown as CFSOpening['id'],
    parentId: FRAMING as unknown as CFSOpening['parentId'],
    openingType: 'window',
    positionAlongWall_mm,
    roughDimensions: { width_mm, height_mm: 1500 },
    sillHeight_mm: 900,
    headerTypeOverride: null,
    generatedMemberIds: [],
  }
}

describe('mergeIntervals', () => {
  it('returns empty for empty input', () => {
    expect(mergeIntervals([])).toEqual([])
  })

  it('merges overlapping intervals', () => {
    const out = mergeIntervals([
      { start_mm: 100, end_mm: 500 },
      { start_mm: 200, end_mm: 400 },
      { start_mm: 600, end_mm: 700 },
    ])
    expect(out).toEqual([
      { start_mm: 100, end_mm: 500 },
      { start_mm: 600, end_mm: 700 },
    ])
  })

  it('merges adjacent (touching) intervals', () => {
    const out = mergeIntervals([
      { start_mm: 0, end_mm: 100 },
      { start_mm: 100, end_mm: 200 },
    ])
    expect(out).toEqual([{ start_mm: 0, end_mm: 200 }])
  })
})

describe('computeForbiddenZones', () => {
  it('returns just the two corner zones when there are no openings', () => {
    const zones = computeForbiddenZones([], 12000, 41, 600)
    expect(zones).toEqual([
      { start_mm: 0, end_mm: 600 },
      { start_mm: 11400, end_mm: 12000 },
    ])
  })

  it('emits an opening zone with king-flange buffer on each side', () => {
    const zones = computeForbiddenZones([opening(3000, 900)], 12000, 41, 0)
    expect(zones).toEqual([{ start_mm: 2959, end_mm: 3941 }])
  })

  it('merges an opening zone with the start corner if they overlap', () => {
    const zones = computeForbiddenZones([opening(200, 900)], 6000, 41, 600)
    // start corner [0, 600] + opening [159, 1141] → merges to [0, 1141]
    expect(zones[0]).toEqual({ start_mm: 0, end_mm: 1141 })
  })
})

describe('isInForbiddenZone', () => {
  it('returns true on the inclusive boundary', () => {
    const zones = [{ start_mm: 100, end_mm: 200 }]
    expect(isInForbiddenZone(100, zones)).toBe(true)
    expect(isInForbiddenZone(200, zones)).toBe(true)
    expect(isInForbiddenZone(150, zones)).toBe(true)
  })

  it('returns false outside', () => {
    const zones = [{ start_mm: 100, end_mm: 200 }]
    expect(isInForbiddenZone(99, zones)).toBe(false)
    expect(isInForbiddenZone(201, zones)).toBe(false)
  })
})

describe('latestNonForbiddenPositionBefore', () => {
  it('returns the ceiling when nothing forbids it', () => {
    const out = latestNonForbiddenPositionBefore(4000, 1000, [])
    expect(out).toBe(4000)
  })

  it('walks back to just before a covering zone', () => {
    const zones = [{ start_mm: 3500, end_mm: 4500 }]
    const out = latestNonForbiddenPositionBefore(4000, 1000, zones)
    // ceiling 4000 is inside the zone → hop to 3500 - 0.001
    expect(out).toBeLessThan(3500)
    expect(out).toBeGreaterThan(3499)
  })

  it('returns null when the floor..ceiling range is fully forbidden', () => {
    const zones = [{ start_mm: 100, end_mm: 5000 }]
    const out = latestNonForbiddenPositionBefore(4000, 1000, zones)
    expect(out).toBeNull()
  })

  it('handles two stacked zones by hopping past each', () => {
    const zones = [
      { start_mm: 1500, end_mm: 2500 },
      { start_mm: 3500, end_mm: 4500 },
    ]
    const out = latestNonForbiddenPositionBefore(4000, 1000, zones)
    // Ceiling falls in the upper zone → hop to 3500 - 0.001 = 3499.999.
    // That is above the lower zone, so the candidate is valid.
    expect(out).toBeLessThan(3500)
    expect(out).toBeGreaterThan(2500)
  })
})

describe('snapToStudSpacing', () => {
  it('snaps to the nearest spacing multiple inside bounds', () => {
    expect(snapToStudSpacing(2950, 600, 2400, 3000)).toBe(3000)
    expect(snapToStudSpacing(2500, 600, 2400, 3000)).toBe(2400) // 2500 rounds to 2400
  })

  it('returns the unsnapped value when no multiple fits in bounds', () => {
    // Multiples of 600 near 2700 are 2400 and 3000. If bounds exclude both:
    expect(snapToStudSpacing(2700, 600, 2500, 2900)).toBe(2700)
  })

  it('returns the candidate when spacing is non-positive', () => {
    expect(snapToStudSpacing(1234, 0, 0, 10_000)).toBe(1234)
  })
})
