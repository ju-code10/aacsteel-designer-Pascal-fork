import { describe, expect, it } from 'bun:test'
import type { CFSMember } from '../../schema/cfs-member'
import type { CFSSection } from '../../schema/cfs-member-library'
import type { CFSPanel } from '../../schema/cfs-panel'
import type { CFSServiceHole } from '../../schema/cfs-service-hole'
import {
  makePanelTransform,
  memberBoundingBox_mm,
  memberCenter_mm,
  scaleToFit,
  serviceHoleProjection_mm,
  DEFAULT_PANEL_HEIGHT_MM,
} from '../panel-projection'

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
    const t = makePanelTransform(panel(600, 4200))
    expect(t.panelWidth_mm).toBe(3600)
    expect(t.panelHeight_mm).toBe(DEFAULT_PANEL_HEIGHT_MM)
    expect(t.toLocal_mm(600, 0)).toEqual({ x: 0, y: 0 })
    expect(t.toLocal_mm(1200, 2700)).toEqual({ x: 600, y: 2700 })
  })
})

describe('memberBoundingBox_mm — vertical members', () => {
  const t = makePanelTransform(panel(0, 3600))
  // 362S162-54 web 91.95, flange 41.15 — round numbers for the test.
  const sec = section(92, 42)

  it('places a stud centered on its along-wall coord, full height', () => {
    const bb = memberBoundingBox_mm(studAt(600, 0, 2700), sec, t)
    expect(bb.isVertical).toBe(true)
    expect(bb.width).toBe(42)
    expect(bb.height).toBe(2700)
    expect(bb.x).toBe(600 - 21) // centre 600 minus half-flange
    expect(bb.y).toBe(0)
  })

  it('translates by panel start when the panel doesn\'t begin at x = 0', () => {
    const t2 = makePanelTransform(panel(600, 4200))
    const bb = memberBoundingBox_mm(studAt(1200, 0, 2700), sec, t2)
    expect(bb.x).toBe(1200 - 600 - 21) // 579
    expect(bb.y).toBe(0)
  })
})

describe('memberBoundingBox_mm — horizontal members', () => {
  const t = makePanelTransform(panel(0, 3600))
  // Track 362T125-54: web 92, flange 31.75 — use round numbers.
  const sec = section(92, 32)

  it('rests a top track along its y, full panel width, web-deep', () => {
    const bb = memberBoundingBox_mm(topTrack(0, 3600, 2700), sec, t)
    expect(bb.isVertical).toBe(false)
    expect(bb.width).toBe(3600)
    expect(bb.height).toBe(92)
    expect(bb.x).toBe(0)
    expect(bb.y).toBe(2700 - 46)
  })
})

describe('memberCenter_mm', () => {
  const t = makePanelTransform(panel(0, 3600))
  it('returns the midpoint in panel-local coords', () => {
    expect(memberCenter_mm(studAt(1800, 0, 2700), t)).toEqual({
      x: 1800,
      y: 1350,
    })
    expect(memberCenter_mm(topTrack(0, 3600, 2700), t)).toEqual({
      x: 1800,
      y: 2700,
    })
  })
})

describe('serviceHoleProjection_mm', () => {
  const t = makePanelTransform(panel(0, 3600))
  const hole = {
    positionAlongMember_mm: 1350,
    diameter_mm: 38,
  } as unknown as CFSServiceHole

  it('maps a hole on a stud to (stud x, member start + offset)', () => {
    const proj = serviceHoleProjection_mm(hole, studAt(600, 0, 2700), t)
    expect(proj).toEqual({ x: 600, y: 1350, radius: 19 })
  })

  it('maps a hole on a horizontal member to (start + offset, member y)', () => {
    const proj = serviceHoleProjection_mm(hole, topTrack(0, 3600, 2700), t)
    expect(proj).toEqual({ x: 1350, y: 2700, radius: 19 })
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
