import { describe, expect, it } from 'bun:test'
import { CFSMember } from '../cfs-member'
import { CFSPanel } from '../cfs-panel'
import { CFSServiceHole } from '../cfs-service-hole'
import { CFSWallFraming } from '../cfs-wall-framing'
import { CFSProjectSettings } from '../primitives'

const SECTION = '88888888-8888-4888-a888-888888888888'
const TRACK = '99999999-9999-4999-a999-999999999999'
const FRAMING = '22222222-2222-4222-a222-222222222222'
const MEMBER = '44444444-4444-4444-a444-444444444444'
const HOLE = '77777777-7777-4777-a777-777777777777'

describe('CFS schemas — Zod defaults', () => {
  it('CFSWallFraming defaults config nulls', () => {
    const node = CFSWallFraming.parse({
      type: 'cfs_wall_framing',
      id: FRAMING,
      parentId: 'wall_test',
    })
    expect(node.studSpacing_mm).toBeNull()
    expect(node.studSectionId).toBeNull()
    expect(node.trackSectionId).toBeNull()
    expect(node.defaultHeaderType).toBeNull()
    expect(node.wallHeight_mm).toBeNull()
  })

  it('CFSWallFraming defaults children to [] (Pascal cascade-delete relies on this field)', () => {
    const node = CFSWallFraming.parse({
      type: 'cfs_wall_framing',
      id: FRAMING,
      parentId: 'wall_test',
    })
    expect(node.children).toEqual([])
  })

  it('CFSMember defaults orientation_deg to 0 and serviceHoleIds to []', () => {
    const node = CFSMember.parse({
      type: 'cfs_member',
      id: MEMBER,
      parentId: FRAMING,
      role: 'stud',
      sectionId: SECTION,
      start: { x_mm: 0, y_mm: 0, z_mm: 0 },
      end: { x_mm: 0, y_mm: 2743, z_mm: 0 },
    })
    expect(node.orientation_deg).toBe(0)
    expect(node.serviceHoleIds).toEqual([])
    expect(node.panelId).toBeNull()
    expect(node.children).toEqual([])
  })

  it('CFSPanel defaults isManualBreak false', () => {
    const node = CFSPanel.parse({
      type: 'cfs_panel',
      id: '66666666-6666-4666-a666-666666666666',
      parentId: FRAMING,
      label: 'P-01',
      sequenceNumber: 1,
      startAlongWall_mm: 0,
      endAlongWall_mm: 1000,
    })
    expect(node.isManualBreak).toBe(false)
  })

  it('CFSServiceHole defaults compliance status to unchecked and shape to round', () => {
    const node = CFSServiceHole.parse({
      type: 'cfs_service_hole',
      id: HOLE,
      parentId: MEMBER,
      positionAlongMember_mm: 100,
      diameter_mm: 38.1,
    })
    expect(node.shape).toBe('round')
    expect(node.hasStiffener).toBe(false)
    expect(node.compliance.status).toBe('unchecked')
    expect(node.compliance.reasons).toEqual([])
  })

  it('CFSProjectSettings supplies SI defaults', () => {
    const settings = CFSProjectSettings.parse({
      defaultStudSection: SECTION,
      defaultTrackSection: TRACK,
    })
    expect(settings.defaultStudSpacing_mm).toBe(406.4)
    expect(settings.defaultHeaderType).toBe('box')
    expect(settings.panelMaxWidth_mm).toBe(3658)
    expect(settings.panelMaxWeight_kg).toBe(680)
    expect(settings.wallHeight_mm).toBe(2743)
    expect(settings.units).toBe('imperial')
  })
})
