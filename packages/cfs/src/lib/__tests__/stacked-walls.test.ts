import { describe, expect, it } from 'bun:test'
import type { SceneLike } from '../scene-walk'
import type { PascalWallLike } from '../wall-frame'
import { getInheritedStudPositions_mm } from '../stacked-walls'

const DEFAULT_SPACING_MM = 600

interface SceneOpts {
  /** Lower-level walls, keyed by id. */
  lower: Record<
    string,
    { start: [number, number]; end: [number, number]; spacing_mm?: number }
  >
  /** Upper wall's start/end. */
  upperStart: [number, number]
  upperEnd: [number, number]
}

function makeScene(opts: SceneOpts): SceneLike {
  const lowerWallIds = Object.keys(opts.lower)
  const nodes: Record<string, unknown> = {
    bldg: {
      type: 'building',
      id: 'bldg',
      parentId: null,
      children: ['lv0', 'lv1'],
    },
    lv0: {
      type: 'level',
      id: 'lv0',
      parentId: 'bldg',
      level: 0,
      children: lowerWallIds,
    },
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
      start: opts.upperStart,
      end: opts.upperEnd,
      height: 2.7,
    },
  }
  for (const [id, w] of Object.entries(opts.lower)) {
    nodes[id] = {
      type: 'wall',
      id,
      parentId: 'lv0',
      start: w.start,
      end: w.end,
      height: 2.7,
      children: [`f_${id}`],
    }
    nodes[`f_${id}`] = {
      type: 'cfs_wall_framing',
      id: `f_${id}`,
      parentId: id,
      studSpacing_mm: w.spacing_mm ?? null,
    }
  }
  return { nodes }
}

function upper(start: [number, number], end: [number, number]): PascalWallLike {
  return { id: 'w1', start, end }
}

describe('getInheritedStudPositions_mm', () => {
  it('returns null when the wall has no level below (ground floor)', () => {
    const scene: SceneLike = {
      nodes: {
        lv: {
          type: 'level',
          id: 'lv',
          parentId: 'bldg',
          level: 0,
          children: ['w'],
        },
        bldg: { type: 'building', id: 'bldg', children: ['lv'] },
        w: {
          type: 'wall',
          id: 'w',
          parentId: 'lv',
          start: [0, 0],
          end: [3.6, 0],
        },
      },
    }
    expect(
      getInheritedStudPositions_mm(scene, upper([0, 0], [3.6, 0]), DEFAULT_SPACING_MM),
    ).toBeNull()
  })

  it('returns null when no lower wall is collinear with the upper wall', () => {
    // Upper wall along x. Only lower wall is along z — perpendicular, not collinear.
    const scene = makeScene({
      lower: { wA: { start: [5, 0], end: [5, 5] } },
      upperStart: [0, 0],
      upperEnd: [3.6, 0],
    })
    expect(
      getInheritedStudPositions_mm(scene, upper([0, 0], [3.6, 0]), DEFAULT_SPACING_MM),
    ).toBeNull()
  })

  it('inherits a single lower wall\'s full stud positions when footprints match', () => {
    // 3.6 m wall on both levels at the same coords. Lower's chord + field
    // positions land on the upper wall, dropping the chord endpoints that
    // the upper wall emits itself.
    const scene = makeScene({
      lower: { wA: { start: [0, 0], end: [3.6, 0] } },
      upperStart: [0, 0],
      upperEnd: [3.6, 0],
    })
    const result = getInheritedStudPositions_mm(
      scene,
      upper([0, 0], [3.6, 0]),
      DEFAULT_SPACING_MM,
    )
    // Lower 3.6m, 600 spacing → field studs 600, 1200, 1800, 2400, 3000.
    // Chord ends (0 and 3600) are dropped because the upper wall emits its
    // own chords at those positions.
    expect(result).toEqual([600, 1200, 1800, 2400, 3000])
  })

  it('combines positions from TWO collinear lower walls that together cover the upper wall', () => {
    // Real scenario from the user's scene: the level-0 west side is split
    // at z=-3.5 by an interior cross-wall, so a single 5.5 m upper wall sits
    // above two lower walls (2 m + 3.5 m). Inherited positions should cover
    // every stud across both lower walls — chord ends INSIDE the upper wall
    // (the shared T-junction at 2 m) PLUS each lower wall's field studs.
    const scene = makeScene({
      lower: {
        wA: { start: [-6, -5.5], end: [-6, -3.5] },
        wB: { start: [-6, -3.5], end: [-6, 0] },
      },
      upperStart: [-6, -5.5],
      upperEnd: [-6, 0],
    })
    const result = getInheritedStudPositions_mm(
      scene,
      upper([-6, -5.5], [-6, 0]),
      DEFAULT_SPACING_MM,
    )
    // Lower wA (2.0 m): chord ends 0/2000, field 600/1200 (the candidate
    // at 1800 is within half-spacing of the wA end, so the omit-last rule
    // drops it). In upper-local x (upper start also at z=-5.5): 0 dropped
    // (upper chord), 600, 1200, 2000.
    // Lower wB (3.5 m): chord ends 0/3500 → upper-local 2000 and 5500;
    // field 600/1200/1800/2400/3000 → upper-local 2600/3200/3800/4400/5000.
    // Upper-local 5500 dropped (upper end chord).
    // Dedupe: 2000 appears in both — kept once.
    expect(result).toEqual([
      600, 1200, 2000, 2600, 3200, 3800, 4400, 5000,
    ])
  })

  it('translates positions when the lower wall is offset within tolerance', () => {
    // Upper at x=0..3.6. Lower at x=0.05..3.65 (50 mm drift). Both on z=0.
    // Lower studs at world x = 0.65, 1.25, 1.85, 2.45, 3.05. In upper-local
    // (upper start at 0), these are 650, 1250, 1850, 2450, 3050.
    const scene = makeScene({
      lower: { wA: { start: [0.05, 0], end: [3.65, 0] } },
      upperStart: [0, 0],
      upperEnd: [3.6, 0],
    })
    const result = getInheritedStudPositions_mm(
      scene,
      upper([0, 0], [3.6, 0]),
      DEFAULT_SPACING_MM,
    )
    expect(result).toEqual([650, 1250, 1850, 2450, 3050])
  })

  it('handles a reversed lower wall (drawn end-to-start)', () => {
    // Lower drawn from (3.6, 0) back to (0, 0). Upper drawn (0, 0)→(3.6, 0).
    // Lower's stud positions are measured from its start (3.6, 0), so its
    // 600 mm field stud is at world x = 3.0. In upper-local that's x = 3000.
    const scene = makeScene({
      lower: { wA: { start: [3.6, 0], end: [0, 0] } },
      upperStart: [0, 0],
      upperEnd: [3.6, 0],
    })
    const result = getInheritedStudPositions_mm(
      scene,
      upper([0, 0], [3.6, 0]),
      DEFAULT_SPACING_MM,
    )
    expect(result).toEqual([600, 1200, 1800, 2400, 3000])
  })

  it('inherits the lower wall\'s framing spacing if set', () => {
    // Lower has explicit 400 mm spacing. Upper inherits that grid.
    const scene = makeScene({
      lower: { wA: { start: [0, 0], end: [3.6, 0], spacing_mm: 400 } },
      upperStart: [0, 0],
      upperEnd: [3.6, 0],
    })
    const result = getInheritedStudPositions_mm(
      scene,
      upper([0, 0], [3.6, 0]),
      DEFAULT_SPACING_MM, // 600 — overridden by lower's 400
    )
    // 3.6m at 400 spacing → 400, 800, 1200, 1600, 2000, 2400, 2800, 3200.
    expect(result).toEqual([400, 800, 1200, 1600, 2000, 2400, 2800, 3200])
  })

  it('returns null when the upper wall is more than the tolerance off the lower wall\'s line', () => {
    // Upper offset perpendicular by 200 mm (> 100 mm tolerance) — different wall, not stacked.
    const scene = makeScene({
      lower: { wA: { start: [0, 0], end: [3.6, 0] } },
      upperStart: [0, 0.2],
      upperEnd: [3.6, 0.2],
    })
    expect(
      getInheritedStudPositions_mm(
        scene,
        upper([0, 0.2], [3.6, 0.2]),
        DEFAULT_SPACING_MM,
      ),
    ).toBeNull()
  })
})
