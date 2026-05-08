import type { CFSSection } from '../schema/cfs-member-library'
import type { CFSHeaderType, CFSMemberRole } from '../schema/primitives'
import type { CFSSectionId } from '../schema/ids'

export interface HeaderMemberSpec {
  role: CFSMemberRole
  sectionId: CFSSectionId
  /** x along the wall, mm. Both members of a header share the same start/end x. */
  startX_mm: number
  endX_mm: number
  /** y in wall-local coordinates, mm. The bottom face of this header member sits at this height. */
  baselineY_mm: number
  /** Vertical offset of this member's representative line from the baseline (positive = up). */
  offsetY_mm: number
}

export interface HeaderGeometryInput {
  type: CFSHeaderType
  studSection: CFSSection
  trackSection: CFSSection
  /** Wall-local x of the inner edge of the left jamb (= rough opening left edge). */
  jambLeftX_mm: number
  /** Wall-local x of the inner edge of the right jamb (= rough opening right edge). */
  jambRightX_mm: number
  /** Wall-local y of the rough opening's top (head height). */
  headHeight_mm: number
}

export interface HeaderGeometry {
  members: HeaderMemberSpec[]
  /** Total vertical depth of the header assembly above the head height. */
  depth_mm: number
}

/**
 * Per-type member count and section selection rules. Documented in §1.2 / §1.4.
 * Counts (decided in slice 4 planning):
 *   box           → 4 members (2 C web-horizontal + 2 track caps)
 *   L-header      → 2 members (1 C horizontal + 1 track turned to form the L)
 *   back-to-back  → 2 members (2 C web-to-web)
 *   single-track  → 1 member  (track only — section forced regardless of stud)
 *   proprietary   → 1 member  (placeholder; real proprietary section reference is v2)
 *
 * The depth above the head height drives cripple-above clearance.
 */
export function computeHeaderGeometry(input: HeaderGeometryInput): HeaderGeometry {
  const { type, studSection, trackSection, jambLeftX_mm, jambRightX_mm, headHeight_mm } = input
  const studDepth = studSection.properties.webDepth_mm
  const studThickness = studSection.properties.thickness_mm
  const trackDepth = trackSection.properties.webDepth_mm

  switch (type) {
    case 'box': {
      // Two horizontal C-sections stacked, capped top and bottom by tracks.
      // Total depth = stud depth + 2x stud thickness (top and bottom track flanges).
      const depth = studDepth + 2 * studThickness
      const members: HeaderMemberSpec[] = [
        {
          role: 'header',
          sectionId: studSection.id,
          startX_mm: jambLeftX_mm,
          endX_mm: jambRightX_mm,
          baselineY_mm: headHeight_mm,
          offsetY_mm: studThickness,
        },
        {
          role: 'header',
          sectionId: studSection.id,
          startX_mm: jambLeftX_mm,
          endX_mm: jambRightX_mm,
          baselineY_mm: headHeight_mm,
          offsetY_mm: studThickness + studDepth,
        },
        {
          role: 'header',
          sectionId: trackSection.id,
          startX_mm: jambLeftX_mm,
          endX_mm: jambRightX_mm,
          baselineY_mm: headHeight_mm,
          offsetY_mm: 0,
        },
        {
          role: 'header',
          sectionId: trackSection.id,
          startX_mm: jambLeftX_mm,
          endX_mm: jambRightX_mm,
          baselineY_mm: headHeight_mm,
          offsetY_mm: depth,
        },
      ]
      return { members, depth_mm: depth }
    }
    case 'L-header': {
      const depth = studDepth
      const members: HeaderMemberSpec[] = [
        {
          role: 'header',
          sectionId: studSection.id,
          startX_mm: jambLeftX_mm,
          endX_mm: jambRightX_mm,
          baselineY_mm: headHeight_mm,
          offsetY_mm: 0,
        },
        {
          role: 'header',
          sectionId: trackSection.id,
          startX_mm: jambLeftX_mm,
          endX_mm: jambRightX_mm,
          baselineY_mm: headHeight_mm,
          offsetY_mm: depth,
        },
      ]
      return { members, depth_mm: depth }
    }
    case 'back-to-back': {
      const depth = studDepth
      const members: HeaderMemberSpec[] = [
        {
          role: 'header',
          sectionId: studSection.id,
          startX_mm: jambLeftX_mm,
          endX_mm: jambRightX_mm,
          baselineY_mm: headHeight_mm,
          offsetY_mm: 0,
        },
        {
          role: 'header',
          sectionId: studSection.id,
          startX_mm: jambLeftX_mm,
          endX_mm: jambRightX_mm,
          baselineY_mm: headHeight_mm,
          offsetY_mm: 0,
        },
      ]
      return { members, depth_mm: depth }
    }
    case 'single-track': {
      // Single-track header always uses the track section regardless of stud section.
      const depth = trackDepth
      const members: HeaderMemberSpec[] = [
        {
          role: 'header',
          sectionId: trackSection.id,
          startX_mm: jambLeftX_mm,
          endX_mm: jambRightX_mm,
          baselineY_mm: headHeight_mm,
          offsetY_mm: 0,
        },
      ]
      return { members, depth_mm: depth }
    }
    case 'proprietary': {
      // v1 placeholder: emit a single member at stud-depth for cut-list parity.
      // Real proprietary section reference is deferred (see Slice 4 plan, ambiguity #4).
      const depth = studDepth
      const members: HeaderMemberSpec[] = [
        {
          role: 'header',
          sectionId: studSection.id,
          startX_mm: jambLeftX_mm,
          endX_mm: jambRightX_mm,
          baselineY_mm: headHeight_mm,
          offsetY_mm: 0,
        },
      ]
      return { members, depth_mm: depth }
    }
  }
}
