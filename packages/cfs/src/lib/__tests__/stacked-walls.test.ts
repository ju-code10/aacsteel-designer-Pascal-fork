import { describe, expect, it } from 'bun:test'
import type { SceneLike } from '../scene-walk'
import type { PascalWallLike } from '../wall-frame'
import { getInheritedStudPositions_mm } from '../stacked-walls'

const DEFAULT_SPACING_MM = 600

/**
 * Build a two-level scene: level 0 has wall `w0` (3.6 m, framed with
 * 600 mm spacing), level 1 has wall `w1` whose start/end the caller
 * chooses. This is the canonical multi-story test fixture.
 */
function twoLevelScene(opts: {
  w0Start: [number, number]
  w0End: [number, number]
  w1Start: [number, number]
  w1End: [number, number]
  w0FramingSpacing_mm?: number
  includeW0Framing?: boolean
}): SceneLike {
  const includeFraming = opts.includeW0Framing ?? true
  return {
    nodes: {
      bldg: { type: 'building', id: 'bldg', parentId: null, children: ['lv0', 'lv1'] },
      lv0: {
        type: 'level',
        id: 'lv0',
        parentId: 'bldg',
        level: 0,
        children: ['w0'],
      },
      w0: {
        type: 'wall',
        id: 'w0',
        parentId: 'lv0',
        start: opts.w0Start,
        end: opts.w0End,
        height: 2.7,
        children: includeFraming ? ['f0'] : [],
      },
      ...(includeFraming
        ? {
            f0: {
              type: 'cfs_wall_framing',
              id: 'f0',
              parentId: 'w0',
              studSpacing_mm: opts.w0FramingSpacing_mm ?? null,
            },
          }
        : {}),
      lv1: {
        type: 'level',
        id: 'lv1',
        parentId: 'bldg',
        level: 1,
        children: ['w1'],
      },
      w1: {
        type: 'wall',
        id: 'w1',
        parentId: 'lv1',
        start: opts.w1Start,
        end: opts.w1End,
        height: 2.7,
      },
    },
  }
}

function wall(id: string, start: [number, number], end: [number, number]): PascalWallLike {
  return { id, start, end }
}

describe('getInheritedStudPositions_mm', () => {
  it('returns null on a ground-level wall (no level below)', () => {
    const scene = twoLevelScene({
      w0Start: [0, 0],
      w0End: [3.6, 0],
      w1Start: [0, 0],
      w1End: [3.6, 0],
    })
    const result = getInheritedStudPositions_mm(
      scene,
      wall('w0', [0, 0], [3.6, 0]),
      DEFAULT_SPACING_MM,
    )
    expect(result).toBeNull()
  })

  it('inherits the lower wall\'s stud positions when start/end match exactly', () => {
    const scene = twoLevelScene({
      w0Start: [0, 0],
      w0End: [3.6, 0],
      w1Start: [0, 0],
      w1End: [3.6, 0],
    })
    const result = getInheritedStudPositions_mm(
      scene,
      wall('w1', [0, 0], [3.6, 0]),
      DEFAULT_SPACING_MM,
    )
    // 3.6 m wall at 600 mm spacing: candidates at 600, 1200, 1800, 2400, 3000
    // (3600 - 3000 = 600 > half=300, so last is kept)
    expect(result).toEqual([600, 1200, 1800, 2400, 3000])
  })

  it('translates positions when upper wall is offset by 50 mm along the wall direction', () => {
    // Lower wall: 3.6 m at x = 0..3.6. Upper wall: 3.6 m at x = 0.05..3.65.
    // Lower studs are at world x = 0.6, 1.2, 1.8, 2.4, 3.0.
    // In upper wall's local frame those become x = 0.55, 1.15, 1.75, 2.35, 2.95.
    const scene = twoLevelScene({
      w0Start: [0, 0],
      w0End: [3.6, 0],
      w1Start: [0.05, 0],
      w1End: [3.65, 0],
    })
    const result = getInheritedStudPositions_mm(
      scene,
      wall('w1', [0.05, 0], [3.65, 0]),
      DEFAULT_SPACING_MM,
    )
    expect(result).toEqual([550, 1150, 1750, 2350, 2950])
  })

  it('returns null when the upper wall is too far from any lower wall (>100 mm)', () => {
    const scene = twoLevelScene({
      w0Start: [0, 0],
      w0End: [3.6, 0],
      w1Start: [5.0, 0], // 5 m away — clearly a different wall
      w1End: [8.6, 0],
    })
    const result = getInheritedStudPositions_mm(
      scene,
      wall('w1', [5.0, 0], [8.6, 0]),
      DEFAULT_SPACING_MM,
    )
    expect(result).toBeNull()
  })

  it('handles a reversed lower wall (start↔end swapped)', () => {
    // Lower wall drawn right-to-left (3.6→0), upper left-to-right (0→3.6).
    // Same physical footprint. Studs should still align.
    const scene = twoLevelScene({
      w0Start: [3.6, 0],
      w0End: [0, 0],
      w1Start: [0, 0],
      w1End: [3.6, 0],
    })
    const result = getInheritedStudPositions_mm(
      scene,
      wall('w1', [0, 0], [3.6, 0]),
      DEFAULT_SPACING_MM,
    )
    // Lower's stud positions (measured from its start at world x=3.6):
    // 600, 1200, 1800, 2400, 3000 mm — i.e., world x = 3.0, 2.4, 1.8, 1.2, 0.6.
    // In upper wall's local frame those land at the same world x values:
    // 600, 1200, 1800, 2400, 3000 (just collected in reverse order).
    expect(result?.slice().sort((a, b) => a - b)).toEqual([600, 1200, 1800, 2400, 3000])
  })

  it('uses the lower wall\'s framing spacing when set', () => {
    // Lower wall has explicit 400 mm spacing. Upper should inherit that grid.
    const scene = twoLevelScene({
      w0Start: [0, 0],
      w0End: [3.6, 0],
      w1Start: [0, 0],
      w1End: [3.6, 0],
      w0FramingSpacing_mm: 400,
    })
    const result = getInheritedStudPositions_mm(
      scene,
      wall('w1', [0, 0], [3.6, 0]),
      DEFAULT_SPACING_MM, // 600 — but we expect 400 since lower overrides
    )
    // 3.6 m at 400: candidates 400, 800, ..., 3200; 3600-3200=400 > half=200,
    // so 3200 is kept. Total 8 studs.
    expect(result).toEqual([400, 800, 1200, 1600, 2000, 2400, 2800, 3200])
  })

  it('falls back to defaultSpacing when the lower wall has no framing', () => {
    const scene = twoLevelScene({
      w0Start: [0, 0],
      w0End: [3.6, 0],
      w1Start: [0, 0],
      w1End: [3.6, 0],
      includeW0Framing: false,
    })
    const result = getInheritedStudPositions_mm(
      scene,
      wall('w1', [0, 0], [3.6, 0]),
      400,
    )
    expect(result).toEqual([400, 800, 1200, 1600, 2000, 2400, 2800, 3200])
  })

  it('returns null when wall lengths differ enough that neither end matches', () => {
    // Upper wall 2.0 m starting at the same point as a 3.6 m lower wall:
    // start matches but end is 1.6 m off — outside the 100 mm tolerance.
    // We treat that as "not the same wall" and fall back to default
    // per-wall computation rather than inherit a mismatched grid.
    const scene = twoLevelScene({
      w0Start: [0, 0],
      w0End: [3.6, 0],
      w1Start: [0, 0],
      w1End: [2.0, 0],
    })
    const result = getInheritedStudPositions_mm(
      scene,
      wall('w1', [0, 0], [2.0, 0]),
      DEFAULT_SPACING_MM,
    )
    expect(result).toBeNull()
  })

  it('inherits even when both endpoints are off by up to the 100 mm tolerance', () => {
    // Both ends drift by ~80 mm — within the 100 mm allowance — and the
    // function still treats them as stacked. The upper wall's studs are
    // translated by the start-offset so they land directly above the
    // lower wall's studs in world space.
    const scene = twoLevelScene({
      w0Start: [0, 0],
      w0End: [3.6, 0],
      w1Start: [0.08, 0],
      w1End: [3.68, 0],
    })
    const result = getInheritedStudPositions_mm(
      scene,
      wall('w1', [0.08, 0], [3.68, 0]),
      DEFAULT_SPACING_MM,
    )
    // Lower studs at world 600, 1200, 1800, 2400, 3000.
    // Upper wall local x = world x - 80. Studs at 520, 1120, 1720, 2320, 2920.
    expect(result).toEqual([520, 1120, 1720, 2320, 2920])
  })
})
