// §6.1 — built-up header → BOM components mapping table.
//
// Each `CFSMember` whose role is `header` and whose effective header type
// is `t` expands into `HEADER_COMPONENTS[t].length` BOM rows, one per
// piece, all sharing the header member's length unless `lengthFactor` !=
// 1. The mapping is BOM-only — the cut list, DXF, and PDF show one
// physical entry per header member.

import type { CFSHeaderType, CFSMemberRole } from '../schema/primitives'
import type { CFSSectionId } from '../schema/ids'

export type HeaderComponentRole = 'header-c' | 'header-track'

export type HeaderSectionRef =
  | { kind: 'studSection' }
  | { kind: 'trackSection' }
  | { kind: 'fixed'; sectionId: CFSSectionId }

export interface HeaderComponentSpec {
  /** BOM-only sub-role; used for the human-readable Role column. */
  role: HeaderComponentRole
  /** How to resolve the section for this piece. */
  sectionRef: HeaderSectionRef
  /** Multiplier on the parent header member's length. */
  lengthFactor: number
  /** Number of these pieces per header member. */
  quantityPerHeader: number
}

export const HEADER_COMPONENTS: Record<CFSHeaderType, HeaderComponentSpec[]> = {
  box: [
    { role: 'header-c', sectionRef: { kind: 'studSection' }, lengthFactor: 1.0, quantityPerHeader: 2 },
    { role: 'header-track', sectionRef: { kind: 'trackSection' }, lengthFactor: 1.0, quantityPerHeader: 2 },
  ],
  'back-to-back': [
    { role: 'header-c', sectionRef: { kind: 'studSection' }, lengthFactor: 1.0, quantityPerHeader: 2 },
  ],
  'L-header': [
    { role: 'header-c', sectionRef: { kind: 'studSection' }, lengthFactor: 1.0, quantityPerHeader: 1 },
    { role: 'header-track', sectionRef: { kind: 'trackSection' }, lengthFactor: 1.0, quantityPerHeader: 1 },
  ],
  'single-track': [
    { role: 'header-track', sectionRef: { kind: 'trackSection' }, lengthFactor: 1.0, quantityPerHeader: 1 },
  ],
  proprietary: [
    { role: 'header-c', sectionRef: { kind: 'studSection' }, lengthFactor: 1.0, quantityPerHeader: 1 },
  ],
}

/** Total BOM row count for one header member of type `t`. */
export function headerRowCount(t: CFSHeaderType): number {
  let n = 0
  for (const c of HEADER_COMPONENTS[t]) n += c.quantityPerHeader
  return n
}

/** Returns true if the role is a header in any form (parent or sub-piece). */
export function isHeaderRoleOrSubRole(role: CFSMemberRole | HeaderComponentRole): boolean {
  return role === 'header' || role === 'header-c' || role === 'header-track'
}

/** Human-readable label for the BOM Role column. */
export function roleDisplayLabel(role: CFSMemberRole | HeaderComponentRole): string {
  const map: Record<string, string> = {
    'top-track': 'Top track',
    'bottom-track': 'Bottom track',
    stud: 'Field stud',
    'chord-stud': 'Chord stud',
    'king-stud': 'King stud',
    'jamb-stud': 'Jamb stud',
    header: 'Header',
    'header-c': 'Header (C piece)',
    'header-track': 'Header (track piece)',
    sill: 'Sill',
    'sill-track': 'Sill track',
    cripple: 'Cripple',
  }
  return map[role] ?? role
}
