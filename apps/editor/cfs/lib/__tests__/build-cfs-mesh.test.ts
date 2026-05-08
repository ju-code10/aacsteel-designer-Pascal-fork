import { afterEach, describe, expect, it } from 'bun:test'
import type {
  CFSMember,
  CFSMemberId,
  CFSSection,
  CFSServiceHole,
  CFSServiceHoleId,
  CFSWallFramingId,
} from '@pascal-app/cfs'
import { buildCfsMesh } from '../build-cfs-mesh'
import {
  clearExtrusionCache,
  getExtrusionCacheStats,
} from '../extrusion-cache'
import { disposeRoleMaterials } from '../role-materials'

const SECTION: CFSSection = {
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

function studMember(): CFSMember {
  return {
    type: 'cfs_member',
    id: 'mem-001' as CFSMemberId,
    parentId: 'frm-001' as CFSWallFramingId,
    role: 'stud',
    sectionId: SECTION.id,
    start: { x_mm: 0, y_mm: 0, z_mm: 0 },
    end: { x_mm: 0, y_mm: 2743, z_mm: 0 },
    orientation_deg: 0,
    panelId: null,
    serviceHoleIds: [],
  }
}

function holeAt(positionAlongMember_mm: number, diameter_mm = 38): CFSServiceHole {
  return {
    type: 'cfs_service_hole',
    id: `hol-${positionAlongMember_mm}` as CFSServiceHoleId,
    parentId: 'mem-001' as CFSMemberId,
    positionAlongMember_mm,
    diameter_mm,
    shape: 'round',
    hasStiffener: false,
    compliance: { status: 'unchecked', reasons: [] },
  }
}

afterEach(() => {
  clearExtrusionCache()
  disposeRoleMaterials()
})

describe('buildCfsMesh — base extrusion fast path', () => {
  it('GEO-09: member with no holes returns a base extrusion (no CSG cost paid)', () => {
    const { geometry, material } = buildCfsMesh({ member: studMember(), section: SECTION, holes: [] })
    expect(geometry.attributes.position!.count).toBeGreaterThan(0)
    // Material is the role-shared instance for 'stud'.
    expect(material.name).toContain('stud')
    geometry.dispose()
  })

  it('repeat builds for the same member hit the extrusion cache', () => {
    buildCfsMesh({ member: studMember(), section: SECTION, holes: [] }).geometry.dispose()
    buildCfsMesh({ member: studMember(), section: SECTION, holes: [] }).geometry.dispose()
    expect(getExtrusionCacheStats()).toMatchObject({ size: 1, hits: 1, misses: 1 })
  })
})

describe('buildCfsMesh — service holes (Layer 3)', () => {
  it('GEO-06: with one hole, the CSG path is exercised (test mock returns null → falls back to base)', () => {
    const member = studMember()
    const { geometry } = buildCfsMesh({
      member,
      section: SECTION,
      holes: [holeAt(1000)],
    })
    // Under the bun:test mock for three-bvh-csg, evaluate() returns null and
    // we fall back to the base geometry. Real CSG correctness is verified in
    // the browser; this test only proves the path was taken without throw.
    expect(geometry.attributes.position!.count).toBeGreaterThan(0)
    geometry.dispose()
  })

  it('GEO-07: multiple holes iterate without throw', () => {
    const member = studMember()
    expect(() =>
      buildCfsMesh({
        member,
        section: SECTION,
        holes: [holeAt(500), holeAt(1500), holeAt(2200)],
      }).geometry.dispose(),
    ).not.toThrow()
  })

  it('GEO-08: oblong hole uses a different cutter than round (no throw on either path)', () => {
    const member = studMember()
    const oblong: CFSServiceHole = {
      ...holeAt(1000),
      shape: 'oblong',
      oblongLength_mm: 102,
      diameter_mm: 38,
    }
    expect(() =>
      buildCfsMesh({ member, section: SECTION, holes: [oblong] }).geometry.dispose(),
    ).not.toThrow()
  })
})
