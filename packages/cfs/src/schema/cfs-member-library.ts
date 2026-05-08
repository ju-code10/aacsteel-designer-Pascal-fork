import { z } from 'zod'
import { CFSMemberLibraryId, CFSSectionId } from './ids'
import { CFSMaterial, CFSProfileShape, CFSSectionProperties } from './primitives'

export const CFSStructuralProperties = z
  .object({
    area_mm2: z.number().positive().optional(),
    Ix_mm4: z.number().positive().optional(),
    Iy_mm4: z.number().positive().optional(),
    Sx_mm3: z.number().positive().optional(),
    Sy_mm3: z.number().positive().optional(),
    rx_mm: z.number().positive().optional(),
    ry_mm: z.number().positive().optional(),
    J_mm4: z.number().positive().optional(),
    Cw_mm6: z.number().positive().optional(),
  })
  .strict()
export type CFSStructuralProperties = z.infer<typeof CFSStructuralProperties>

export const CFSSection = z
  .object({
    id: CFSSectionId,
    designation: z.string().min(1),
    shape: CFSProfileShape,
    properties: CFSSectionProperties,
    material: CFSMaterial,
    linearMass_kgPerM: z.number().positive(),
    structuralProperties: CFSStructuralProperties.optional(),
  })
  .strict()
export type CFSSection = z.infer<typeof CFSSection>

export const CFSMemberLibrary = z
  .object({
    id: CFSMemberLibraryId,
    name: z.string().min(1),
    version: z.string().min(1),
    source: z.url().optional(),
    sections: z.array(CFSSection).min(1),
  })
  .strict()
export type CFSMemberLibrary = z.infer<typeof CFSMemberLibrary>
