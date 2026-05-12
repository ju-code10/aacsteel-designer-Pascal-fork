// §6.5 importer step 4 — per-node validation dispatch. Given a node's
// `type` discriminator string, return the Zod schema that should parse
// it. Returns null for unknown / non-CFS types; the importer accepts
// such nodes opaquely (Pascal-side schemas live in upstream packages
// we don't import, per §0.3).

import type { z } from 'zod'
import { CFSMember } from '../schema/cfs-member'
import { CFSOpening } from '../schema/cfs-opening'
import { CFSPanel } from '../schema/cfs-panel'
import { CFSProject } from '../schema/cfs-project'
import { CFSServiceHole } from '../schema/cfs-service-hole'
import { CFSWallFraming } from '../schema/cfs-wall-framing'
import { CFSConnection } from '../schema/cfs-connection'

// Map<type-discriminator, schema>
const SCHEMA_BY_TYPE: Record<string, z.ZodTypeAny> = {
  cfs_project: CFSProject,
  cfs_wall_framing: CFSWallFraming,
  cfs_member: CFSMember,
  cfs_opening: CFSOpening,
  cfs_panel: CFSPanel,
  cfs_service_hole: CFSServiceHole,
  cfs_connection: CFSConnection,
}

export function schemaFor(type: unknown): z.ZodTypeAny | null {
  return typeof type === 'string' ? SCHEMA_BY_TYPE[type] ?? null : null
}

/** All CFS type discriminators known to v1. Used by the JSON exporter
 *  to split a flat scene into `pascalNodes` / `cfsNodes`. */
export function isCFSNodeType(type: unknown): boolean {
  return typeof type === 'string' && type.startsWith('cfs_')
}
