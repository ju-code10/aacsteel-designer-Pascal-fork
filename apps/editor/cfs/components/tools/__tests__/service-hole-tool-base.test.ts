import { describe, expect, it } from 'bun:test'
import {
  ssmaLibraryJson,
} from '@pascal-app/cfs'
import type {
  CFSMemberId,
  CFSServiceHoleId,
  CFSWallFramingId,
} from '@pascal-app/cfs'
import { CFSMember, CFSMemberLibrary } from '@pascal-app/cfs'
import type { AnyNode } from '@pascal-app/core'
import {
  MAX_MEMBER_HIT_DISTANCE_MM,
  POSITION_SNAP_MM,
  pickClosestMember,
  processServiceHoleClick,
  projectPointOntoMember,
  wallLocalToWorld_m,
} from '../lib/service-hole-tool-base'

const lib = CFSMemberLibrary.parse(ssmaLibraryJson)
const STUD = lib.sections.find((s) => s.designation === '362S162-54')
if (!STUD) throw new Error('362S162-54 missing from SSMA seed')

const WALL_ID = 'wall_test_001'
const FRAMING_ID = '11111111-1111-4111-a111-111111111111' as unknown as CFSWallFramingId

let _next = 0
function uuid<T extends string>(): T {
  _next += 1
  const seg = _next.toString(16).padStart(12, '0')
  return `00000000-0000-4000-8a02-${seg}` as unknown as T
}

function makeStudAt(framingId: CFSWallFramingId, x_m: number, height_m = 2.743) {
  return CFSMember.parse({
    type: 'cfs_member',
    id: uuid<CFSMemberId>(),
    parentId: framingId,
    role: 'stud',
    sectionId: STUD!.id,
    start: { x_mm: x_m * 1000, y_mm: 0, z_mm: 0 },
    end: { x_mm: x_m * 1000, y_mm: height_m * 1000, z_mm: 0 },
    orientation_deg: 0,
    serviceHoleIds: [],
  })
}

function makeWall(length_m = 3.6, height = 2.743) {
  return {
    id: WALL_ID,
    start: [0, 0] as readonly [number, number],
    end: [length_m, 0] as readonly [number, number],
    height,
  }
}

function makeFraming() {
  return {
    type: 'cfs_wall_framing',
    id: FRAMING_ID,
    parentId: WALL_ID,
    studSpacing_mm: null,
    studSectionId: null,
    trackSectionId: null,
    defaultHeaderType: null,
    wallHeight_mm: null,
  } as unknown as AnyNode
}

describe('wallLocalToWorld_m', () => {
  it('maps wall-local (0,0,0) to wall start in world', () => {
    const wall = makeWall(3.6)
    const w = wallLocalToWorld_m(wall, 0, 0, 0)
    expect(w.x).toBeCloseTo(0)
    expect(w.y).toBeCloseTo(0)
    expect(w.z).toBeCloseTo(0)
  })

  it('maps localX along wall direction', () => {
    const wall = makeWall(3.6) // wall along +X axis
    const w = wallLocalToWorld_m(wall, 1.5, 0, 0)
    expect(w.x).toBeCloseTo(1.5)
    expect(w.y).toBeCloseTo(0)
  })

  it('maps localY upward (world +Y)', () => {
    const wall = makeWall(3.6)
    const w = wallLocalToWorld_m(wall, 0, 2, 0)
    expect(w.y).toBeCloseTo(2)
  })

  it('handles a rotated wall (45°)', () => {
    const wall = {
      id: WALL_ID,
      start: [0, 0] as const,
      end: [Math.SQRT2, Math.SQRT2] as const,
      height: 2.7,
    }
    const w = wallLocalToWorld_m(wall, 1, 0, 0)
    // Half the wall length along the 45° direction.
    expect(w.x).toBeCloseTo(Math.SQRT2 / 2, 5)
    expect(w.z).toBeCloseTo(Math.SQRT2 / 2, 5)
  })
})

describe('projectPointOntoMember', () => {
  it('returns midpoint for click on the segment midpoint', () => {
    const stud = makeStudAt(FRAMING_ID, 1.5, 2.743) // vertical at x=1.5
    const result = projectPointOntoMember(stud, { x: 1.5, y: 1.3715, z: 0 })
    expect(result.positionAlongMember_mm).toBeCloseTo(1371.5, 0)
    expect(result.perpDistance_mm).toBeCloseTo(0, 5)
  })

  it('clamps t to [0,1] when projection falls past the segment', () => {
    const stud = makeStudAt(FRAMING_ID, 1.5, 2.743)
    // Click well above the top of the stud — should clamp to the end.
    const result = projectPointOntoMember(stud, { x: 1.5, y: 5, z: 0 })
    expect(result.positionAlongMember_mm).toBeCloseTo(2743, 0)
  })

  it('reports perpendicular distance', () => {
    const stud = makeStudAt(FRAMING_ID, 1.5, 2.743)
    // Click 0.3 m horizontally off the stud.
    const result = projectPointOntoMember(stud, { x: 1.8, y: 1.3715, z: 0 })
    expect(result.perpDistance_mm).toBeCloseTo(300, 0)
  })
})

describe('pickClosestMember', () => {
  it('returns null when every member is farther than MAX_MEMBER_HIT_DISTANCE_MM', () => {
    const studs = [makeStudAt(FRAMING_ID, 0.6), makeStudAt(FRAMING_ID, 1.2)]
    const hit = pickClosestMember(studs, { x: 5, y: 1, z: 0 })
    expect(hit).toBeNull()
  })

  it('picks the closest stud when click lands between two', () => {
    const studs = [
      makeStudAt(FRAMING_ID, 0.6),
      makeStudAt(FRAMING_ID, 1.2),
      makeStudAt(FRAMING_ID, 1.8),
    ]
    // Click at 1.0 — closer to stud at 1.2 (perpDist 200 mm) than to 0.6 (400 mm).
    const hit = pickClosestMember(studs, { x: 1.0, y: 1.3715, z: 0 })
    expect(hit).not.toBeNull()
    if (hit) {
      expect(hit.member.start.x_mm).toBe(1200)
      expect(hit.perpDistance_mm).toBeLessThanOrEqual(MAX_MEMBER_HIT_DISTANCE_MM)
    }
  })
})

describe('processServiceHoleClick — end to end', () => {
  function buildScene(extras: Record<string, AnyNode> = {}) {
    const studA = makeStudAt(FRAMING_ID, 0.6)
    const studB = makeStudAt(FRAMING_ID, 1.2)
    return {
      nodes: {
        [FRAMING_ID]: makeFraming(),
        [studA.id]: studA as unknown as AnyNode,
        [studB.id]: studB as unknown as AnyNode,
        ...extras,
      } as Record<string, AnyNode | undefined>,
      studA,
      studB,
    }
  }

  it('returns no-framing when the wall has no CFS framing', () => {
    const r = processServiceHoleClick({
      nodes: {} as Record<string, AnyNode | undefined>,
      wall: makeWall(),
      clickWallLocal_m: [1.2, 1.4, 0],
      settings: {
        diameter_mm: 38,
        shape: 'round',
        oblongWidth_mm: 38,
        snapToGrid: false,
      },
      generateId: () => uuid<CFSServiceHoleId>(),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no-framing')
  })

  it('places a hole on the closest stud', () => {
    const { nodes, studB } = buildScene()
    const r = processServiceHoleClick({
      nodes,
      wall: makeWall(),
      clickWallLocal_m: [1.2, 1.4, 0],
      settings: {
        diameter_mm: 38,
        shape: 'round',
        oblongWidth_mm: 38,
        snapToGrid: false,
      },
      generateId: () => uuid<CFSServiceHoleId>(),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.memberId).toBe(studB.id)
      expect(r.payload.positionAlongMember_mm).toBeCloseTo(1400, 0)
      expect(r.payload.diameter_mm).toBe(38)
      expect(r.payload.shape).toBe('round')
    }
  })

  it('snaps position to 50 mm when snapToGrid is true', () => {
    const { nodes } = buildScene()
    const r = processServiceHoleClick({
      nodes,
      wall: makeWall(),
      clickWallLocal_m: [1.2, 1.473, 0], // → 1473 mm raw
      settings: {
        diameter_mm: 38,
        shape: 'round',
        oblongWidth_mm: 38,
        snapToGrid: true,
      },
      generateId: () => uuid<CFSServiceHoleId>(),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.positionAlongMember_mm % POSITION_SNAP_MM).toBe(0)
      expect(r.payload.positionAlongMember_mm).toBe(1450)
    }
  })

  it('creates an oblong hole when forceOblong is set', () => {
    const { nodes } = buildScene()
    const r = processServiceHoleClick({
      nodes,
      wall: makeWall(),
      clickWallLocal_m: [1.2, 1.4, 0],
      settings: {
        diameter_mm: 80, // long axis along member
        shape: 'round',
        oblongWidth_mm: 38, // SSMA cross-web width
        snapToGrid: false,
        forceOblong: true,
      },
      generateId: () => uuid<CFSServiceHoleId>(),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.shape).toBe('oblong')
      expect(r.payload.diameter_mm).toBe(38)
      expect(r.payload.oblongLength_mm).toBe(80)
    }
  })

  it('returns no-member-near-click when click misses every member', () => {
    const { nodes } = buildScene()
    // Click at x=3 m, far from studs at 0.6 and 1.2 m.
    const r = processServiceHoleClick({
      nodes,
      wall: makeWall(),
      clickWallLocal_m: [3.0, 1.4, 0],
      settings: {
        diameter_mm: 38,
        shape: 'round',
        oblongWidth_mm: 38,
        snapToGrid: false,
      },
      generateId: () => uuid<CFSServiceHoleId>(),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no-member-near-click')
  })

  it('clamps position into the member when click is near an end', () => {
    const { nodes } = buildScene()
    const r = processServiceHoleClick({
      nodes,
      wall: makeWall(),
      clickWallLocal_m: [1.2, 0, 0], // exactly at the bottom of the stud
      settings: {
        diameter_mm: 38,
        shape: 'round',
        oblongWidth_mm: 38,
        snapToGrid: false,
      },
      generateId: () => uuid<CFSServiceHoleId>(),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // Clamped to halfDiameter (19 mm) so the hole still fits within the stud.
      expect(r.payload.positionAlongMember_mm).toBe(19)
    }
  })
})
