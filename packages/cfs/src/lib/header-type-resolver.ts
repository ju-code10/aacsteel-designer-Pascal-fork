// §5.1 step 6 / §6.1 — effective header-type resolution.
//
// `opening.headerTypeOverride ?? framing.defaultHeaderType ?? settings.defaultHeaderType`
// Used by the BOM exporter's built-up expansion (§6.1) and the DXF/PDF
// exporters' header-type call-outs.

import type { CFSMember } from '../schema/cfs-member'
import type { CFSOpening } from '../schema/cfs-opening'
import type { CFSWallFraming } from '../schema/cfs-wall-framing'
import type { CFSHeaderType, CFSProjectSettings } from '../schema/primitives'
import type { SceneLike } from './scene-walk'

interface NodeBase {
  type?: string
  id: string
  parentId?: string | null
}

/** Find the opening this header member generates from, if any. */
export function findParentOpening(
  scene: SceneLike,
  member: CFSMember,
): CFSOpening | null {
  for (const node of Object.values(scene.nodes)) {
    if ((node as NodeBase).type !== 'cfs_opening') continue
    const op = node as CFSOpening
    if (op.generatedMemberIds.includes(member.id)) return op
  }
  return null
}

export function resolveHeaderType(
  scene: SceneLike,
  member: CFSMember,
  settings: CFSProjectSettings,
): CFSHeaderType {
  const opening = findParentOpening(scene, member)
  if (opening?.headerTypeOverride) return opening.headerTypeOverride
  const framing = scene.nodes[member.parentId] as CFSWallFraming | undefined
  if (framing?.defaultHeaderType) return framing.defaultHeaderType
  return settings.defaultHeaderType
}
