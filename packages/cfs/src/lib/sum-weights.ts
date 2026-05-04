import type { CFSMember } from '../schema/cfs-member'
import type { CFSMemberLibrary } from '../schema/cfs-member-library'
import { cfsMemberLength_mm } from '../schema/cfs-member'

const MM_PER_M = 1000

export function sumWeights(members: CFSMember[], library: CFSMemberLibrary): number {
  const massBySection = new Map<string, number>()
  for (const s of library.sections) massBySection.set(s.id, s.linearMass_kgPerM)

  let total_kg = 0
  for (const m of members) {
    const linear = massBySection.get(m.sectionId)
    if (linear === undefined) continue
    total_kg += (cfsMemberLength_mm(m) / MM_PER_M) * linear
  }
  return total_kg
}
