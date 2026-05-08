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

    // Pascal cascade-delete walks `parent.children` (see
    // `packages/core/src/store/actions/node-actions.ts:365`). Without this
    // field the framing is a dead-end for the cascade, leaving members
    // and openings orphaned when their wall is deleted. Pascal's
    // `createNode(child, parentId)` auto-appends new child ids here as long
    // as the field exists. Default `[]` keeps existing scene JSON
    // backward-compatible — zod parse fills the field in on load.
    children: z.array(z.string()).default([]),
  })
  .strict()
export type CFSWallFraming = z.infer<typeof CFSWallFraming>
