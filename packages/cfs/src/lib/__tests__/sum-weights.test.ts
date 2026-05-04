import { describe, expect, it } from 'bun:test'
import { ssmaLibraryJson, parseLibrary } from '../../library/load-ssma'
import { CFSMember } from '../../schema/cfs-member'
import type { CFSMemberId, CFSWallFramingId } from '../../schema/ids'
import { sumWeights } from '../sum-weights'

const FRAMING_ID = '11111111-1111-4111-8111-111111111111' as unknown as CFSWallFramingId

let nextUuid = 0
function uuid(): CFSMemberId {
  nextUuid += 1
  const seg = nextUuid.toString(16).padStart(12, '0')
  return `00000000-0000-4000-8000-${seg}` as unknown as CFSMemberId
}

describe('sumWeights', () => {
  it('returns zero for an empty member list', () => {
    const library = parseLibrary(ssmaLibraryJson)
    expect(sumWeights([], library)).toBe(0)
  })

  it('weight equals (length_m × linearMass) summed across members', () => {
    const library = parseLibrary(ssmaLibraryJson)
    const stud = library.sections.find((s) => s.shape === 'C')
    if (!stud) throw new Error('expected at least one C section in SSMA seed')

    const m = CFSMember.parse({
      type: 'cfs_member',
      id: uuid(),
      parentId: FRAMING_ID,
      role: 'stud',
      sectionId: stud.id,
      start: { x_mm: 0, y_mm: 0, z_mm: 0 },
      end: { x_mm: 0, y_mm: 2700, z_mm: 0 },
    })

    const expected_kg = (2700 / 1000) * stud.linearMass_kgPerM
    expect(sumWeights([m, m], library)).toBeCloseTo(expected_kg * 2, 6)
  })

  it('skips members whose section is not in the library', () => {
    const library = parseLibrary(ssmaLibraryJson)
    const m = CFSMember.parse({
      type: 'cfs_member',
      id: uuid(),
      parentId: FRAMING_ID,
      role: 'stud',
      sectionId: '99999999-9999-4999-8999-999999999999',
      start: { x_mm: 0, y_mm: 0, z_mm: 0 },
      end: { x_mm: 0, y_mm: 2700, z_mm: 0 },
    })
    expect(sumWeights([m], library)).toBe(0)
  })
})
