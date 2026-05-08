import { z } from 'zod'
import { CFSMemberId, CFSServiceHoleId } from './ids'
import { CFSComplianceVerdict } from './primitives'

export const CFSServiceHole = z
  .object({
    type: z.literal('cfs_service_hole'),
    id: CFSServiceHoleId,
    parentId: CFSMemberId,

    positionAlongMember_mm: z.number().nonnegative(),
    diameter_mm: z.number().positive(),
    shape: z.enum(['round', 'oblong']).default('round'),
    oblongLength_mm: z.number().positive().optional(),

    hasStiffener: z.boolean().default(false),

    compliance: CFSComplianceVerdict.default({
      status: 'unchecked',
      reasons: [],
    }),
  })
  .strict()
export type CFSServiceHole = z.infer<typeof CFSServiceHole>
