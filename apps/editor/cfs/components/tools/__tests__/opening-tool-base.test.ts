import { describe, expect, it } from 'bun:test'
import {
  DOOR_DEFAULTS,
  POSITION_SNAP_MM,
  WINDOW_DEFAULTS,
  buildOpeningPayload,
  placeOpeningOnWall,
  processToolClick,
} from '../lib/opening-tool-base'
import type { CFSOpeningId, CFSWallFramingId } from '@pascal-app/cfs'
import type { AnyNode } from '@pascal-app/core'

const ctx = {
  wallLength_m: 3.6,
  existingOpenings: [],
}

describe('placeOpeningOnWall — snapping', () => {
  it('snaps the left edge to the nearest 50 mm increment', () => {
    // Click centre at 1.063 m → 1063 mm; door width 900 → ideal left = 613 mm.
    // Round to 50 → 600.
    const r = placeOpeningOnWall({
      clickWallLocalX_m: 1.063,
      defaults: DOOR_DEFAULTS,
      context: ctx,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.positionAlongWall_mm % POSITION_SNAP_MM).toBe(0)
  })

  it('respects snapDisabled and returns the unsnapped left edge', () => {
    const r = placeOpeningOnWall({
      clickWallLocalX_m: 1.063,
      defaults: DOOR_DEFAULTS,
      context: ctx,
      snapDisabled: true,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // Ideal left edge in mm = 1063 - 450 = 613.
      expect(r.positionAlongWall_mm).toBeCloseTo(613, 1)
    }
  })
})

describe('placeOpeningOnWall — wall-bounds validation', () => {
  it('rejects placement that would extend past the wall start', () => {
    const r = placeOpeningOnWall({
      clickWallLocalX_m: 0.2, // centre at 200 mm → left at -250 mm
      defaults: DOOR_DEFAULTS,
      context: ctx,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('outside-wall')
  })

  it('rejects placement that would extend past the wall end', () => {
    const r = placeOpeningOnWall({
      clickWallLocalX_m: 3.5, // centre 3500 → left 3050 → right 3950 > 3600
      defaults: DOOR_DEFAULTS,
      context: ctx,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('outside-wall')
  })

  it('accepts placement that exactly fits at the start (left edge 0)', () => {
    // Centre at width/2 = 450 mm → 0.45 m. Snapped left = 0.
    const r = placeOpeningOnWall({
      clickWallLocalX_m: 0.45,
      defaults: DOOR_DEFAULTS,
      context: ctx,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.positionAlongWall_mm).toBe(0)
  })

  it('accepts placement that exactly fits at the end (right edge = wallLength)', () => {
    // Wall length 3600 mm. Right edge = 3600 → left = 2700. Centre = 3150 mm.
    const r = placeOpeningOnWall({
      clickWallLocalX_m: 3.15,
      defaults: DOOR_DEFAULTS,
      context: ctx,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.positionAlongWall_mm).toBe(2700)
  })
})

describe('placeOpeningOnWall — overlap rejection', () => {
  const withExisting = {
    wallLength_m: 5,
    existingOpenings: [{ positionAlongWall_mm: 600, width_mm: 900 }],
  }

  it('rejects placement that overlaps the existing opening', () => {
    // Click centre at 1.0 m → left 550 → right 1450, overlaps 600..1500.
    const r = placeOpeningOnWall({
      clickWallLocalX_m: 1.0,
      defaults: DOOR_DEFAULTS,
      context: withExisting,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('overlaps-existing')
  })

  it('accepts placement abutting the existing opening', () => {
    // Centre at 1.95 m → left 1500, exactly at the right edge of the existing
    // opening. Treat abutting as non-overlapping.
    const r = placeOpeningOnWall({
      clickWallLocalX_m: 1.95,
      defaults: DOOR_DEFAULTS,
      context: withExisting,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.positionAlongWall_mm).toBe(1500)
  })
})

describe('processToolClick — end-to-end', () => {
  const WALL_ID = 'wall_test_001'
  const FRAMING_ID = '00000000-0000-4000-8aaa-aaaaaaaaaaaa'
  const wall = {
    id: WALL_ID,
    start: [0, 0] as [number, number],
    end: [3.6, 0] as [number, number],
  }

  function nodes(extra: Record<string, AnyNode | undefined> = {}): Record<string, AnyNode | undefined> {
    return {
      [FRAMING_ID]: {
        type: 'cfs_wall_framing',
        id: FRAMING_ID,
        parentId: WALL_ID,
      } as unknown as AnyNode,
      ...extra,
    }
  }

  const generateId = () =>
    '11111111-1111-4111-8111-111111111111' as unknown as CFSOpeningId

  it('returns ok with a payload when click is on a wall that has a framing', () => {
    const result = processToolClick({
      nodes: nodes(),
      wall,
      clickWallLocalX_m: 1.0,
      openingType: 'door',
      defaults: DOOR_DEFAULTS,
      generateId,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload.openingType).toBe('door')
      expect(result.payload.parentId).toBe(FRAMING_ID)
    }
  })

  it('returns no-framing when the wall has no cfs_wall_framing child', () => {
    const result = processToolClick({
      nodes: { /* no framing */ },
      wall,
      clickWallLocalX_m: 1.0,
      openingType: 'door',
      defaults: DOOR_DEFAULTS,
      generateId,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('no-framing')
  })

  it('returns outside-wall when the click is too close to a wall end', () => {
    const result = processToolClick({
      nodes: nodes(),
      wall,
      clickWallLocalX_m: 0.1, // centre 100 → left -350 < 0
      openingType: 'door',
      defaults: DOOR_DEFAULTS,
      generateId,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('outside-wall')
  })

  it('returns overlaps-existing when an opening already covers the position', () => {
    const existingId = '99999999-9999-4999-8999-999999999999'
    const result = processToolClick({
      nodes: nodes({
        [existingId]: {
          type: 'cfs_opening',
          id: existingId,
          parentId: FRAMING_ID,
          openingType: 'door',
          positionAlongWall_mm: 600,
          roughDimensions: { width_mm: 900, height_mm: 2100 },
          headerTypeOverride: null,
          generatedMemberIds: [],
        } as unknown as AnyNode,
      }),
      wall,
      clickWallLocalX_m: 1.05, // overlaps 600..1500
      openingType: 'door',
      defaults: DOOR_DEFAULTS,
      generateId,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('overlaps-existing')
  })
})

describe('buildOpeningPayload', () => {
  it('builds a door payload without sillHeight_mm', () => {
    let i = 0
    const id = (): CFSOpeningId =>
      `00000000-0000-4000-8aaa-aaaaaaaaaaa${i++ % 16}` as unknown as CFSOpeningId
    const node = buildOpeningPayload({
      framingId: '11111111-1111-4111-8111-111111111111' as unknown as CFSWallFramingId,
      openingType: 'door',
      positionAlongWall_mm: 600,
      defaults: DOOR_DEFAULTS,
      generateId: id,
    })
    expect(node.openingType).toBe('door')
    expect(node.sillHeight_mm).toBeUndefined()
    expect(node.roughDimensions).toEqual({ width_mm: 900, height_mm: 2100 })
  })

  it('builds a window payload with sillHeight_mm = 900', () => {
    const node = buildOpeningPayload({
      framingId: '11111111-1111-4111-8111-111111111111' as unknown as CFSWallFramingId,
      openingType: 'window',
      positionAlongWall_mm: 600,
      defaults: WINDOW_DEFAULTS,
      generateId: () =>
        '22222222-2222-4222-8222-222222222222' as unknown as CFSOpeningId,
    })
    expect(node.openingType).toBe('window')
    expect(node.sillHeight_mm).toBe(900)
    expect(node.roughDimensions).toEqual({ width_mm: 900, height_mm: 1200 })
  })
})
