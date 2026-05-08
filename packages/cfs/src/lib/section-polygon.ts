import type { CFSSectionProperties } from '../schema/primitives'

/**
 * §5.3 layer 1 — cross-section polygon construction.
 *
 * Builds the closed perimeter of a CFS steel section in the (z, y) plane:
 *   - web centered on z = 0 (web spans z ∈ [-t/2, +t/2])
 *   - flanges open toward +z for C and U; for Z the top flange opens +z and
 *     the bottom flange opens -z
 *   - polygon traversed counterclockwise as a single non-self-intersecting
 *     loop (positive signed area), so `THREE.Shape` triangulates it with
 *     outward-facing front-cap normals when the editor extrudes it
 *
 * Vertices are returned as `[z_mm, y_mm]` tuples. The package stays
 * three.js-free; the editor-side caller turns these into `THREE.Vector2`
 * instances when constructing a `THREE.Shape`. See spec §0.5 for the unit
 * convention (all numerics are SI, mm).
 *
 * Origin at the centerline of the web (web mid-thickness, web mid-depth)
 * matches §3.5: "Endpoints define the centerline of the web." A member
 * placed at world position P sees its web pass through P, with flanges
 * hanging off in the +z direction (or both directions for Z).
 *
 * v1 ships sharp corners. `cornerRadius_mm > 0` is silently ignored — SSMA
 * sections publish radii around 2 mm which are not visible at building scale,
 * and the spec explicitly authorises a 4-segment-arc approximation as a
 * deferred polish item (spec §5.3 line 484; recorded for v2).
 */
export type Polygon2D = readonly (readonly [number, number])[]

export class UnsupportedSectionShapeError extends Error {
  constructor(shape: string) {
    super(`CFS section shape ${shape} is not supported in v1 (spec §5.3 layer 1).`)
    this.name = 'UnsupportedSectionShapeError'
  }
}

export function sectionPolygon(props: CFSSectionProperties): Polygon2D {
  const { shape, webDepth_mm, flangeWidth_mm, lipLength_mm, thickness_mm } = props

  switch (shape) {
    case 'C':
      return cChannelPolygon(webDepth_mm, flangeWidth_mm, lipLength_mm, thickness_mm)
    case 'U':
      return uChannelPolygon(webDepth_mm, flangeWidth_mm, thickness_mm)
    case 'Z':
      return zSectionPolygon(webDepth_mm, flangeWidth_mm, lipLength_mm, thickness_mm)
    case 'HAT':
      throw new UnsupportedSectionShapeError(shape)
  }
}

/**
 * Lipped channel (C). Web on the -z side of the centerline, flanges and lips
 * extend toward +z. Lips return back toward the web direction (parallel to
 * the web).
 *
 * Trace CCW (positive signed area) starting at the back-top of the web.
 * 12 unique vertices.
 */
function cChannelPolygon(D: number, B: number, L: number, t: number): Polygon2D {
  const h = t / 2
  const d = D / 2
  // Flange tip is `B` from the back of the web; with web back at z = -h,
  // the flange tip is at z = -h + B = B - h.
  const tip = B - h
  const innerTip = tip - t

  return [
    [-h, +d], //  1: back-top corner of web
    [-h, -d], //  2: down the back face of the web (to back-bottom)
    [tip, -d], //  3: across the bottom edge (collinear with bottom of bottom flange + bottom of bottom lip)
    [tip, -d + L], //  4: up the outer face of the bottom lip
    [innerTip, -d + L], //  5: across the top of the bottom lip
    [innerTip, -d + t], //  6: down the inner face of the bottom lip
    [+h, -d + t], //  7: across the inner face of the bottom flange to the web
    [+h, +d - t], //  8: up the +z (inner) face of the web
    [innerTip, +d - t], //  9: across the inner face of the top flange
    [innerTip, +d - L], // 10: down the inner face of the top lip
    [tip, +d - L], // 11: across the bottom of the top lip
    [tip, +d], // 12: up the outer face of the top lip; closes back to vertex 1 across the top edge
  ]
}

/**
 * Unlipped channel (U / track). Same skeleton as C with the lip steps
 * removed. 8 unique vertices.
 */
function uChannelPolygon(D: number, B: number, t: number): Polygon2D {
  const h = t / 2
  const d = D / 2
  const tip = B - h

  return [
    [-h, +d], // 1: back-top of web
    [-h, -d], // 2: back-bottom of web
    [tip, -d], // 3: outer-bottom of bottom flange tip
    [tip, -d + t], // 4: outer-top of bottom flange tip (short t-length segment)
    [+h, -d + t], // 5: across inner face of bottom flange to web
    [+h, +d - t], // 6: up the +z (inner) face of the web
    [tip, +d - t], // 7: across inner face of top flange to outer-bottom of top flange tip
    [tip, +d], // 8: up the outer face of top flange tip; closes back to vertex 1 across the top edge
  ]
}

/**
 * Z-section. Top flange opens +z, bottom flange opens -z. Top lip turns DOWN
 * (-y) from the top flange tip; bottom lip turns UP (+y) from the bottom
 * flange tip.
 *
 * 12 unique vertices, traced CCW starting at the back-top of the web's -z
 * face. The polygon is rotation-symmetric about the centerline (rotating
 * 180° about the x-axis maps each vertex to another).
 */
function zSectionPolygon(D: number, B: number, L: number, t: number): Polygon2D {
  const h = t / 2
  const d = D / 2
  const tipRight = B - h // +z flange tip
  const tipLeft = -(B - h) // -z flange tip
  const innerRight = tipRight - t
  const innerLeft = tipLeft + t

  return [
    [-h, +d], //  1: top-left corner of web (top of -z face)
    [-h, -d + t], //  2: down -z face of web to where bottom flange's inner-top face attaches
    [innerLeft, -d + t], //  3: across inner-top face of bottom flange to where bottom lip starts
    [innerLeft, -d + L], //  4: up inner face of bottom lip
    [tipLeft, -d + L], //  5: across top of bottom lip
    [tipLeft, -d], //  6: down outer face of bottom lip; bottom-left of section
    [+h, -d], //  7: across the bottom edge (collinear: bottom of bottom lip + flange + web)
    [+h, +d - t], //  8: up +z face of web to where top flange's inner-bottom face attaches
    [innerRight, +d - t], //  9: across inner face of top flange to where top lip starts
    [innerRight, +d - L], // 10: down inner face of top lip
    [tipRight, +d - L], // 11: across bottom of top lip
    [tipRight, +d], // 12: up outer face of top lip; closes back to vertex 1 across the top edge
  ]
}
