import { describe, expect, it } from 'bun:test'
import { CFSMember } from '../cfs-member'
import { CFSMemberLibrary, CFSSection } from '../cfs-member-library'
import { CFSOpening } from '../cfs-opening'
import { CFSPanel } from '../cfs-panel'
import { CFSProject } from '../cfs-project'
import { CFSServiceHole } from '../cfs-service-hole'
import { CFSWallFraming } from '../cfs-wall-framing'

// UUIDs used in this round-trip test. These shadow the §3.11 worked-example
// shape (project + framing + 2 members + opening + panel + service hole) but
// use real UUIDs because the schema-level branded ids require z.uuid().
const ID = {
  proj: '11111111-1111-4111-a111-111111111111',
  site: 'site_canonicalwallroot',
  wall: 'wall_canonicalwallparent',
  frm: '22222222-2222-4222-a222-222222222222',
  memBottomTrack: '33333333-3333-4333-a333-333333333333',
  memStud: '44444444-4444-4444-a444-444444444444',
  opening: '55555555-5555-4555-a555-555555555555',
  panel: '66666666-6666-4666-a666-666666666666',
  hole: '77777777-7777-4777-a777-777777777777',
  studSection: '88888888-8888-4888-a888-888888888888',
  trackSection: '99999999-9999-4999-a999-999999999999',
  ssmaLibrary: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
}

describe('CFS schemas — §3.11 worked-example round-trip', () => {
  it('parses a complete CFSProject', () => {
    const node = CFSProject.parse({
      type: 'cfs_project',
      id: ID.proj,
      parentId: ID.site,
      schemaVersion: '1.0.0',
      name: 'Demo project',
      settings: {
        defaultStudSpacing_mm: 406.4,
        defaultStudSection: ID.studSection,
        defaultTrackSection: ID.trackSection,
        defaultHeaderType: 'box',
        panelMaxWidth_mm: 3658,
        panelMaxWeight_kg: 680,
        wallHeight_mm: 2743,
        units: 'imperial',
      },
      libraries: [ID.ssmaLibrary],
      activeLibraryId: ID.ssmaLibrary,
      createdAt: '2026-04-29T14:00:00Z',
      updatedAt: '2026-04-29T14:00:00Z',
      metadata: {},
    })
    expect(node.type).toBe('cfs_project')
    expect(node.settings.defaultStudSpacing_mm).toBe(406.4)
  })

  it('parses a CFSWallFraming with all configs as null', () => {
    const node = CFSWallFraming.parse({
      type: 'cfs_wall_framing',
      id: ID.frm,
      parentId: ID.wall,
      studSpacing_mm: null,
      studSectionId: null,
      trackSectionId: null,
      defaultHeaderType: null,
      wallHeight_mm: null,
    })
    expect(node.studSpacing_mm).toBeNull()
    expect(node.cachedTotalWeight_kg).toBeUndefined()
  })

  it('parses two CFSMembers (track + stud)', () => {
    const track = CFSMember.parse({
      type: 'cfs_member',
      id: ID.memBottomTrack,
      parentId: ID.frm,
      role: 'bottom-track',
      sectionId: ID.trackSection,
      start: { x_mm: 0, y_mm: 0, z_mm: 0 },
      end: { x_mm: 6096, y_mm: 0, z_mm: 0 },
      orientation_deg: 0,
      panelId: ID.panel,
      serviceHoleIds: [],
    })
    const stud = CFSMember.parse({
      type: 'cfs_member',
      id: ID.memStud,
      parentId: ID.frm,
      role: 'stud',
      sectionId: ID.studSection,
      start: { x_mm: 1219.2, y_mm: 0, z_mm: 0 },
      end: { x_mm: 1219.2, y_mm: 2743, z_mm: 0 },
      orientation_deg: 0,
      panelId: ID.panel,
      serviceHoleIds: [ID.hole],
    })
    expect(track.role).toBe('bottom-track')
    expect(stud.serviceHoleIds).toEqual([ID.hole])
  })

  it('parses a window CFSOpening', () => {
    const opening = CFSOpening.parse({
      type: 'cfs_opening',
      id: ID.opening,
      parentId: ID.frm,
      openingType: 'window',
      positionAlongWall_mm: 2438.4,
      roughDimensions: { width_mm: 914.4, height_mm: 1219.2 },
      sillHeight_mm: 914.4,
      headerTypeOverride: null,
      generatedMemberIds: [],
    })
    expect(opening.openingType).toBe('window')
  })

  it('parses a CFSPanel', () => {
    const panel = CFSPanel.parse({
      type: 'cfs_panel',
      id: ID.panel,
      parentId: ID.frm,
      label: 'P-01',
      sequenceNumber: 1,
      startAlongWall_mm: 0,
      endAlongWall_mm: 3657.6,
      isManualBreak: false,
    })
    expect(panel.sequenceNumber).toBe(1)
  })

  it('parses a CFSServiceHole with compliance verdict', () => {
    const hole = CFSServiceHole.parse({
      type: 'cfs_service_hole',
      id: ID.hole,
      parentId: ID.memStud,
      positionAlongMember_mm: 1371.6,
      diameter_mm: 38.1,
      shape: 'round',
      hasStiffener: false,
      compliance: {
        status: 'compliant',
        reasons: [],
        checkedAt: '2026-04-29T14:32:11Z',
      },
    })
    expect(hole.compliance.status).toBe('compliant')
  })
})

describe('CFSSection — prePunchPattern (Slice 6 / R-03)', () => {
  const baseStud = {
    id: ID.studSection,
    designation: '362S162-54',
    shape: 'C' as const,
    properties: {
      shape: 'C' as const,
      webDepth_mm: 92.1,
      flangeWidth_mm: 41.3,
      lipLength_mm: 12.7,
      thickness_mm: 1.37,
      cornerRadius_mm: 2.06,
    },
    material: {
      designation: 'ASTM A1003 ST50H',
      yieldStrength_MPa: 345,
      tensileStrength_MPa: 448,
      modulusOfElasticity_MPa: 203_000,
      density_kgPerM3: 7850,
      coating: 'G60',
    },
    linearMass_kgPerM: 1.61,
  }

  it('round-trips a stud section with prePunchPattern', () => {
    const section = CFSSection.parse({
      ...baseStud,
      prePunchPattern: {
        firstPosition_mm: 305,
        spacing_mm: 610,
        length_mm: 102,
        width_mm: 38,
      },
    })
    expect(section.prePunchPattern).toEqual({
      firstPosition_mm: 305,
      spacing_mm: 610,
      length_mm: 102,
      width_mm: 38,
    })
    // Re-parsing the serialized form yields an identical object.
    const reparsed = CFSSection.parse(JSON.parse(JSON.stringify(section)))
    expect(reparsed.prePunchPattern).toEqual(section.prePunchPattern)
  })

  it('accepts a track section without prePunchPattern (field absent)', () => {
    const track = CFSSection.parse({
      ...baseStud,
      id: ID.trackSection,
      designation: '362T125-54',
      shape: 'U' as const,
      properties: { ...baseStud.properties, shape: 'U' as const, lipLength_mm: 0 },
    })
    expect(track.prePunchPattern).toBeUndefined()
  })

  it('rejects negative spacing', () => {
    expect(() =>
      CFSSection.parse({
        ...baseStud,
        prePunchPattern: {
          firstPosition_mm: 305,
          spacing_mm: -1,
          length_mm: 102,
          width_mm: 38,
        },
      }),
    ).toThrow()
  })

  it('shipped SSMA library populates prePunchPattern on every stud', async () => {
    // Walks the actual ssma.json shipped with the package.
    const { ssmaLibraryJson } = await import('../../library/load-ssma')
    const lib = CFSMemberLibrary.parse(ssmaLibraryJson)
    const studs = lib.sections.filter((s) => s.shape === 'C')
    const tracks = lib.sections.filter((s) => s.shape === 'U')
    expect(studs.length).toBeGreaterThanOrEqual(6)
    for (const stud of studs) {
      expect(stud.prePunchPattern).toBeDefined()
      expect(stud.prePunchPattern!.firstPosition_mm).toBe(305)
      expect(stud.prePunchPattern!.spacing_mm).toBe(610)
    }
    for (const track of tracks) {
      expect(track.prePunchPattern).toBeUndefined()
    }
  })
})

describe('CFS schemas — strict() rejects unknown keys', () => {
  it('rejects unknown keys on CFSProject', () => {
    expect(() =>
      CFSProject.parse({
        type: 'cfs_project',
        id: ID.proj,
        parentId: ID.site,
        schemaVersion: '1.0.0',
        settings: {
          defaultStudSection: ID.studSection,
          defaultTrackSection: ID.trackSection,
        },
        libraries: [ID.ssmaLibrary],
        activeLibraryId: ID.ssmaLibrary,
        createdAt: '2026-04-29T14:00:00Z',
        updatedAt: '2026-04-29T14:00:00Z',
        nonsense: 'should-fail',
      }),
    ).toThrow()
  })

  it('rejects unknown keys on CFSMember', () => {
    expect(() =>
      CFSMember.parse({
        type: 'cfs_member',
        id: ID.memStud,
        parentId: ID.frm,
        role: 'stud',
        sectionId: ID.studSection,
        start: { x_mm: 0, y_mm: 0, z_mm: 0 },
        end: { x_mm: 0, y_mm: 1, z_mm: 0 },
        nonsense: true,
      }),
    ).toThrow()
  })
})
