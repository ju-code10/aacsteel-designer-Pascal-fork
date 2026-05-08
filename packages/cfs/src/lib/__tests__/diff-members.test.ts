import { describe, expect, it } from 'bun:test'
import { CFSMember } from '../../schema/cfs-member'
import type { CFSMemberId, CFSSectionId, CFSWallFramingId } from '../../schema/ids'
import { diffMembers } from '../diff-members'

const FRAMING_ID = '11111111-1111-4111-8111-111111111111' as unknown as CFSWallFramingId
const SECTION_A = '22222222-2222-4222-8222-222222222222' as unknown as CFSSectionId
const SECTION_B = '33333333-3333-4333-8333-333333333333' as unknown as CFSSectionId

let nextUuid = 0
function uuid(): CFSMemberId {
  nextUuid += 1
  const seg = nextUuid.toString(16).padStart(12, '0')
  return `00000000-0000-4000-8000-${seg}` as unknown as CFSMemberId
}

function member(opts: {
  id?: CFSMemberId
  role?: CFSMember['role']
  sectionId?: CFSSectionId
  start?: { x: number; y: number; z: number }
  end?: { x: number; y: number; z: number }
}): CFSMember {
  return CFSMember.parse({
    type: 'cfs_member',
    id: opts.id ?? uuid(),
    parentId: FRAMING_ID,
    role: opts.role ?? 'stud',
    sectionId: opts.sectionId ?? SECTION_A,
    start: { x_mm: opts.start?.x ?? 0, y_mm: opts.start?.y ?? 0, z_mm: opts.start?.z ?? 0 },
    end: { x_mm: opts.end?.x ?? 0, y_mm: opts.end?.y ?? 2700, z_mm: opts.end?.z ?? 0 },
  })
}

describe('diffMembers', () => {
  it('emits creates for desired-only members', () => {
    const desired = [member({ start: { x: 600, y: 0, z: 0 } })]
    const result = diffMembers([], desired)
    expect(result.toCreate).toHaveLength(1)
    expect(result.toUpdate).toHaveLength(0)
    expect(result.toDelete).toHaveLength(0)
  })

  it('emits deletes for existing-only members', () => {
    const existing = [member({ start: { x: 600, y: 0, z: 0 } })]
    const result = diffMembers(existing, [])
    expect(result.toDelete).toEqual([existing[0].id])
  })

  it('matched identical members produce no work', () => {
    const e = member({ start: { x: 600, y: 0, z: 0 } })
    const d = member({ id: e.id, start: { x: 600, y: 0, z: 0 } })
    const result = diffMembers([e], [d])
    expect(result.toCreate).toHaveLength(0)
    expect(result.toUpdate).toHaveLength(0)
    expect(result.toDelete).toHaveLength(0)
  })

  it('within 1 mm tolerance is treated as the same key', () => {
    const e = member({ start: { x: 600.0, y: 0, z: 0 } })
    const d = member({ start: { x: 600.4, y: 0, z: 0 } })
    const result = diffMembers([e], [d])
    expect(result.toCreate).toHaveLength(0)
    expect(result.toDelete).toHaveLength(0)
    // start drift inside tolerance: pointsEqual treats them as equal, no update.
    expect(result.toUpdate).toHaveLength(0)
  })

  it('section change on a matched member emits an update with only sectionId', () => {
    const e = member({ start: { x: 600, y: 0, z: 0 }, sectionId: SECTION_A })
    const d = member({ start: { x: 600, y: 0, z: 0 }, sectionId: SECTION_B })
    const result = diffMembers([e], [d])
    expect(result.toUpdate).toHaveLength(1)
    expect(result.toUpdate[0]).toEqual({ id: e.id, changes: { sectionId: SECTION_B } })
  })

  it('role change forces delete + create (different keys)', () => {
    const e = member({ role: 'stud', start: { x: 0, y: 0, z: 0 } })
    const d = member({ role: 'chord-stud', start: { x: 0, y: 0, z: 0 } })
    const result = diffMembers([e], [d])
    expect(result.toDelete).toEqual([e.id])
    expect(result.toCreate).toHaveLength(1)
    expect(result.toCreate[0].role).toBe('chord-stud')
  })

  it('span change (different end) forces delete + create', () => {
    const e = member({ end: { x: 0, y: 2700, z: 0 } })
    const d = member({ end: { x: 0, y: 2400, z: 0 } })
    const result = diffMembers([e], [d])
    expect(result.toDelete).toEqual([e.id])
    expect(result.toCreate).toHaveLength(1)
  })
})
