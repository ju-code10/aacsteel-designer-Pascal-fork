import { afterEach, describe, expect, it } from 'bun:test'
import type { CFSSection } from '@pascal-app/cfs'
import {
  clearExtrusionCache,
  getCachedExtrusion,
  getExtrusionCacheStats,
} from '../extrusion-cache'

const SSMA_362S162_54: CFSSection = {
  id: 'sec-362S162-54',
  designation: '362S162-54',
  shape: 'C',
  properties: {
    shape: 'C',
    webDepth_mm: 92,
    flangeWidth_mm: 41,
    lipLength_mm: 13,
    thickness_mm: 1.37,
    cornerRadius_mm: 0,
  },
  material: {
    designation: 'ASTM A653 SS50',
    yieldStrength_MPa: 345,
    tensileStrength_MPa: 450,
    modulusOfElasticity_MPa: 203000,
    density_kgPerM3: 7850,
    coating: 'G60 galvanized',
  },
  linearMass_kgPerM: 1.93,
}

const SSMA_362T125_54: CFSSection = {
  ...SSMA_362S162_54,
  id: 'sec-362T125-54',
  designation: '362T125-54',
  shape: 'U',
  properties: { ...SSMA_362S162_54.properties, shape: 'U', flangeWidth_mm: 32, lipLength_mm: 0 },
}

afterEach(() => {
  clearExtrusionCache()
})

describe('extrusionCache', () => {
  it('GEO-10: cache miss on first call to a new (section, length) pair', () => {
    expect(getExtrusionCacheStats()).toMatchObject({ size: 0, hits: 0, misses: 0 })
    const geom = getCachedExtrusion(SSMA_362S162_54, 2743, 0)
    expect(geom).toBeDefined()
    expect(getExtrusionCacheStats()).toMatchObject({ size: 1, hits: 0, misses: 1 })
    geom.dispose()
  })

  it('GEO-10: cache hit on a repeat call with the same key', () => {
    const a = getCachedExtrusion(SSMA_362S162_54, 2743, 0)
    const b = getCachedExtrusion(SSMA_362S162_54, 2743, 0)
    expect(getExtrusionCacheStats()).toMatchObject({ size: 1, hits: 1, misses: 1 })
    // Different geometry instances (cloned), but same vertex/index counts.
    expect(a).not.toBe(b)
    expect(a.attributes.position!.count).toBe(b.attributes.position!.count)
    a.dispose()
    b.dispose()
  })

  it('GEO-11: cache hit if length rounds to the same mm value', () => {
    getCachedExtrusion(SSMA_362S162_54, 2743.0, 0)
    getCachedExtrusion(SSMA_362S162_54, 2743.4999, 0) // rounds to 2743
    expect(getExtrusionCacheStats()).toMatchObject({ size: 1, hits: 1, misses: 1 })
  })

  it('GEO-11: cache miss if length differs by >0.5 mm', () => {
    getCachedExtrusion(SSMA_362S162_54, 2743, 0)
    getCachedExtrusion(SSMA_362S162_54, 2744, 0)
    expect(getExtrusionCacheStats()).toMatchObject({ size: 2, hits: 0, misses: 2 })
  })

  it('different sections produce different cache entries even at the same length', () => {
    getCachedExtrusion(SSMA_362S162_54, 2743, 0)
    getCachedExtrusion(SSMA_362T125_54, 2743, 0)
    expect(getExtrusionCacheStats().size).toBe(2)
  })

  it('extrudes geometry centered along its Z axis (origin = midpoint of the member)', () => {
    const geom = getCachedExtrusion(SSMA_362S162_54, 2743, 0)
    const bbox = geom.boundingBox!
    // bounding box Z spans [-length/2, +length/2] in meters
    const halfLen = 2.743 / 2
    expect(bbox.min.z).toBeCloseTo(-halfLen, 4)
    expect(bbox.max.z).toBeCloseTo(+halfLen, 4)
    geom.dispose()
  })

  it('produces vertex normals (lit material renders correctly)', () => {
    const geom = getCachedExtrusion(SSMA_362S162_54, 2743, 0)
    expect(geom.attributes.normal).toBeDefined()
    expect(geom.attributes.normal!.count).toBe(geom.attributes.position!.count)
    geom.dispose()
  })

  it('clearExtrusionCache empties the cache and resets stats', () => {
    getCachedExtrusion(SSMA_362S162_54, 2743, 0)
    expect(getExtrusionCacheStats().size).toBe(1)
    clearExtrusionCache()
    expect(getExtrusionCacheStats()).toMatchObject({ size: 0, hits: 0, misses: 0 })
  })

  it('the byte estimate scales with geometry complexity (sanity)', () => {
    getCachedExtrusion(SSMA_362S162_54, 2743, 0)
    const oneSection = getExtrusionCacheStats().bytes
    expect(oneSection).toBeGreaterThan(0)
    getCachedExtrusion(SSMA_362T125_54, 2743, 0)
    const twoSections = getExtrusionCacheStats().bytes
    expect(twoSections).toBeGreaterThan(oneSection)
  })
})
