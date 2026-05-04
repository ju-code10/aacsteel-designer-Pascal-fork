import { z } from 'zod'
import { CFSMemberLibraryId, CFSProjectId, PascalNodeId } from './ids'
import { CFSProjectSettings } from './primitives'

export const CFSProject = z
  .object({
    type: z.literal('cfs_project'),
    id: CFSProjectId,
    parentId: PascalNodeId,
    schemaVersion: z.literal('1.0.0'),

    name: z.string().min(1).default('Untitled CFS project'),
    settings: CFSProjectSettings,

    libraries: z.array(CFSMemberLibraryId).min(1),
    activeLibraryId: CFSMemberLibraryId,

    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),

    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
export type CFSProject = z.infer<typeof CFSProject>
