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
// at the call site, not here.

import type { CFSMember } from '../schema/cfs-member'
import type { CFSSection } from '../schema/cfs-member-library'
import type { CFSPanel } from '../schema/cfs-panel'
import type { CFSServiceHole } from '../schema/cfs-service-hole'

export interface PanelTransform {
  /** Translate world (along-wall, vertical) → panel-local (x, y) in mm. */
  toLocal_mm: (x_along_wall_mm: number, y_mm: number) => { x: number; y: number }
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
      x: x_along_wall_mm - startX,
      y: y_mm,
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
  x: number
  y: number
  width: number
  height: number
  isVertical: boolean
}

// Internal helper — member endpoint envelope in along-wall coordinates.
function memberAlongWall(m: CFSMember): {
  x0: number
  x1: number
  y0: number
  y1: number
} {
  return {
    x0: Math.min(m.start.x_mm, m.end.x_mm),
    x1: Math.max(m.start.x_mm, m.end.x_mm),
    y0: Math.min(m.start.y_mm, m.end.y_mm),
    y1: Math.max(m.start.y_mm, m.end.y_mm),
  }
}

export function memberBoundingBox_mm(
  member: CFSMember,
  section: CFSSection,
  t: PanelTransform,
): MemberBoundingBox_mm {
  const { x0, x1, y0, y1 } = memberAlongWall(member)
  const length_along = x1 - x0
  const length_vertical = y1 - y0
  const isVertical = length_vertical > length_along

  // The "thickness" is the dimension of the cross-section projected onto
  // the wall elevation, perpendicular to the member axis:
  //   vertical member → flange width
  //   horizontal member → web depth
  const thick = isVertical
    ? section.properties.flangeWidth_mm
    : section.properties.webDepth_mm
  const halfThick = thick / 2

  if (isVertical) {
    const cx = (x0 + x1) / 2
    const minLocal = t.toLocal_mm(cx - halfThick, y0)
    return {
      x: minLocal.x,
      y: minLocal.y,
      width: thick,
      height: length_vertical,
      isVertical: true,
    }
  }
  const cy = (y0 + y1) / 2
  const minLocal = t.toLocal_mm(x0, cy - halfThick)
  return {
    x: minLocal.x,
    y: minLocal.y,
    width: length_along,
    height: thick,
    isVertical: false,
  }
}

/** Member centre in panel-local mm. Used for label placement. */
export function memberCenter_mm(
  member: CFSMember,
  t: PanelTransform,
): { x: number; y: number } {
  const { x0, x1, y0, y1 } = memberAlongWall(member)
  return t.toLocal_mm((x0 + x1) / 2, (y0 + y1) / 2)
}

export interface ServiceHoleProjection_mm {
  x: number
  y: number
  radius: number
}

export function serviceHoleProjection_mm(
  hole: CFSServiceHole,
  member: CFSMember,
  t: PanelTransform,
): ServiceHoleProjection_mm {
  const { x0, x1, y0, y1 } = memberAlongWall(member)
  const isVertical = y1 - y0 > x1 - x0
  const pos = hole.positionAlongMember_mm
  const center = isVertical
    ? t.toLocal_mm((x0 + x1) / 2, y0 + pos)
    : t.toLocal_mm(x0 + pos, (y0 + y1) / 2)
  return { x: center.x, y: center.y, radius: hole.diameter_mm / 2 }
}

// Scale a source content box (in panel-local mm) to fit inside a
// destination region (in PDF points or whatever unit the caller chose).
// Returns the scale factor and the centred offsets. Margin is applied
// uniformly inside the destination region.
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
