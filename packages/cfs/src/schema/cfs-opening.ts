import { z } from 'zod'
import { CFSMemberId, CFSOpeningId, CFSWallFramingId } from './ids'
import { CFSDimensions2D, CFSHeaderType, CFSOpeningType } from './primitives'

export const CFSOpening = z
  .object({
    type: z.literal('cfs_opening'),
    id: CFSOpeningId,
    parentId: CFSWallFramingId,

    openingType: CFSOpeningType,
    positionAlongWall_mm: z.number().nonnegative(),
    roughDimensions: CFSDimensions2D,
    sillHeight_mm: z.number().nonnegative().optional(),

    headerTypeOverride: CFSHeaderType.nullable().default(null),

    generatedMemberIds: z.array(CFSMemberId).default([]),
  })
  .strict()
export type CFSOpening = z.infer<typeof CFSOpening>
