import { z } from 'zod'
import {
  CFSMemberId,
  CFSPanelId,
  CFSSectionId,
  CFSServiceHoleId,
  CFSWallFramingId,
} from './ids'
import { CFSMemberRole, CFSPoint3D } from './primitives'

export const CFSMember = z
  .object({
    type: z.literal('cfs_member'),
    id: CFSMemberId,
    parentId: CFSWallFramingId,

    role: CFSMemberRole,
    sectionId: CFSSectionId,

    start: CFSPoint3D,
    end: CFSPoint3D,
    orientation_deg: z.number().min(-180).max(180).default(0),

    panelId: CFSPanelId.nullable().default(null),
    shippingMark: z.string().min(1).optional(),

    serviceHoleIds: z.array(CFSServiceHoleId).default([]),
  })
  .strict()
export type CFSMember = z.infer<typeof CFSMember>

export function cfsMemberLength_mm(m: Pick<CFSMember, 'start' | 'end'>): number {
  const dx = m.end.x_mm - m.start.x_mm
  const dy = m.end.y_mm - m.start.y_mm
  const dz = m.end.z_mm - m.start.z_mm
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}
