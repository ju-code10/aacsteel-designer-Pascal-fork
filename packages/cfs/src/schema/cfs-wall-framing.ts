import { z } from 'zod'
import { CFSSectionId, CFSWallFramingId, PascalNodeId } from './ids'
import { CFSHeaderType } from './primitives'

export const CFSWallFraming = z
  .object({
    type: z.literal('cfs_wall_framing'),
    id: CFSWallFramingId,
    parentId: PascalNodeId,

    studSpacing_mm: z.number().positive().nullable().default(null),
    studSectionId: CFSSectionId.nullable().default(null),
    trackSectionId: CFSSectionId.nullable().default(null),
    defaultHeaderType: CFSHeaderType.nullable().default(null),
    wallHeight_mm: z.number().positive().nullable().default(null),

    cachedTotalWeight_kg: z.number().nonnegative().optional(),
    cachedMemberCount: z.number().int().nonnegative().optional(),
  })
  .strict()
export type CFSWallFraming = z.infer<typeof CFSWallFraming>
