import type { CFSMember } from '../schema/cfs-member'
import type { CFSMemberRole, CFSPoint3D } from '../schema/primitives'

/** Position-tolerance for matching members across passes. §5.1 step 8. */
const POS_TOLERANCE_MM = 1

export interface MemberDiff {
  toCreate: CFSMember[]
  toUpdate: { id: CFSMember['id']; changes: Partial<CFSMember> }[]
  toDelete: CFSMember['id'][]
}

interface MemberKey {
  role: CFSMemberRole
  startX: number
  startY: number
  startZ: number
  endX: number
  endY: number
  endZ: number
}

function keyOf(m: Pick<CFSMember, 'role' | 'start' | 'end'>): MemberKey {
  const round = (v: number) => Math.round(v / POS_TOLERANCE_MM)
  return {
    role: m.role,
    startX: round(m.start.x_mm),
    startY: round(m.start.y_mm),
    startZ: round(m.start.z_mm),
    endX: round(m.end.x_mm),
    endY: round(m.end.y_mm),
    endZ: round(m.end.z_mm),
  }
}

function keyHash(k: MemberKey): string {
  return `${k.role}|${k.startX},${k.startY},${k.startZ}|${k.endX},${k.endY},${k.endZ}`
}

function pointsEqual(a: CFSPoint3D, b: CFSPoint3D): boolean {
  return (
    Math.abs(a.x_mm - b.x_mm) <= POS_TOLERANCE_MM &&
    Math.abs(a.y_mm - b.y_mm) <= POS_TOLERANCE_MM &&
    Math.abs(a.z_mm - b.z_mm) <= POS_TOLERANCE_MM
  )
}

/**
 * Diff existing members against the desired layout. Matches by
 * (role, start, end) within 1 mm tolerance. Updates only carry the fields
 * that changed; matched members with no field differences are no-ops and
 * are excluded from the diff entirely.
 */
export function diffMembers(existing: CFSMember[], desired: CFSMember[]): MemberDiff {
  const existingByKey = new Map<string, CFSMember>()
  for (const m of existing) existingByKey.set(keyHash(keyOf(m)), m)

  const toCreate: CFSMember[] = []
  const toUpdate: MemberDiff['toUpdate'] = []
  const matchedExistingIds = new Set<CFSMember['id']>()

  for (const want of desired) {
    const hash = keyHash(keyOf(want))
    const have = existingByKey.get(hash)
    if (!have) {
      toCreate.push(want)
      continue
    }
    matchedExistingIds.add(have.id)

    const changes: Partial<CFSMember> = {}
    if (have.sectionId !== want.sectionId) changes.sectionId = want.sectionId
    if (!pointsEqual(have.start, want.start)) changes.start = want.start
    if (!pointsEqual(have.end, want.end)) changes.end = want.end
    if (have.orientation_deg !== want.orientation_deg) {
      changes.orientation_deg = want.orientation_deg
    }
    if (Object.keys(changes).length > 0) {
      toUpdate.push({ id: have.id, changes })
    }
  }

  const toDelete: CFSMember['id'][] = []
  for (const m of existing) {
    if (!matchedExistingIds.has(m.id)) toDelete.push(m.id)
  }

  return { toCreate, toUpdate, toDelete }
}
