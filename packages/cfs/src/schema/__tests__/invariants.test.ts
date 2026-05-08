import { describe, expect, it } from 'bun:test'
import { CFSMember } from '../cfs-member'
import { CFSOpening } from '../cfs-opening'
import { CFSPanel } from '../cfs-panel'
import { CFSServiceHole } from '../cfs-service-hole'
import { CFSWallFraming } from '../cfs-wall-framing'
import { type AnyCFSNode, checkCFSInvariants } from '../invariants'
import type { CFSMemberLibrary } from '../cfs-member-library'

const SEC = {
  stud: '88888888-8888-4888-a888-888888888888',
  track: '99999999-9999-4999-a999-999999999999',
  unknown: 'ffffffff-ffff-4fff-afff-ffffffffffff',
}
const FRAMING = '22222222-2222-4222-a222-222222222222'
const FRAMING_B = '22222222-2222-4222-b222-222222222222'
const MEMBER = '44444444-4444-4444-a444-444444444444'
const PANEL_A = '66666666-6666-4666-a666-666666666601'
const PANEL_B = '66666666-6666-4666-a666-666666666602'
const OPENING = '55555555-5555-4555-a555-555555555555'
const HOLE = '77777777-7777-4777-a777-777777777777'

const fakeLibrary: CFSMemberLibrary = {
  id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  name: 'fake',
  version: '1.0',
  sections: [
    {
      id: SEC.stud,
      designation: 'fake-stud',
      shape: 'C',
      properties: {
        shape: 'C',
        webDepth_mm: 100,
        flangeWidth_mm: 40,
        lipLength_mm: 12,
        thickness_mm: 1,
        cornerRadius_mm: 0,
      },
      material: {
        designation: 'test',
        yieldStrength_MPa: 345,
        tensileStrength_MPa: 448,
        modulusOfElasticity_MPa: 203_000,
        density_kgPerM3: 7850,
        coating: 'G60',
      },
      linearMass_kgPerM: 1,
    },
  ],
} as CFSMemberLibrary

const baseFraming = CFSWallFraming.parse({
  type: 'cfs_wall_framing',
  id: FRAMING,
  parentId: 'wall_xyz',
}) as AnyCFSNode

describe('checkCFSInvariants', () => {
  it('flags member.sectionResolves when section is missing from libraries', () => {
    const member = CFSMember.parse({
      type: 'cfs_member',
      id: MEMBER,
      parentId: FRAMING,
      role: 'stud',
      sectionId: SEC.unknown,
      start: { x_mm: 0, y_mm: 0, z_mm: 0 },
      end: { x_mm: 0, y_mm: 2743, z_mm: 0 },
    }) as AnyCFSNode

    const violations = checkCFSInvariants({
      nodes: { [FRAMING]: baseFraming, [MEMBER]: member },
      libraries: { [fakeLibrary.id]: fakeLibrary },
    })
    expect(violations.some((v) => v.rule === 'member.sectionResolves')).toBe(true)
  })

  it('flags member.parentExists when parent framing is absent', () => {
    const member = CFSMember.parse({
      type: 'cfs_member',
      id: MEMBER,
      parentId: FRAMING,
      role: 'stud',
      sectionId: SEC.stud,
      start: { x_mm: 0, y_mm: 0, z_mm: 0 },
      end: { x_mm: 0, y_mm: 2743, z_mm: 0 },
    }) as AnyCFSNode

    const violations = checkCFSInvariants({
      nodes: { [MEMBER]: member },
      libraries: { [fakeLibrary.id]: fakeLibrary },
    })
    expect(violations.some((v) => v.rule === 'member.parentExists')).toBe(true)
  })

  it('flags member.panelSameFraming when panel belongs to a different framing', () => {
    const otherFraming = CFSWallFraming.parse({
      type: 'cfs_wall_framing',
      id: FRAMING_B,
      parentId: 'wall_other',
    }) as AnyCFSNode
    const otherPanel = CFSPanel.parse({
      type: 'cfs_panel',
      id: PANEL_A,
      parentId: FRAMING_B,
      label: 'P',
      sequenceNumber: 1,
      startAlongWall_mm: 0,
      endAlongWall_mm: 1000,
    }) as AnyCFSNode
    const member = CFSMember.parse({
      type: 'cfs_member',
      id: MEMBER,
      parentId: FRAMING,
      role: 'stud',
      sectionId: SEC.stud,
      start: { x_mm: 0, y_mm: 0, z_mm: 0 },
      end: { x_mm: 0, y_mm: 2743, z_mm: 0 },
      panelId: PANEL_A,
    }) as AnyCFSNode

    const violations = checkCFSInvariants({
      nodes: {
        [FRAMING]: baseFraming,
        [FRAMING_B]: otherFraming,
        [PANEL_A]: otherPanel,
        [MEMBER]: member,
      },
      libraries: { [fakeLibrary.id]: fakeLibrary },
    })
    expect(violations.some((v) => v.rule === 'member.panelSameFraming')).toBe(true)
  })

  it('flags panel.endAfterStart when start >= end', () => {
    const panel = CFSPanel.parse({
      type: 'cfs_panel',
      id: PANEL_A,
      parentId: FRAMING,
      label: 'P',
      sequenceNumber: 1,
      startAlongWall_mm: 1000,
      endAlongWall_mm: 1000.0001,
    }) as AnyCFSNode
    panel.endAlongWall_mm = panel.startAlongWall_mm
    const violations = checkCFSInvariants({
      nodes: { [FRAMING]: baseFraming, [PANEL_A]: panel },
      libraries: {},
    })
    expect(violations.some((v) => v.rule === 'panel.endAfterStart')).toBe(true)
  })

  it('flags panel.noOverlap when two panels overlap on the same framing', () => {
    const a = CFSPanel.parse({
      type: 'cfs_panel',
      id: PANEL_A,
      parentId: FRAMING,
      label: 'P-01',
      sequenceNumber: 1,
      startAlongWall_mm: 0,
      endAlongWall_mm: 2000,
    }) as AnyCFSNode
    const b = CFSPanel.parse({
      type: 'cfs_panel',
      id: PANEL_B,
      parentId: FRAMING,
      label: 'P-02',
      sequenceNumber: 2,
      startAlongWall_mm: 1500,
      endAlongWall_mm: 3000,
    }) as AnyCFSNode

    const violations = checkCFSInvariants({
      nodes: { [FRAMING]: baseFraming, [PANEL_A]: a, [PANEL_B]: b },
      libraries: {},
    })
    expect(violations.some((v) => v.rule === 'panel.noOverlap')).toBe(true)
  })

  it('flags opening.windowSillHeight when a window has no sill', () => {
    const opening = CFSOpening.parse({
      type: 'cfs_opening',
      id: OPENING,
      parentId: FRAMING,
      openingType: 'window',
      positionAlongWall_mm: 1000,
      roughDimensions: { width_mm: 900, height_mm: 1200 },
    }) as AnyCFSNode

    const violations = checkCFSInvariants({
      nodes: { [FRAMING]: baseFraming, [OPENING]: opening },
      libraries: {},
    })
    expect(violations.some((v) => v.rule === 'opening.windowSillHeight')).toBe(true)
  })

  it('flags opening.fitsWithinWall when opening overflows', () => {
    const opening = CFSOpening.parse({
      type: 'cfs_opening',
      id: OPENING,
      parentId: FRAMING,
      openingType: 'door',
      positionAlongWall_mm: 5000,
      roughDimensions: { width_mm: 1500, height_mm: 2100 },
    }) as AnyCFSNode

    const violations = checkCFSInvariants({
      nodes: { [FRAMING]: baseFraming, [OPENING]: opening },
      libraries: {},
      wallLength_mm: () => 6000,
    })
    expect(violations.some((v) => v.rule === 'opening.fitsWithinWall')).toBe(true)
  })

  it('flags hole.fitsWithinMember when the hole pokes past the member end', () => {
    const member = CFSMember.parse({
      type: 'cfs_member',
      id: MEMBER,
      parentId: FRAMING,
      role: 'stud',
      sectionId: SEC.stud,
      start: { x_mm: 0, y_mm: 0, z_mm: 0 },
      end: { x_mm: 0, y_mm: 1000, z_mm: 0 },
    }) as AnyCFSNode

    const hole = CFSServiceHole.parse({
      type: 'cfs_service_hole',
      id: HOLE,
      parentId: MEMBER,
      positionAlongMember_mm: 990,
      diameter_mm: 50,
    }) as AnyCFSNode

    const violations = checkCFSInvariants({
      nodes: { [FRAMING]: baseFraming, [MEMBER]: member, [HOLE]: hole },
      libraries: { [fakeLibrary.id]: fakeLibrary },
    })
    expect(violations.some((v) => v.rule === 'hole.fitsWithinMember')).toBe(true)
  })

  it('flags hole.oblongLength when oblong without proper length', () => {
    const member = CFSMember.parse({
      type: 'cfs_member',
      id: MEMBER,
      parentId: FRAMING,
      role: 'stud',
      sectionId: SEC.stud,
      start: { x_mm: 0, y_mm: 0, z_mm: 0 },
      end: { x_mm: 0, y_mm: 2000, z_mm: 0 },
    }) as AnyCFSNode

    const hole = CFSServiceHole.parse({
      type: 'cfs_service_hole',
      id: HOLE,
      parentId: MEMBER,
      positionAlongMember_mm: 500,
      diameter_mm: 40,
      shape: 'oblong',
      oblongLength_mm: 40,
    }) as AnyCFSNode

    const violations = checkCFSInvariants({
      nodes: { [FRAMING]: baseFraming, [MEMBER]: member, [HOLE]: hole },
      libraries: { [fakeLibrary.id]: fakeLibrary },
    })
    expect(violations.some((v) => v.rule === 'hole.oblongLength')).toBe(true)
  })
})
