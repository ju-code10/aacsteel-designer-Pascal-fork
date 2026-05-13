// Shared panel-local projection math for the DXF (§6.3) and PDF (§6.4)
// shop-drawing exporters.
//
// Both exporters draw members onto the same 2D panel elevation. §6.4
// commits to "same layout, same dimensions, same labels" between DXF
// and PDF. Centralising the math here is what keeps them in lockstep.
//
// All outputs are in **panel-local millimetres**: origin at the panel's
// bottom-left corner, +x to the right along the wall, +y up. Per-exporter
// unit conversion (DXF: mm or 4-dp inches; PDF: pdf-lib points) happens
// at the call site, not here. All numeric fields carry the `_mm` suffix
// per PROJECT_SPEC §0.5.

import type { CFSMember } from '../schema/cfs-member'
import type { CFSSection } from '../schema/cfs-member-library'
import type { CFSPanel } from '../schema/cfs-panel'
import type { CFSServiceHole } from '../schema/cfs-service-hole'

export interface PointMM {
  x_mm: number
  y_mm: number
}

export interface PanelTransform {
  /** Translate world (along-wall, vertical) → panel-local (x, y) in mm. */
  toLocal_mm: (x_along_wall_mm: number, y_mm: number) => PointMM
  panelWidth_mm: number
  panelHeight_mm: number
}

// Canonical wall height (§1.2 worked example). The scene does not yet
// carry per-wall height; v2 plumbs it through. Both exporters share this
// constant so DXF and PDF stay consistent.
export const DEFAULT_PANEL_HEIGHT_MM = 2700

export function makePanelTransform(panel: CFSPanel): PanelTransform {
  const startX = panel.startAlongWall_mm
  return {
    toLocal_mm: (x_along_wall_mm, y_mm) => ({
      x_mm: x_along_wall_mm - startX,
      y_mm,
    }),
    panelWidth_mm: panel.endAlongWall_mm - panel.startAlongWall_mm,
    panelHeight_mm: DEFAULT_PANEL_HEIGHT_MM,
  }
}

// Member bounding box in panel-local millimetres. Members on a wall
// elevation are always axis-aligned (vertical studs/jambs/cripples or
// horizontal tracks/headers/sills), so a bounding rectangle is a
// loss-less representation.
export interface MemberBoundingBox_mm {
  x_mm: number
  y_mm: number
  width_mm: number
  height_mm: number
  isVertical: boolean
}

// Internal helper — member endpoint envelope in along-wall coordinates.
function memberAlongWall(m: CFSMember): {
  x0_mm: number
  x1_mm: number
  y0_mm: number
  y1_mm: number
} {
  return {
    x0_mm: Math.min(m.start.x_mm, m.end.x_mm),
    x1_mm: Math.max(m.start.x_mm, m.end.x_mm),
    y0_mm: Math.min(m.start.y_mm, m.end.y_mm),
    y1_mm: Math.max(m.start.y_mm, m.end.y_mm),
  }
}

export function memberBoundingBox_mm(
  member: CFSMember,
  section: CFSSection,
  t: PanelTransform,
): MemberBoundingBox_mm {
  const { x0_mm, x1_mm, y0_mm, y1_mm } = memberAlongWall(member)
  const length_along_mm = x1_mm - x0_mm
  const length_vertical_mm = y1_mm - y0_mm
  const isVertical = length_vertical_mm > length_along_mm

  // The "thickness" is the dimension of the cross-section projected onto
  // the wall elevation, perpendicular to the member axis:
  //   vertical member → flange width
  //   horizontal member → web depth
  const thick_mm = isVertical
    ? section.properties.flangeWidth_mm
    : section.properties.webDepth_mm
  const halfThick_mm = thick_mm / 2

  if (isVertical) {
    const cx_mm = (x0_mm + x1_mm) / 2
    const minLocal = t.toLocal_mm(cx_mm - halfThick_mm, y0_mm)
    return {
      x_mm: minLocal.x_mm,
      y_mm: minLocal.y_mm,
      width_mm: thick_mm,
      height_mm: length_vertical_mm,
      isVertical: true,
    }
  }
  const cy_mm = (y0_mm + y1_mm) / 2
  const minLocal = t.toLocal_mm(x0_mm, cy_mm - halfThick_mm)
  return {
    x_mm: minLocal.x_mm,
    y_mm: minLocal.y_mm,
    width_mm: length_along_mm,
    height_mm: thick_mm,
    isVertical: false,
  }
}

/** Member centre in panel-local mm. Used for label placement. */
export function memberCenter_mm(
  member: CFSMember,
  t: PanelTransform,
): PointMM {
  const { x0_mm, x1_mm, y0_mm, y1_mm } = memberAlongWall(member)
  return t.toLocal_mm((x0_mm + x1_mm) / 2, (y0_mm + y1_mm) / 2)
}

export interface ServiceHoleProjection_mm {
  x_mm: number
  y_mm: number
  radius_mm: number
}

export function serviceHoleProjection_mm(
  hole: CFSServiceHole,
  member: CFSMember,
  t: PanelTransform,
): ServiceHoleProjection_mm {
  const { x0_mm, x1_mm, y0_mm, y1_mm } = memberAlongWall(member)
  const isVertical = y1_mm - y0_mm > x1_mm - x0_mm
  const pos_mm = hole.positionAlongMember_mm
  const center = isVertical
    ? t.toLocal_mm((x0_mm + x1_mm) / 2, y0_mm + pos_mm)
    : t.toLocal_mm(x0_mm + pos_mm, (y0_mm + y1_mm) / 2)
  return { x_mm: center.x_mm, y_mm: center.y_mm, radius_mm: hole.diameter_mm / 2 }
}

// Scale a source content box (in panel-local mm) to fit inside a
// destination region (in PDF points or whatever unit the caller chose).
// Returns the scale factor and the centred offsets. Margin is applied
// uniformly inside the destination region.
//
// Note: this helper is unit-agnostic. The destination units depend on the
// caller (PDF points for shop drawings, mm for DXF). Fields below carry
// no unit suffix because the unit is fixed by the caller, not this code.
export interface ScaleToFitResult {
  scale: number
  offsetX: number
  offsetY: number
  usedWidth: number
  usedHeight: number
  /**
   * True when the source's aspect ratio is more extreme than the
   * destination's so much that scaling shrinks both axes — useful for the
   * PDF rotate-90° edge case (§6.4 "panel elevation aspect ratio extreme").
   */
  rotated: boolean
}

export function scaleToFit(
  src: { width: number; height: number },
  dst: { width: number; height: number; margin?: number },
): ScaleToFitResult {
  const margin = dst.margin ?? 0
  const availW = Math.max(0, dst.width - 2 * margin)
  const availH = Math.max(0, dst.height - 2 * margin)

  // Try both unrotated and rotated 90°; pick whichever fits with the
  // larger scale (i.e., uses more of the available area).
  const scaleUpright = Math.min(availW / src.width, availH / src.height)
  const scaleRotated = Math.min(availW / src.height, availH / src.width)

  const rotated = scaleRotated > scaleUpright
  const scale = rotated ? scaleRotated : scaleUpright
  const usedW = (rotated ? src.height : src.width) * scale
  const usedH = (rotated ? src.width : src.height) * scale
  const offsetX = margin + (availW - usedW) / 2
  const offsetY = margin + (availH - usedH) / 2

  return {
    scale,
    offsetX,
    offsetY,
    usedWidth: usedW,
    usedHeight: usedH,
    rotated,
  }
}
