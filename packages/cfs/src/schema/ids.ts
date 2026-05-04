import { z } from 'zod'

const cfsBrandedId = <B extends string>(brand: B) => z.uuid().brand<B>()

export const CFSProjectId = cfsBrandedId('CFSProjectId')
export const CFSWallFramingId = cfsBrandedId('CFSWallFramingId')
export const CFSMemberId = cfsBrandedId('CFSMemberId')
export const CFSOpeningId = cfsBrandedId('CFSOpeningId')
export const CFSPanelId = cfsBrandedId('CFSPanelId')
export const CFSServiceHoleId = cfsBrandedId('CFSServiceHoleId')
export const CFSConnectionId = cfsBrandedId('CFSConnectionId')
export const CFSSectionId = cfsBrandedId('CFSSectionId')
export const CFSMemberLibraryId = cfsBrandedId('CFSMemberLibraryId')

// Pascal scene-node ids are not UUIDs; Pascal uses prefixed nanoid strings
// (e.g. `site_abc123def456abcd`). We brand here for type safety only.
export const PascalNodeId = z.string().min(1).brand<'PascalNodeId'>()

export type CFSProjectId = z.infer<typeof CFSProjectId>
export type CFSWallFramingId = z.infer<typeof CFSWallFramingId>
export type CFSMemberId = z.infer<typeof CFSMemberId>
export type CFSOpeningId = z.infer<typeof CFSOpeningId>
export type CFSPanelId = z.infer<typeof CFSPanelId>
export type CFSServiceHoleId = z.infer<typeof CFSServiceHoleId>
export type CFSConnectionId = z.infer<typeof CFSConnectionId>
export type CFSSectionId = z.infer<typeof CFSSectionId>
export type CFSMemberLibraryId = z.infer<typeof CFSMemberLibraryId>
export type PascalNodeId = z.infer<typeof PascalNodeId>
