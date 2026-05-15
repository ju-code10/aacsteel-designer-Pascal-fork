import { describe, expect, it } from 'bun:test'
import type { CFSMember } from '../../schema/cfs-member'
import type { CFSSection } from '../../schema/cfs-member-library'
import type { CFSPanel } from '../../schema/cfs-panel'
import type { CFSServiceHole } from '../../schema/cfs-service-hole'
import type { PascalWallLike } from '../wall-frame'
import {
  makePanelTransform,
  memberBoundingBox_mm,
  memberCenter_mm,
  scaleToFit,
  serviceHoleProjection_mm,
  DEFAULT_PANEL_HEIGHT_MM,
} from '../panel-projection'

// Default test wall: 10 m along +x at world origin so world x = along-wall
// x (the prior test fixtures stored members that way; the projection now
// derives along-wall x explicitly via the wall).
const WALL_ALONG_X: PascalWallLike = {
  id: 'wall-test',
  start: [0, 0],
  end: [10, 0],
  height: 2.7,
}

// Minimal stubs — only the fields panel-projection reads.
function panel(startMm: number, endMm: number): CFSPanel {
  return {
    startAlongWall_mm: startMm,
    endAlongWall_mm: endMm,
  } as unknown as CFSPanel
}

function section(webDepth_mm: number, flangeWidth_mm: number): CFSSection {
  return {
    properties: { webDepth_mm, flangeWidth_mm },
  } as unknown as CFSSection
}

function studAt(
  alongMm: number,
  y0: number,
  y1: number,
): CFSMember {
  return {
    start: { x_mm: alongMm, y_mm: y0, z_mm: 0 },
    end: { x_mm: alongMm, y_mm: y1, z_mm: 0 },
    serviceHoleIds: [],
  } as unknown as CFSMember
}

function topTrack(x0: number, x1: number, y: number): CFSMember {
  return {
    start: { x_mm: x0, y_mm: y, z_mm: 0 },
    end: { x_mm: x1, y_mm: y, z_mm: 0 },
    serviceHoleIds: [],
  } as unknown as CFSMember
}

describe('makePanelTransform', () => {
  it('shifts along-wall coords so panel-local origin is the panel start', () => {
    const t = makePanelTransform(panel(600, 4200), WALL_ALONG_X)
    expect(t.panelWidth_mm).toBe(3600)
    expect(t.panelHeight_mm).toBe(DEFAULT_PANEL_HEIGHT_MM)
    expect(t.toLocal_mm(600, 0)).toEqual({ x_mm: 0, y_mm: 0 })
    expect(t.toLocal_mm(1200, 2700)).toEqual({ x_mm: 600, y_mm: 2700 })
  })
})

describe('memberBoundingBox_mm — vertical members', () => {
  const t = makePanelTransform(panel(0, 3600), WALL_ALONG_X)
  // 362S162-54 web 91.95, flange 41.15 — round numbers for the test.
  const sec = section(92, 42)

  it('places a stud centered on its along-wall coord, full height', () => {
    const bb = memberBoundingBox_mm(studAt(600, 0, 2700), sec, t)
    expect(bb.isVertical).toBe(true)
    expect(bb.width_mm).toBe(42)
    expect(bb.height_mm).toBe(2700)
    expect(bb.x_mm).toBe(600 - 21) // centre 600 minus half-flange
    expect(bb.y_mm).toBe(0)
  })

  it('translates by panel start when the panel doesn\'t begin at x = 0', () => {
    const t2 = makePanelTransform(panel(600, 4200), WALL_ALONG_X)
    const bb = memberBoundingBox_mm(studAt(1200, 0, 2700), sec, t2)
    expect(bb.x_mm).toBe(1200 - 600 - 21) // 579
    expect(bb.y_mm).toBe(0)
  })
})

describe('memberBoundingBox_mm — horizontal members', () => {
  const t = makePanelTransform(panel(0, 3600), WALL_ALONG_X)
  // Track 362T125-54: web 92, flange 31.75 — use round numbers.
  const sec = section(92, 32)

  it('rests a top track along its y, full panel width, web-deep', () => {
    const bb = memberBoundingBox_mm(topTrack(0, 3600, 2700), sec, t)
    expect(bb.isVertical).toBe(false)
    expect(bb.width_mm).toBe(3600)
    expect(bb.height_mm).toBe(92)
    expect(bb.x_mm).toBe(0)
    expect(bb.y_mm).toBe(2700 - 46)
  })
})

describe('memberCenter_mm', () => {
  const t = makePanelTransform(panel(0, 3600), WALL_ALONG_X)
  it('returns the midpoint in panel-local coords', () => {
    expect(memberCenter_mm(studAt(1800, 0, 2700), t)).toEqual({
      x_mm: 1800,
      y_mm: 1350,
    })
    expect(memberCenter_mm(topTrack(0, 3600, 2700), t)).toEqual({
      x_mm: 1800,
      y_mm: 2700,
    })
  })
})

describe('serviceHoleProjection_mm', () => {
  const t = makePanelTransform(panel(0, 3600), WALL_ALONG_X)
  const hole = {
    positionAlongMember_mm: 1350,
    diameter_mm: 38,
  } as unknown as CFSServiceHole

  it('maps a hole on a stud to (stud x, member start + offset)', () => {
    const proj = serviceHoleProjection_mm(hole, studAt(600, 0, 2700), t)
    expect(proj).toEqual({ x_mm: 600, y_mm: 1350, radius_mm: 19 })
  })

  it('maps a hole on a horizontal member to (start + offset, member y)', () => {
    const proj = serviceHoleProjection_mm(hole, topTrack(0, 3600, 2700), t)
    expect(proj).toEqual({ x_mm: 1350, y_mm: 2700, radius_mm: 19 })
  })
})

describe('memberBoundingBox_mm — off-origin walls and upper levels', () => {
  // Regression for "panel images missing from shop-drawing PDF / DXF".
  // Members are stored by the framing pass in world coordinates. Before
  // the fix, the projection read world x as along-wall x, so any wall
  // not at world origin along +x produced bounding boxes off-canvas.

  const sec = section(92, 42)

  it('projects world (x, z) → along-wall x for a wall starting off-origin', () => {
    const wall: PascalWallLike = {
      id: 'w-offset',
      start: [5, 3], // 5 m world x, 3 m world z
      end: [12, 3], // 7 m long along +x
      height: 2.7,
    }
    const t = makePanelTransform(panel(0, 3700), wall, 0)
    // A field stud the framing pass emitted at along-wall x = 600 has
    // world x = 5000 + 600 = 5600 and world z = 3000.
    const stud: CFSMember = {
      start: { x_mm: 5600, y_mm: 0, z_mm: 3000 },
      end: { x_mm: 5600, y_mm: 2700, z_mm: 3000 },
      serviceHoleIds: [],
    } as unknown as CFSMember
    const bb = memberBoundingBox_mm(stud, sec, t)
    // Panel starts at along-wall 0, so the stud lands at panel-local x = 600.
    expect(bb.isVertical).toBe(true)
    expect(bb.x_mm).toBeCloseTo(600 - 21, 6) // centred on along-wall x = 600
    expect(bb.y_mm).toBeCloseTo(0, 6)
    expect(bb.width_mm).toBe(42)
    expect(bb.height_mm).toBeCloseTo(2700, 6)
  })

  it('projects a wall running along +z so every endpoint has world x = wall.start.x', () => {
    const wall: PascalWallLike = {
      id: 'w-along-z',
      start: [4, 0],
      end: [4, 7], // 7 m along +z
      height: 2.7,
    }
    const t = makePanelTransform(panel(0, 3700), wall, 0)
    // Stud at along-wall x = 600: world x = 4000, world z = 600.
    const stud: CFSMember = {
      start: { x_mm: 4000, y_mm: 0, z_mm: 600 },
      end: { x_mm: 4000, y_mm: 2700, z_mm: 600 },
      serviceHoleIds: [],
    } as unknown as CFSMember
    const bb = memberBoundingBox_mm(stud, sec, t)
    expect(bb.x_mm).toBeCloseTo(600 - 21, 6)
    expect(bb.width_mm).toBe(42)
    expect(bb.height_mm).toBeCloseTo(2700, 6)
  })

  it('subtracts level elevation so an upper-level top-track lands at local y = wall height', () => {
    const wall: PascalWallLike = {
      id: 'w-level-1',
      start: [0, 0],
      end: [3.7, 0],
      height: 2.7,
    }
    const levelElev_mm = 2700 // level 1 sits 2.7 m above level 0
    const t = makePanelTransform(panel(0, 3700), wall, levelElev_mm)
    // Top track on level 1: world y = 2700 + 2700 = 5400.
    const trackSec = section(92, 32)
    const top: CFSMember = {
      start: { x_mm: 0, y_mm: 5400, z_mm: 0 },
      end: { x_mm: 3700, y_mm: 5400, z_mm: 0 },
      serviceHoleIds: [],
    } as unknown as CFSMember
    const bb = memberBoundingBox_mm(top, trackSec, t)
    expect(bb.isVertical).toBe(false)
    // y_mm is the BOTTOM of the bounding box — track centred on y=2700,
    // half-web (92/2 = 46) thick → bottom at 2700 - 46 = 2654.
    expect(bb.y_mm).toBeCloseTo(2700 - 46, 6)
    expect(bb.height_mm).toBe(92)
    expect(bb.width_mm).toBeCloseTo(3700, 6)
  })

  it('keeps every member inside the panel rectangle for an off-origin wall', () => {
    // The user-reported symptom: rectangles drawn far outside the panel
    // page region. Before the fix, an off-origin wall produced negative
    // or >panelWidth x values for every member.
    const wall: PascalWallLike = {
      id: 'w',
      start: [10, 20],
      end: [10 + 3.7, 20], // 3.7 m along +x
      height: 2.7,
    }
    const t = makePanelTransform(panel(0, 3700), wall, 0)
    const members: CFSMember[] = [
      // bottom track
      {
        start: { x_mm: 10_000, y_mm: 0, z_mm: 20_000 },
        end: { x_mm: 13_700, y_mm: 0, z_mm: 20_000 },
        serviceHoleIds: [],
      } as unknown as CFSMember,
      // top track
      {
        start: { x_mm: 10_000, y_mm: 2700, z_mm: 20_000 },
        end: { x_mm: 13_700, y_mm: 2700, z_mm: 20_000 },
        serviceHoleIds: [],
      } as unknown as CFSMember,
      // mid stud at along-wall 1800
      {
        start: { x_mm: 11_800, y_mm: 0, z_mm: 20_000 },
        end: { x_mm: 11_800, y_mm: 2700, z_mm: 20_000 },
        serviceHoleIds: [],
      } as unknown as CFSMember,
    ]
    for (const m of members) {
      const bb = memberBoundingBox_mm(m, sec, t)
      expect(bb.x_mm).toBeGreaterThanOrEqual(-1) // small floating-point slack
      expect(bb.x_mm + bb.width_mm).toBeLessThanOrEqual(t.panelWidth_mm + 1)
      expect(bb.y_mm).toBeGreaterThanOrEqual(-50) // web-half slack for tracks
      expect(bb.y_mm + bb.height_mm).toBeLessThanOrEqual(t.panelHeight_mm + 50)
    }
  })
})

describe('scaleToFit', () => {
  it('fits an upright source into a square destination', () => {
    const r = scaleToFit(
      { width: 100, height: 50 },
      { width: 200, height: 200 },
    )
    // upright: scale = min(200/100, 200/50) = 2
    // rotated: scale = min(200/50, 200/100) = 2 — tie, picks upright
    expect(r.scale).toBe(2)
    expect(r.rotated).toBe(false)
    expect(r.usedWidth).toBe(200)
    expect(r.usedHeight).toBe(100)
    expect(r.offsetX).toBe(0)
    expect(r.offsetY).toBe(50) // centred vertically: (200 - 100) / 2
  })

  it('rotates when the source is tall and the destination is wide', () => {
    const r = scaleToFit(
      { width: 100, height: 500 },
      { width: 600, height: 200 },
    )
    expect(r.rotated).toBe(true)
    expect(r.scale).toBeCloseTo(1.2) // 600 / 500
  })

  it('respects margin', () => {
    const r = scaleToFit(
      { width: 100, height: 100 },
      { width: 200, height: 200, margin: 20 },
    )
    // available 160 × 160; scale = 1.6
    expect(r.scale).toBeCloseTo(1.6)
    expect(r.offsetX).toBe(20)
    expect(r.offsetY).toBe(20)
  })
})
