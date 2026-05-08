import { afterEach, describe, expect, it } from 'bun:test'
import type {
  CFSMember,
  CFSMemberId,
  CFSSection,
  CFSWallFramingId,
} from '@pascal-app/cfs'
import {
  buildInstancedStudGroup,
  groupFieldStudsByInstance,
} from '../instanced-stud-group'
import { clearExtrusionCache } from '../extrusion-cache'
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

function studAt(x_m: number, role: CFSMember['role'] = 'stud'): CFSMember {
  return {
    type: 'cfs_member',
    id: `mem-${x_m}` as CFSMemberId,
    parentId: 'frm-001' as CFSWallFramingId,
    role,
    sectionId: SECTION.id,
    start: { x_mm: x_m * 1000, y_mm: 0, z_mm: 0 },
    end: { x_mm: x_m * 1000, y_mm: 2743, z_mm: 0 },
    orientation_deg: 0,
    panelId: null,
    serviceHoleIds: [],
  }
}

afterEach(() => {
  clearExtrusionCache()
  disposeRoleMaterials()
})

describe('buildInstancedStudGroup', () => {
  it('GEO-05: 10 field studs collapse into a single InstancedMesh', () => {
    const studs: CFSMember[] = []
    for (let i = 0; i < 10; i++) studs.push(studAt(0.6 * i))
    const handle = buildInstancedStudGroup(studs, SECTION)
    expect(handle.mesh.count).toBe(10)
    expect(handle.mesh.isInstancedMesh).toBe(true)
    expect(handle.instanceIdToMemberId).toHaveLength(10)
    handle.dispose()
  })

  it('exposes instanceId → memberId mapping in mesh.userData (for picking)', () => {
    const studs = [studAt(0), studAt(0.6), studAt(1.2)]
    const handle = buildInstancedStudGroup(studs, SECTION)
    const mapping = (handle.mesh.userData as Record<string, unknown>).instanceIdToMemberId
    expect(mapping).toEqual(handle.instanceIdToMemberId)
    expect(handle.instanceIdToMemberId[0]).toBe(studs[0]!.id)
    expect(handle.instanceIdToMemberId[2]).toBe(studs[2]!.id)
    handle.dispose()
  })

  it('uses the role-shared "stud" material', () => {
    const handle = buildInstancedStudGroup([studAt(0)], SECTION)
    const mat = handle.mesh.material as { name: string }
    expect(mat.name).toContain('stud')
    handle.dispose()
  })

  it('rejects an empty stud list (programmer error)', () => {
    expect(() => buildInstancedStudGroup([], SECTION)).toThrow(/empty/i)
  })

  it('places each instance at the member midpoint (in meters)', () => {
    const studs = [studAt(0), studAt(0.6), studAt(1.2)]
    const handle = buildInstancedStudGroup(studs, SECTION)
    // Read the matrix back; the translation column carries the midpoint.
    const tmp = new (require('three').Matrix4)()
    handle.mesh.getMatrixAt(0, tmp)
    // Stud at x=0 m, vertical from y=0 to y=2.743 m → midpoint (0, 1.3715, 0)
    const e = tmp.elements
    expect(e[12]).toBeCloseTo(0, 5)
    expect(e[13]).toBeCloseTo(2.743 / 2, 5)
    expect(e[14]).toBeCloseTo(0, 5)
    handle.mesh.getMatrixAt(2, tmp)
    expect(tmp.elements[12]).toBeCloseTo(1.2, 5)
    handle.dispose()
  })
})

describe('groupFieldStudsByInstance', () => {
  it('groups studs by (sectionId, orientation_deg)', () => {
    const studs: CFSMember[] = [
      studAt(0),
      studAt(0.6),
      studAt(1.2),
    ]
    const { groups, nonInstanced } = groupFieldStudsByInstance(studs)
    expect(groups.size).toBe(1)
    expect(nonInstanced).toEqual([])
    const onlyGroup = groups.values().next().value!
    expect(onlyGroup).toHaveLength(3)
  })

  it('separates non-stud roles into nonInstanced', () => {
    const members: CFSMember[] = [
      studAt(0),
      studAt(0.6, 'king-stud'),
      studAt(1.2, 'jamb-stud'),
      studAt(1.8, 'header'),
      studAt(2.4),
    ]
    const { groups, nonInstanced } = groupFieldStudsByInstance(members)
    const totalInGroups = Array.from(groups.values()).reduce((s, b) => s + b.length, 0)
    expect(totalInGroups).toBe(2)
    expect(nonInstanced).toHaveLength(3)
    expect(nonInstanced.map((m) => m.role)).toEqual(['king-stud', 'jamb-stud', 'header'])
  })

  it('separates studs with different orientations into separate groups', () => {
    const a = studAt(0)
    const b: CFSMember = { ...studAt(0.6), orientation_deg: 90 }
    const { groups } = groupFieldStudsByInstance([a, b])
    expect(groups.size).toBe(2)
  })
})
