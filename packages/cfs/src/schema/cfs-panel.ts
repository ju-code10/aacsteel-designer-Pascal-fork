import { z } from 'zod'
import { CFSPanelId, CFSWallFramingId } from './ids'

// §3.7 + §7.3.3 — a CFSPanel has two lifecycles. A "real" panel is the
// canonical product of the panelization pass and satisfies all invariants:
//   sequenceNumber ≥ 1, end > start, label "P-NN".
// A "pending sentinel" is a transient marker created by CFSPanelBreakTool
// at the user's clicked position; the panelization pass reads its
// startAlongWall_mm as a forced manual break and replaces it with real
// panels in the same batched-undo step. Sentinels are filtered out by the
// inspector and exporters.
//
// We model the two lifecycles in one schema with a discriminator so:
//   - real panels keep their existing invariants (no behaviour regression)
//   - sentinels are explicit at the data layer; nothing has to grep the
//     label string to detect them
//   - cascade-delete of the parent framing still removes both kinds
//
// `isPendingSentinel` defaults to `false`, so every existing scene JSON
// parses unchanged (HOL-10-style round-trip).
export const CFSPanel = z
  .object({
    type: z.literal('cfs_panel'),
    id: CFSPanelId,
    parentId: CFSWallFramingId,

    label: z.string().min(1),
    sequenceNumber: z.number().int(),

    startAlongWall_mm: z.number().nonnegative(),
    endAlongWall_mm: z.number().nonnegative(),

    cachedWeight_kg: z.number().nonnegative().optional(),
    cachedMemberCount: z.number().int().nonnegative().optional(),

    isManualBreak: z.boolean().default(false),
    isPendingSentinel: z.boolean().default(false),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.isPendingSentinel) {
      // Sentinel: endAlongWall_mm may equal startAlongWall_mm (zero-width
      // marker); sequenceNumber is overwritten by the pass.
      if (p.endAlongWall_mm < p.startAlongWall_mm) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'sentinel endAlongWall_mm must be ≥ startAlongWall_mm',
          path: ['endAlongWall_mm'],
        })
      }
      return
    }
    // Real panel invariants per §3 / §3.7:
    if (p.sequenceNumber < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'real panel sequenceNumber must be ≥ 1',
        path: ['sequenceNumber'],
      })
    }
    if (p.endAlongWall_mm <= p.startAlongWall_mm) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'real panel endAlongWall_mm must be > startAlongWall_mm',
        path: ['endAlongWall_mm'],
      })
    }
  })
export type CFSPanel = z.infer<typeof CFSPanel>

/** Tiny predicate sugar — used by inspector, exporters, geometry tint. */
export function isRealPanel(p: CFSPanel): boolean {
  return !p.isPendingSentinel
}

/** Width of a real panel in mm. Sentinels return 0. */
export function panelWidth_mm(p: Pick<CFSPanel, 'startAlongWall_mm' | 'endAlongWall_mm'>): number {
  return p.endAlongWall_mm - p.startAlongWall_mm
}
