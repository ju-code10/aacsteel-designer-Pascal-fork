import { z } from 'zod'
import { CFSConnectionId, CFSMemberId, CFSWallFramingId } from './ids'
import { CFSPoint3D } from './primitives'

export const CFSConnectionType = z.enum(['screw', 'weld', 'clip', 'bolt'])
export type CFSConnectionType = z.infer<typeof CFSConnectionType>

export const CFSConnection = z
  .object({
    type: z.literal('cfs_connection'),
    id: CFSConnectionId,
    parentId: CFSWallFramingId,

    connectionType: CFSConnectionType,
    memberIds: z.array(CFSMemberId).min(2),

    fastenerDesignation: z.string().min(1).optional(),
    fastenerCount: z.number().int().positive().optional(),
    fastenerSpacing_mm: z.number().positive().optional(),

    location: CFSPoint3D,
    notes: z.string().optional(),
  })
  .strict()
export type CFSConnection = z.infer<typeof CFSConnection>
