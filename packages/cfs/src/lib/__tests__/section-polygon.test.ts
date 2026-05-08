import { describe, expect, it } from 'bun:test'
import type { CFSSectionProperties } from '../../schema/primitives'
import {
  type Polygon2D,
  sectionPolygon,
  UnsupportedSectionShapeError,
} from '../section-polygon'

const SSMA_362S162_54: CFSSectionProperties = {
  shape: 'C',
  webDepth_mm: 92,
  flangeWidth_mm: 41,
  lipLength_mm: 13,
  thickness_mm: 1.37,
  cornerRadius_mm: 0,
}

const SSMA_362T125_54: CFSSectionProperties = {
  shape: 'U',
  webDepth_mm: 92,
  flangeWidth_mm: 32,
  lipLength_mm: 0,
  thickness_mm: 1.37,
  cornerRadius_mm: 0,
}

const Z_SECTION: CFSSectionProperties = {
  shape: 'Z',
  webDepth_mm: 100,
  flangeWidth_mm: 50,
  lipLength_mm: 15,
  thickness_mm: 2,
  cornerRadius_mm: 0,
}

function signedArea(poly: Polygon2D): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s / 2
}

function bbox(poly: Polygon2D) {
  let zMin = Number.POSITIVE_INFINITY
  let zMax = Number.NEGATIVE_INFINITY
  let yMin = Number.POSITIVE_INFINITY
  let yMax = Number.NEGATIVE_INFINITY
  for (const [z, y] of poly) {
    if (z < zMin) zMin = z
    if (z > zMax) zMax = z
    if (y < yMin) yMin = y
    if (y > yMax) yMax = y
  }
  return { zMin, zMax, yMin, yMax }
}

describe('sectionPolygon — winding & dimensional integrity', () => {
  it('GEO-01: C-section reproduces web depth, flange width, and lip length within 0.1 mm', () => {
    const poly = sectionPolygon(SSMA_362S162_54)
    const { zMin, zMax, yMin, yMax } = bbox(poly)
    const { thickness_mm: t, webDepth_mm: D, flangeWidth_mm: B, lipLength_mm: L } = SSMA_362S162_54

    // Web depth = D = yMax - yMin
    expect(yMax - yMin).toBeCloseTo(D, 1)
    // Flange width = B = (flange tip z) - (web back z) = (B - t/2) - (-t/2) = B
    expect(zMax - zMin).toBeCloseTo(B, 1)
    // Web back at z = -t/2
    expect(zMin).toBeCloseTo(-t / 2, 1)
    // Flange tip at z = B - t/2
    expect(zMax).toBeCloseTo(B - t / 2, 1)
    // Lip length: distance from outer-flange-edge (y = D/2) to lip-bottom edge (y = D/2 - L)
    const lipBottom = poly.find(([z, y]) => z === B - t / 2 && Math.abs(y - (D / 2 - L)) < 1e-6)
    expect(lipBottom).toBeDefined()
  })

  it('GEO-01: C-section is CCW (positive signed area)', () => {
    const poly = sectionPolygon(SSMA_362S162_54)
    expect(signedArea(poly)).toBeGreaterThan(0)
  })

  it('GEO-01: C-section has 12 unique vertices', () => {
    expect(sectionPolygon(SSMA_362S162_54)).toHaveLength(12)
  })

  it('GEO-02: U-section has no lip return — 8 vertices', () => {
    const poly = sectionPolygon(SSMA_362T125_54)
    expect(poly).toHaveLength(8)
  })

  it('GEO-02: U-section is CCW', () => {
    expect(signedArea(sectionPolygon(SSMA_362T125_54))).toBeGreaterThan(0)
  })

  it('GEO-02: U-section bounding box matches web depth and flange width', () => {
    const poly = sectionPolygon(SSMA_362T125_54)
    const { zMin, zMax, yMin, yMax } = bbox(poly)
    const { thickness_mm: t, webDepth_mm: D, flangeWidth_mm: B } = SSMA_362T125_54
    expect(yMax - yMin).toBeCloseTo(D, 1)
    expect(zMax - zMin).toBeCloseTo(B, 1)
    expect(zMin).toBeCloseTo(-t / 2, 1)
    expect(zMax).toBeCloseTo(B - t / 2, 1)
  })

  it('GEO-03: Z-section flanges go opposite directions (z spans both signs)', () => {
    const poly = sectionPolygon(Z_SECTION)
    const { zMin, zMax } = bbox(poly)
    // For Z, the +z flange tip and -z flange tip are symmetric at ±(B - t/2).
    expect(zMin).toBeCloseTo(-(Z_SECTION.flangeWidth_mm - Z_SECTION.thickness_mm / 2), 6)
    expect(zMax).toBeCloseTo(Z_SECTION.flangeWidth_mm - Z_SECTION.thickness_mm / 2, 6)
  })

  it('GEO-03: Z-section is CCW with 12 vertices', () => {
    const poly = sectionPolygon(Z_SECTION)
    expect(poly).toHaveLength(12)
    expect(signedArea(poly)).toBeGreaterThan(0)
  })

  it('GEO-03: Z-section has both +y and -y lip-return vertices (180° rotation symmetry)', () => {
    const poly = sectionPolygon(Z_SECTION)
    const { thickness_mm: t, webDepth_mm: D, lipLength_mm: L } = Z_SECTION
    const tipRight = Z_SECTION.flangeWidth_mm - t / 2
    const tipLeft = -tipRight
    // Top lip's bottom-outer corner: (+tipRight, +D/2 - L)
    expect(poly.some(([z, y]) => Math.abs(z - tipRight) < 1e-6 && Math.abs(y - (D / 2 - L)) < 1e-6)).toBe(true)
    // Bottom lip's top-outer corner: (-tipRight, -D/2 + L)
    expect(poly.some(([z, y]) => Math.abs(z - tipLeft) < 1e-6 && Math.abs(y - (-D / 2 + L)) < 1e-6)).toBe(true)
  })

  it('GEO-04: HAT shape throws UnsupportedSectionShapeError in v1', () => {
    const hat: CFSSectionProperties = {
      ...SSMA_362S162_54,
      shape: 'HAT',
    }
    expect(() => sectionPolygon(hat)).toThrow(UnsupportedSectionShapeError)
    expect(() => sectionPolygon(hat)).toThrow(/HAT/)
  })

  it('C-section has greater 2D area than U-section of identical D, B, t (the lips add area)', () => {
    const props = { webDepth_mm: 100, flangeWidth_mm: 50, thickness_mm: 2, cornerRadius_mm: 0 }
    const c = sectionPolygon({ ...props, shape: 'C', lipLength_mm: 15 })
    const u = sectionPolygon({ ...props, shape: 'U', lipLength_mm: 0 })
    expect(signedArea(c)).toBeGreaterThan(signedArea(u))
  })
})
