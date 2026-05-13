import { describe, expect, it } from 'bun:test'
import type { SceneLike } from '../scene-walk'
import {
  DEFAULT_LEVEL_HEIGHT_MM,
  levelElevation_mm,
  levelHeight_mm,
  wallLevelElevation_mm,
} from '../level-elevation'

function sceneWithTwoLevels(): SceneLike {
  return {
    nodes: {
      site: { type: 'site', id: 'site', parentId: null, children: ['bldg'] },
      bldg: {
        type: 'building',
        id: 'bldg',
        parentId: 'site',
        children: ['lv0', 'lv1'],
      },
      lv0: {
        type: 'level',
        id: 'lv0',
        parentId: 'bldg',
        level: 0,
        children: ['w0', 'c0'],
      },
      c0: {
        type: 'ceiling',
        id: 'c0',
        parentId: 'lv0',
        height: 3.0, // 3 m → 3000 mm
      },
      w0: {
        type: 'wall',
        id: 'w0',
        parentId: 'lv0',
        start: [0, 0],
        end: [3.6, 0],
        height: 2.7,
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
        start: [0, 0],
        end: [3.6, 0],
        height: 2.7,
      },
    },
  }
}

describe('levelHeight_mm', () => {
  it('returns the tallest child wall or ceiling height', () => {
    const scene = sceneWithTwoLevels()
    // lv0 has a 3 m ceiling and a 2.7 m wall — ceiling wins.
    expect(levelHeight_mm(scene, 'lv0')).toBe(3000)
    // lv1 has only a 2.7 m wall.
    expect(levelHeight_mm(scene, 'lv1')).toBe(2700)
  })

  it('falls back to the 2.5 m default when no children declare height', () => {
    const scene: SceneLike = {
      nodes: {
        lv: { type: 'level', id: 'lv', parentId: 'b', children: [] },
      },
    }
    expect(levelHeight_mm(scene, 'lv')).toBe(DEFAULT_LEVEL_HEIGHT_MM)
  })
})

describe('levelElevation_mm', () => {
  it('returns 0 for the ground level', () => {
    const scene = sceneWithTwoLevels()
    expect(levelElevation_mm(scene, 'lv0')).toBe(0)
  })

  it('returns the cumulative height of preceding levels', () => {
    const scene = sceneWithTwoLevels()
    // lv1 sits on top of lv0; lv0 height = 3000 mm.
    expect(levelElevation_mm(scene, 'lv1')).toBe(3000)
  })

  it('returns 0 when the level is orphaned', () => {
    const scene: SceneLike = {
      nodes: {
        orphan: { type: 'level', id: 'orphan', parentId: null, level: 0 },
      },
    }
    expect(levelElevation_mm(scene, 'orphan')).toBe(0)
  })
})

describe('wallLevelElevation_mm', () => {
  it('matches the parent level\'s elevation for ground-floor walls', () => {
    const scene = sceneWithTwoLevels()
    expect(wallLevelElevation_mm(scene, 'w0')).toBe(0)
  })

  it('lifts upper-floor walls by the cumulative ground-floor height', () => {
    const scene = sceneWithTwoLevels()
    expect(wallLevelElevation_mm(scene, 'w1')).toBe(3000)
  })

  it('returns 0 for walls without a level ancestor', () => {
    const scene: SceneLike = {
      nodes: { rogue: { type: 'wall', id: 'rogue' } },
    }
    expect(wallLevelElevation_mm(scene, 'rogue')).toBe(0)
  })
})

// ── Slab-aware variants ─────────────────────────────────────────────────────
//
// Pascal positions walls at `mesh.position.y = slabElevation` and counts
// the slab thickness toward each level's top. The CFS math has to match
// or upper-level framing lands lower than Pascal's upper-level walls and
// slabs pass through stud bottoms on the ground floor.

describe('levelHeight_mm with slab elevation', () => {
  it('adds slab thickness to a wall\'s contribution', () => {
    const scene: SceneLike = {
      nodes: {
        lv: {
          type: 'level',
          id: 'lv',
          parentId: 'b',
          level: 0,
          children: ['w'],
        },
        w: {
          type: 'wall',
          id: 'w',
          parentId: 'lv',
          start: [0, 0],
          end: [3.6, 0],
          height: 2.7,
        },
      },
    }
    // 150 mm slab + 2700 mm wall → 2850 mm level top.
    expect(levelHeight_mm(scene, 'lv', (id) => (id === 'w' ? 150 : 0))).toBe(2850)
  })

  it('clamps negative slab elevation to 0 (Pascal\'s `meshY < 0 → 0` rule)', () => {
    const scene: SceneLike = {
      nodes: {
        lv: {
          type: 'level',
          id: 'lv',
          parentId: 'b',
          level: 0,
          children: ['w'],
        },
        w: { type: 'wall', id: 'w', parentId: 'lv', start: [0, 0], end: [3.6, 0], height: 2.7 },
      },
    }
    expect(levelHeight_mm(scene, 'lv', () => -200)).toBe(2700)
  })

  it('does not apply slab thickness to ceilings', () => {
    const scene: SceneLike = {
      nodes: {
        lv: {
          type: 'level',
          id: 'lv',
          parentId: 'b',
          level: 0,
          children: ['c'],
        },
        c: { type: 'ceiling', id: 'c', parentId: 'lv', height: 3.0 },
      },
    }
    expect(levelHeight_mm(scene, 'lv', () => 150)).toBe(3000)
  })
})

describe('levelElevation_mm with slab elevation', () => {
  it('stacks the slab thickness of prior levels into the cumulative offset', () => {
    const scene = sceneWithTwoLevels()
    // lv0 has a 3000 mm ceiling and a wall — ceiling wins regardless of slab.
    // Override: remove the ceiling so the wall (with slab) dominates.
    const ns = { ...scene.nodes } as Record<string, unknown>
    ns.lv0 = { type: 'level', id: 'lv0', parentId: 'bldg', level: 0, children: ['w0'] }
    delete ns.c0
    const sceneNoCeiling: SceneLike = { nodes: ns }
    // wall: 2.7 m, slab: 150 mm → level top = 2850 mm.
    expect(
      levelElevation_mm(sceneNoCeiling, 'lv1', (id) => (id === 'w0' ? 150 : 0)),
    ).toBe(2850)
  })
})

describe('wallLevelElevation_mm with slab elevation', () => {
  it('lifts upper-floor walls by ground-floor wall height PLUS its slab', () => {
    const scene = sceneWithTwoLevels()
    const ns = { ...scene.nodes } as Record<string, unknown>
    ns.lv0 = { type: 'level', id: 'lv0', parentId: 'bldg', level: 0, children: ['w0'] }
    delete ns.c0
    const sceneNoCeiling: SceneLike = { nodes: ns }
    // w0: 2.7 m wall on a 150 mm slab → level-0 top = 2850 mm.
    // w1 sits on level 1, which starts at 2850 mm.
    expect(
      wallLevelElevation_mm(sceneNoCeiling, 'w1', (id) => (id === 'w0' ? 150 : 0)),
    ).toBe(2850)
  })
})
