import { z } from 'zod'
import { CFSPanelId, CFSWallFramingId } from './ids'

export const CFSPanel = z
  .object({
    type: z.literal('cfs_panel'),
    id: CFSPanelId,
    parentId: CFSWallFramingId,

    label: z.string().min(1),
    sequenceNumber: z.number().int().positive(),

    startAlongWall_mm: z.number().nonnegative(),
    endAlongWall_mm: z.number().positive(),

    cachedWeight_kg: z.number().nonnegative().optional(),
    cachedMemberCount: z.number().int().nonnegative().optional(),

    isManualBreak: z.boolean().default(false),
  })
  .strict()
export type CFSPanel = z.infer<typeof CFSPanel>
