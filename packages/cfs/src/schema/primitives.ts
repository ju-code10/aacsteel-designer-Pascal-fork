import { z } from 'zod'
import { CFSSectionId } from './ids'

export const CFSPoint3D = z
  .object({
    x_mm: z.number().finite(),
    y_mm: z.number().finite(),
    z_mm: z.number().finite(),
  })
  .strict()
export type CFSPoint3D = z.infer<typeof CFSPoint3D>

export const CFSVector3D = CFSPoint3D
export type CFSVector3D = z.infer<typeof CFSVector3D>

export const CFSDimensions2D = z
  .object({
    width_mm: z.number().positive(),
    height_mm: z.number().positive(),
  })
  .strict()
export type CFSDimensions2D = z.infer<typeof CFSDimensions2D>

export const CFSProfileShape = z.enum(['C', 'U', 'Z', 'HAT'])
export type CFSProfileShape = z.infer<typeof CFSProfileShape>

export const CFSSectionProperties = z
  .object({
    shape: CFSProfileShape,
    webDepth_mm: z.number().positive(),
    flangeWidth_mm: z.number().positive(),
    lipLength_mm: z.number().nonnegative(),
    thickness_mm: z.number().positive(),
    cornerRadius_mm: z.number().nonnegative().default(0),
  })
  .strict()
export type CFSSectionProperties = z.infer<typeof CFSSectionProperties>

// §1.5 / §5.4 — model of the SSMA mill pre-punch pattern that ships on
// stock structural studs. The detailer's service-hole spacing rule (R3)
// must respect both sibling detailer holes AND these factory holes.
// Tracks have no pre-punches; their CFSSection omits this field entirely.
export const CFSPrePunchPattern = z
  .object({
    firstPosition_mm: z.number().nonnegative(),
    spacing_mm: z.number().positive(),
    length_mm: z.number().positive(),
    width_mm: z.number().positive(),
  })
  .strict()
export type CFSPrePunchPattern = z.infer<typeof CFSPrePunchPattern>

export const CFSMaterial = z
  .object({
    designation: z.string().min(1),
    yieldStrength_MPa: z.number().positive(),
    tensileStrength_MPa: z.number().positive(),
    modulusOfElasticity_MPa: z.number().positive().default(203_000),
    density_kgPerM3: z.number().positive().default(7850),
    coating: z.string().min(1),
  })
  .strict()
export type CFSMaterial = z.infer<typeof CFSMaterial>

export const CFSMemberRole = z.enum([
  'top-track',
  'bottom-track',
  'stud',
  'chord-stud',
  'king-stud',
  'jamb-stud',
  'header',
  'sill',
  'sill-track',
  'cripple',
])
export type CFSMemberRole = z.infer<typeof CFSMemberRole>

export const CFSOpeningType = z.enum(['door', 'window'])
export type CFSOpeningType = z.infer<typeof CFSOpeningType>

export const CFSHeaderType = z.enum([
  'box',
  'L-header',
  'back-to-back',
  'single-track',
  'proprietary',
])
export type CFSHeaderType = z.infer<typeof CFSHeaderType>

export const CFSComplianceStatus = z.enum(['compliant', 'non-compliant', 'unchecked'])
export type CFSComplianceStatus = z.infer<typeof CFSComplianceStatus>

export const CFSComplianceVerdict = z
  .object({
    status: CFSComplianceStatus,
    reasons: z.array(z.string()).default([]),
    checkedAt: z.iso.datetime().optional(),
  })
  .strict()
export type CFSComplianceVerdict = z.infer<typeof CFSComplianceVerdict>

export const CFSProjectSettings = z
  .object({
    defaultStudSpacing_mm: z.number().positive().default(406.4),
    defaultStudSection: CFSSectionId,
    defaultTrackSection: CFSSectionId,
    defaultHeaderType: CFSHeaderType.default('box'),
    panelMaxWidth_mm: z.number().positive().default(3658),
    panelMaxWeight_kg: z.number().positive().default(680),
    wallHeight_mm: z.number().positive().default(2743),
    units: z.enum(['metric', 'imperial']).default('imperial'),
  })
  .strict()
export type CFSProjectSettings = z.infer<typeof CFSProjectSettings>
