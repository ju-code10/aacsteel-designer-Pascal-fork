// §6.5 — AACSteelSceneFile schema. Top-level shape for the JSON
// round-trip exporter / importer.
//
// We deliberately keep the per-node validation OUT of this schema.
// Each pascalNodes / cfsNodes value is `z.unknown()` at the top level;
// the importer (§6.5 step 4) parses each entry against the right
// per-type Zod schema and collects errors per node. This lets us survive
// upstream Pascal schema changes without breaking the whole import on
// the first changed field.

import { z } from 'zod'

export const AACSteelSceneFileGenerator = z
  .object({
    tool: z.literal('AACSteel-Designer'),
    version: z.string().min(1),
    exportedAt: z.iso.datetime(),
  })
  .strict()
export type AACSteelSceneFileGenerator = z.infer<typeof AACSteelSceneFileGenerator>

export const AACSteelSceneFile = z
  .object({
    schemaVersion: z.string().min(1),
    generator: AACSteelSceneFileGenerator,
    pascalNodes: z.record(z.string(), z.unknown()),
    cfsNodes: z.record(z.string(), z.unknown()),
  })
  .strict()
export type AACSteelSceneFile = z.infer<typeof AACSteelSceneFile>

/** The schemaVersion v1 emits and the only version v1 imports without migration. */
export const CURRENT_SCENE_FILE_VERSION = '1.0.0' as const
