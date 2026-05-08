import {
  type CFSSection,
  type CFSSectionId,
  type Polygon2D,
  sectionPolygon,
} from '@pascal-app/cfs'
import * as THREE from 'three'

/**
 * §5.3 layer 2 — base extrusion cache.
 *
 * Cache key: `(sectionId, length_mm rounded to 1 mm, orientation_deg rounded
 * to 1 deg)`. Cache value: a cloneable `THREE.BufferGeometry` whose
 * extrusion is centered on the origin so that the extruded member spans
 * Z ∈ [-length/2, +length/2] in METERS (Pascal scene units, per
 * §0.5: scene storage is mm but the Three.js scene is in meters via the
 * 1/1000 conversion at the editor boundary).
 *
 * Cache scope: process-wide. The geometry is shared across cache lookups via
 * `clone()` so that disposing one mesh's geometry does not break others. The
 * cache itself disposes its templates only when `clearExtrusionCache()`
 * is called (page navigation / scene reset).
 *
 * Cross-section orientation: the cross-section is placed in the local
 * XY plane with shape-X = polygon's z_cs (flange direction) and shape-Y =
 * polygon's y_cs (web direction). Extrusion is along the local +Z axis.
 * `orientation_deg` rotates the cross-section about local Z before
 * extrusion. A v1 simplification: since the Slice 3/4 framing system always
 * emits `orientation_deg = 0`, the about-axis-of-member orientation may not
 * always match a builder's expectation (e.g., top-track flange direction);
 * this is an acceptable v1 polish gap, recorded for a future spec slice
 * that pairs role with the correct orientation_deg.
 */

const MM_PER_METER = 1000

export interface ExtrusionCacheStats {
  size: number
  bytes: number
  hits: number
  misses: number
}

interface CacheEntry {
  geometry: THREE.BufferGeometry
  /** Approximate byte cost of the buffer payload (positions + indices + normals). */
  bytes: number
}

const cache = new Map<string, CacheEntry>()
const stats = { hits: 0, misses: 0 }

function cacheKey(sectionId: CFSSectionId, length_mm: number, orientation_deg: number): string {
  // Round length to 1 mm and orientation to 1° per spec line 494. The integer
  // round yields the same key for equivalent inputs even when float arithmetic
  // gives e.g. 2742.999999 vs 2743.0.
  const lenInt = Math.round(length_mm)
  const orientInt = Math.round(orientation_deg)
  return `${sectionId}|${lenInt}|${orientInt}`
}

function buildShape(polygon: Polygon2D, orientation_deg: number): THREE.Shape {
  const shape = new THREE.Shape()
  // Polygon vertices are [z_cs, y_cs] in mm. Convert to meters at this
  // boundary so the resulting geometry is in Pascal's scene units.
  const cos = Math.cos((orientation_deg * Math.PI) / 180)
  const sin = Math.sin((orientation_deg * Math.PI) / 180)
  for (let i = 0; i < polygon.length; i++) {
    const v = polygon[i]
    if (!v) continue
    const z_m = v[0] / MM_PER_METER
    const y_m = v[1] / MM_PER_METER
    // Rotate the cross-section about local Z (member axis) by orientation_deg.
    // The polygon lives in the (shape-X, shape-Y) plane; rotation here is the
    // standard 2D rotation in that plane.
    const x = z_m * cos - y_m * sin
    const y = z_m * sin + y_m * cos
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  return shape
}

function buildExtrusion(
  section: CFSSection,
  length_mm: number,
  orientation_deg: number,
): THREE.BufferGeometry {
  const polygon = sectionPolygon(section.properties)
  const shape = buildShape(polygon, orientation_deg)
  const length_m = length_mm / MM_PER_METER

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: length_m,
    bevelEnabled: false,
    curveSegments: 1, // polygon corners are sharp; no curves to subdivide
    steps: 1, // single extrusion step is enough for a straight prism
  })

  // Center the extrusion along its axis so the geometry origin is the
  // midpoint of the member. Placement of the mesh becomes "set position to
  // (start + end) / 2" with no further translation.
  geom.translate(0, 0, -length_m / 2)
  geom.computeVertexNormals()
  geom.computeBoundingBox()
  geom.computeBoundingSphere()

  return geom
}

function estimateBytes(geom: THREE.BufferGeometry): number {
  let bytes = 0
  for (const attr of Object.values(geom.attributes)) {
    bytes += attr.array.byteLength
  }
  if (geom.index) bytes += geom.index.array.byteLength
  return bytes
}

/**
 * Returns a fresh `BufferGeometry` clone of the cached extrusion. Caller owns
 * the returned geometry and must `dispose()` it when the mesh is removed.
 *
 * On cache miss, builds and stores. On hit, clones the cached template.
 */
export function getCachedExtrusion(
  section: CFSSection,
  length_mm: number,
  orientation_deg: number,
): THREE.BufferGeometry {
  const key = cacheKey(section.id, length_mm, orientation_deg)
  const hit = cache.get(key)
  if (hit) {
    stats.hits++
    return hit.geometry.clone()
  }
  const built = buildExtrusion(section, length_mm, orientation_deg)
  cache.set(key, { geometry: built, bytes: estimateBytes(built) })
  stats.misses++
  return built.clone()
}

export function getExtrusionCacheStats(): ExtrusionCacheStats {
  let bytes = 0
  for (const e of cache.values()) bytes += e.bytes
  return { size: cache.size, bytes, hits: stats.hits, misses: stats.misses }
}

/** Disposes every cached template and resets stats. */
export function clearExtrusionCache(): void {
  for (const e of cache.values()) e.geometry.dispose()
  cache.clear()
  stats.hits = 0
  stats.misses = 0
}
