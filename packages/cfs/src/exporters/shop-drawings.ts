// §6.4 — ShopDrawingExporter. Multi-page PDF: cover + per-panel + summary.
//
// Library: pdf-lib ^1.17.1. US Letter portrait (8.5 × 11 in = 612 × 792 pt
// at the pdf-lib 72-pt-per-inch convention). Uses built-in Helvetica
// regular + bold; no font embedding work in v1.
//
// Panel elevation rendering walks `useScene` and projects member endpoints
// via packages/cfs/src/lib/panel-projection, the same math the DXF
// exporter uses, so the two outputs cannot drift. Per-panel BOM mini-table
// is built from the same `expandPanelToBOMRows` helper as the BOM xlsx —
// row count and totals match within each panel.

import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from 'pdf-lib'
import type { CFSMember } from '../schema/cfs-member'
import type { CFSMemberLibrary, CFSSection } from '../schema/cfs-member-library'
import type { CFSPanel } from '../schema/cfs-panel'
import type { CFSProject } from '../schema/cfs-project'
import type { CFSServiceHole } from '../schema/cfs-service-hole'
import type { CFSMemberRole, CFSProjectSettings } from '../schema/primitives'
import {
  kgToLb,
  lengthForUnits,
  round2,
  unitsSuffix,
} from '../lib/length-format'
import { planShippingMarks } from '../lib/shipping-marks'
import {
  membersInPanel,
  sortedPanelsScene,
  type SceneLike,
} from '../lib/scene-walk'
import {
  makePanelTransform,
  memberBoundingBox_mm,
  memberCenter_mm,
  scaleToFit,
  serviceHoleProjection_mm,
} from '../lib/panel-projection'
import { FASTENER_SCHEDULE_DEFAULTS } from '../lib/fastener-defaults'
import type { BOMRow } from './bom'
import { expandPanelToBOMRows } from './bom'
import { preflight } from './preflight'

// ── Page geometry (pdf-lib points, 72 pt = 1 in) ────────────────────────────

const PAGE_W = 612 // 8.5 in
const PAGE_H = 792 // 11 in
const MARGIN = 36 // 0.5 in
const WORK_X0 = MARGIN
const WORK_X1 = PAGE_W - MARGIN
const WORK_Y0 = MARGIN
const WORK_Y1 = PAGE_H - MARGIN
const WORK_W = WORK_X1 - WORK_X0
const WORK_H = WORK_Y1 - WORK_Y0

// Per-panel page band layout (top → bottom): title bar, elevation, BOM
// strip, title block, footer.
const TITLE_BAR_H = 36 // 0.5 in
const ELEVATION_H = 432 // 6 in
const BOM_STRIP_H = 216 // 3 in
const TITLE_BLOCK_H = 36 // 0.5 in

const FASTENER_BLOCK_W = 180 // 2.5 in — wide enough for the longest spec line
const FASTENER_BLOCK_H = 108 // 1.5 in

const ROW_LIMIT_PER_PAGE = 30 // §6.4 PDF-06 — beyond this, sub-paginate

// ── Role → fill colour ──────────────────────────────────────────────────────
// Print-friendly fills. Matches the DXF layer-colour intent without
// trying to be byte-identical (different colour spaces).
const ROLE_FILL: Record<CFSMemberRole, RGB> = {
  'top-track': rgb(0.55, 0.55, 0.6),
  'bottom-track': rgb(0.55, 0.55, 0.6),
  'sill-track': rgb(0.55, 0.55, 0.6),
  stud: rgb(0.42, 0.51, 0.78),
  'chord-stud': rgb(0.16, 0.28, 0.6),
  'king-stud': rgb(0.16, 0.28, 0.6),
  'jamb-stud': rgb(0.22, 0.6, 0.32),
  header: rgb(0.85, 0.36, 0.22),
  sill: rgb(0.85, 0.36, 0.22),
  cripple: rgb(0.85, 0.66, 0.27),
}

const BLACK = rgb(0, 0, 0)
const WHITE = rgb(1, 1, 1)
const GRAY_FOOTER = rgb(0.5, 0.5, 0.5)
const GRAY_BORDER = rgb(0.7, 0.7, 0.7)
const ROW_SHADE = rgb(0.95, 0.95, 0.95)
const UNRESOLVED_RED = rgb(0.85, 0.2, 0.2)

// ── Public entry ────────────────────────────────────────────────────────────

export interface ShopDrawingsResult {
  blob: Blob
  pageCount: number
  /** Returned for tests + checksum work. */
  bytes: Uint8Array
}

export interface ShopDrawingsOptions {
  /**
   * Fixed export timestamp. Required by tests for byte-deterministic
   * output (PDF-10). Defaults to `new Date()` in production.
   */
  exportedAt?: Date
}

export async function exportShopDrawings(
  scene: SceneLike,
  library: CFSMemberLibrary | null,
  project: CFSProject | null,
  options: ShopDrawingsOptions = {},
): Promise<ShopDrawingsResult> {
  const { library: lib, project: proj } = preflight(scene, library, project, {
    requirePanels: true,
  })
  const exportedAt = options.exportedAt ?? new Date()
  const marks = planShippingMarks(scene)
  const panels = sortedPanelsScene(scene)
  const sectionsById = new Map(lib.sections.map((s) => [s.id, s]))

  const pdf = await PDFDocument.create()
  // pdf-lib stamps the trailer with these; we pin them so two consecutive
  // exports of the same scene are byte-identical (PDF-10).
  pdf.setCreationDate(exportedAt)
  pdf.setModificationDate(exportedAt)
  pdf.setTitle(`${proj.name} — Shop drawings`)
  pdf.setCreator('AACSteel-Designer')
  pdf.setProducer('AACSteel-Designer')

  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  }

  // Per-panel BOM rows pre-computed so sub-pagination can be planned.
  const panelRows = new Map<string, BOMRow[]>()
  for (const p of panels) {
    panelRows.set(
      p.id,
      expandPanelToBOMRows(p, scene, lib, sectionsById, marks, proj.settings),
    )
  }

  // Plan page numbering: cover = 1, panels 2..K, summary = last.
  const panelStartPage = new Map<string, number>()
  let next = 2
  for (const p of panels) {
    panelStartPage.set(p.id, next)
    const rows = panelRows.get(p.id) ?? []
    const extra = Math.max(0, Math.ceil(rows.length / ROW_LIMIT_PER_PAGE) - 1)
    next += 1 + extra
  }
  const summaryPage = next
  const totalPages = summaryPage

  const ctx: PageCtx = {
    pdf,
    fonts,
    exportedAt,
    project: proj,
    library: lib,
    totalPages,
  }

  drawCoverPage(ctx, panels, panelStartPage, scene)
  for (const p of panels) {
    const rows = panelRows.get(p.id) ?? []
    drawPanelPages(
      ctx,
      p,
      scene,
      sectionsById,
      marks,
      rows,
      panelStartPage.get(p.id) ?? 0,
    )
  }
  drawSummaryPage(ctx, panels, panelRows, summaryPage)

  const bytes = await pdf.save()
  const blob = new Blob([bytes as unknown as BlobPart], {
    type: 'application/pdf',
  })
  return { blob, pageCount: pdf.getPageCount(), bytes }
}

// ── Internal types ──────────────────────────────────────────────────────────

interface Fonts {
  regular: PDFFont
  bold: PDFFont
}

interface PageCtx {
  pdf: PDFDocument
  fonts: Fonts
  exportedAt: Date
  project: CFSProject
  library: CFSMemberLibrary
  totalPages: number
}

// ── Cover page ──────────────────────────────────────────────────────────────

function drawCoverPage(
  ctx: PageCtx,
  panels: readonly CFSPanel[],
  panelStartPage: ReadonlyMap<string, number>,
  scene: SceneLike,
): void {
  const page = ctx.pdf.addPage([PAGE_W, PAGE_H])

  // Header band (top 1 in).
  drawCenteredText(
    page,
    ctx.fonts.bold,
    'AACSteel-Designer Shop Drawings',
    18,
    WORK_X0 + WORK_W / 2,
    WORK_Y1 - 36,
  )

  // Project + library blocks (4 in tall, half width each).
  const blockTop = WORK_Y1 - 72
  const blockBottom = blockTop - 288
  const halfW = WORK_W / 2

  drawProjectBlock(page, ctx, WORK_X0, blockBottom, halfW, blockTop - blockBottom)
  drawLibraryBlock(
    page,
    ctx,
    WORK_X0 + halfW,
    blockBottom,
    halfW,
    blockTop - blockBottom,
    panels,
    scene,
  )

  // Index table (fills the remainder).
  const indexTop = blockBottom - 12
  const indexBottom = WORK_Y0
  drawIndexTable(page, ctx, panels, panelStartPage, WORK_X0, indexBottom, WORK_W, indexTop - indexBottom)

  drawFooter(page, ctx, 1)
}

function drawProjectBlock(
  page: PDFPage,
  ctx: PageCtx,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const lineH = 14
  let cursorY = y + h - 4
  page.drawText(ctx.project.name, {
    x: x + 4,
    y: cursorY - 14,
    size: 14,
    font: ctx.fonts.bold,
    color: BLACK,
  })
  cursorY -= 22

  const metaLines: string[] = []
  const meta = ctx.project.metadata as Record<string, unknown> | undefined
  const jobNumber = meta && typeof meta['jobNumber'] === 'string' ? meta['jobNumber'] : undefined
  const client = meta && typeof meta['client'] === 'string' ? meta['client'] : undefined
  if (jobNumber) metaLines.push(`Job number: ${jobNumber}`)
  if (client) metaLines.push(`Client: ${client}`)
  metaLines.push(`Date: ${ctx.exportedAt.toISOString().slice(0, 10)}`)
  metaLines.push(`Schema version: ${ctx.project.schemaVersion ?? '1.0.0'}`)

  for (const line of metaLines) {
    page.drawText(line, {
      x: x + 4,
      y: cursorY - 10,
      size: 10,
      font: ctx.fonts.regular,
      color: BLACK,
    })
    cursorY -= lineH
  }

  void w
}

function drawLibraryBlock(
  page: PDFPage,
  ctx: PageCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  panels: readonly CFSPanel[],
  scene: SceneLike,
): void {
  const lineH = 14
  let cursorY = y + h - 4
  page.drawText(
    `${ctx.library.name} ${ctx.library.version ?? ''}`.trim(),
    {
      x: x + 4,
      y: cursorY - 14,
      size: 14,
      font: ctx.fonts.bold,
      color: BLACK,
    },
  )
  cursorY -= 22

  let memberCount = 0
  let totalWeight = 0
  for (const p of panels) {
    memberCount += p.cachedMemberCount ?? membersInPanel(scene, p.id).length
    totalWeight += p.cachedWeight_kg ?? 0
  }
  const isImperial = ctx.project.settings.units === 'imperial'
  const weightLine = isImperial
    ? `Total weight: ${round2(totalWeight)} kg (${round2(kgToLb(totalWeight))} lb)`
    : `Total weight: ${round2(totalWeight)} kg`

  const lines = [
    `Panels: ${panels.length}`,
    `Members: ${memberCount}`,
    weightLine,
  ]
  for (const line of lines) {
    page.drawText(line, {
      x: x + 4,
      y: cursorY - 10,
      size: 10,
      font: ctx.fonts.regular,
      color: BLACK,
    })
    cursorY -= lineH
  }
  void w
}

function drawIndexTable(
  page: PDFPage,
  ctx: PageCtx,
  panels: readonly CFSPanel[],
  panelStartPage: ReadonlyMap<string, number>,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const headerSize = 10
  const rowSize = 9
  const rowH = 14

  page.drawText('Panel', {
    x: x + 4,
    y: y + h - headerSize - 4,
    size: headerSize,
    font: ctx.fonts.bold,
    color: BLACK,
  })
  page.drawText('Page', {
    x: x + w - 60,
    y: y + h - headerSize - 4,
    size: headerSize,
    font: ctx.fonts.bold,
    color: BLACK,
  })
  page.drawLine({
    start: { x, y: y + h - headerSize - 8 },
    end: { x: x + w, y: y + h - headerSize - 8 },
    thickness: 0.75,
    color: BLACK,
  })

  let cursorY = y + h - headerSize - 8 - rowH
  if (panels.length === 0) {
    page.drawText('No CFS panels in this project.', {
      x: x + 4,
      y: cursorY,
      size: rowSize,
      font: ctx.fonts.regular,
      color: GRAY_FOOTER,
    })
    return
  }
  for (const p of panels) {
    page.drawText(p.label, {
      x: x + 4,
      y: cursorY,
      size: rowSize,
      font: ctx.fonts.regular,
      color: BLACK,
    })
    page.drawText(String(panelStartPage.get(p.id) ?? '—'), {
      x: x + w - 60,
      y: cursorY,
      size: rowSize,
      font: ctx.fonts.regular,
      color: BLACK,
    })
    cursorY -= rowH
    if (cursorY < y + 4) break // index overflow handled in v2
  }
}

// ── Per-panel page(s) ───────────────────────────────────────────────────────

function drawPanelPages(
  ctx: PageCtx,
  panel: CFSPanel,
  scene: SceneLike,
  sectionsById: ReadonlyMap<string, CFSSection>,
  marks: ReadonlyMap<string, string>,
  rows: readonly BOMRow[],
  startPage: number,
): void {
  const subPages = Math.max(1, Math.ceil(rows.length / ROW_LIMIT_PER_PAGE))
  for (let i = 0; i < subPages; i++) {
    const page = ctx.pdf.addPage([PAGE_W, PAGE_H])
    const isContinuation = i > 0
    const physicalPage = startPage + i
    const label = subPages > 1 ? `${startPage}${SUB_PAGE_SUFFIX[i] ?? `+${i}`}` : String(startPage)

    drawPanelTitleBar(page, ctx, panel, label)

    if (!isContinuation) {
      drawPanelElevation(page, ctx, panel, scene, sectionsById, marks)
    } else {
      // Continuation pages show the BOM remainder only.
      drawElevationPlaceholder(page, ctx)
    }

    const rowStart = i * ROW_LIMIT_PER_PAGE
    const rowEnd = Math.min(rows.length, rowStart + ROW_LIMIT_PER_PAGE)
    drawBOMStrip(page, ctx, panel, rows.slice(rowStart, rowEnd), isContinuation)
    drawTitleBlock(page, ctx, panel, label)
    drawFooter(page, ctx, physicalPage)
  }
}

// 30-row BOM → 1 page; 35 rows → 3a + 3b; 65 rows → 3a + 3b + 3c.
const SUB_PAGE_SUFFIX = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const

function drawPanelTitleBar(
  page: PDFPage,
  ctx: PageCtx,
  panel: CFSPanel,
  pageLabel: string,
): void {
  const y = WORK_Y1 - TITLE_BAR_H
  page.drawRectangle({
    x: WORK_X0,
    y,
    width: WORK_W,
    height: TITLE_BAR_H,
    borderColor: GRAY_BORDER,
    borderWidth: 0.5,
  })
  page.drawText(`Panel ${panel.label}`, {
    x: WORK_X0 + 8,
    y: y + 12,
    size: 14,
    font: ctx.fonts.bold,
    color: BLACK,
  })
  const right = `Page ${pageLabel} of ${ctx.totalPages}`
  const w = ctx.fonts.regular.widthOfTextAtSize(right, 11)
  page.drawText(right, {
    x: WORK_X1 - 8 - w,
    y: y + 12,
    size: 11,
    font: ctx.fonts.regular,
    color: BLACK,
  })
}

function drawPanelElevation(
  page: PDFPage,
  ctx: PageCtx,
  panel: CFSPanel,
  scene: SceneLike,
  sectionsById: ReadonlyMap<string, CFSSection>,
  marks: ReadonlyMap<string, string>,
): void {
  const regionX = WORK_X0
  const regionY = WORK_Y1 - TITLE_BAR_H - ELEVATION_H
  const regionW = WORK_W
  const regionH = ELEVATION_H

  // 0.25-in (18 pt) margin inside the region per §6.4.
  const transform = makePanelTransform(panel)
  const fit = scaleToFit(
    { width: transform.panelWidth_mm, height: transform.panelHeight_mm },
    { width: regionW, height: regionH, margin: 18 },
  )

  // Map panel-local mm → page points.
  function toPage(x_mm: number, y_mm: number): { x: number; y: number } {
    if (fit.rotated) {
      // 90° CCW: (x_mm, y_mm) → (height - y_mm, x_mm)
      return {
        x: regionX + fit.offsetX + (transform.panelHeight_mm - y_mm) * fit.scale,
        y: regionY + fit.offsetY + x_mm * fit.scale,
      }
    }
    return {
      x: regionX + fit.offsetX + x_mm * fit.scale,
      y: regionY + fit.offsetY + y_mm * fit.scale,
    }
  }

  // Members as filled rectangles.
  const members = membersInPanel(scene, panel.id)
  for (const m of members) {
    const section = sectionsById.get(m.sectionId)
    const fill =
      section === undefined
        ? UNRESOLVED_RED
        : ROLE_FILL[m.role] ?? rgb(0.4, 0.4, 0.4)
    if (!section) {
      // Spec §6.4: outline a member with an unresolved section as a
      // hatched red rectangle. We approximate with a thick red border
      // and pale fill; the hatching pattern is v2 polish.
      drawMemberRect(page, m, section, transform, toPage, fit.scale, UNRESOLVED_RED, true)
      continue
    }
    drawMemberRect(page, m, section, transform, toPage, fit.scale, fill, false)
  }

  // Service holes as small filled circles with contrasting outline.
  for (const m of members) {
    if (m.serviceHoleIds.length === 0) continue
    for (const holeId of m.serviceHoleIds) {
      const hole = scene.nodes[holeId as unknown as string] as
        | CFSServiceHole
        | undefined
      if (!hole) continue
      const proj = serviceHoleProjection_mm(hole, m, transform)
      const center = toPage(proj.x_mm, proj.y_mm)
      const pageR = proj.radius_mm * fit.scale
      page.drawCircle({
        x: center.x,
        y: center.y,
        size: Math.max(1, pageR),
        color: WHITE,
        borderColor: BLACK,
        borderWidth: 0.75,
      })
    }
  }

  // Member labels (shipping marks) overlaid in 7-pt at the centre.
  for (const m of members) {
    const mark = marks.get(m.id) ?? m.shippingMark
    if (!mark) continue
    const center_mm = memberCenter_mm(m, transform)
    const center = toPage(center_mm.x_mm, center_mm.y_mm)
    const isVerticalOnPage = fit.rotated
      ? !memberBoundingBox_mm(m, sectionsById.get(m.sectionId) ?? FALLBACK_SECTION, transform).isVertical
      : memberBoundingBox_mm(m, sectionsById.get(m.sectionId) ?? FALLBACK_SECTION, transform).isVertical
    const labelW = ctx.fonts.regular.widthOfTextAtSize(mark, 7)
    page.drawText(mark, {
      x: center.x - (isVerticalOnPage ? 3.5 : labelW / 2),
      y: center.y - (isVerticalOnPage ? labelW / 2 : 3.5),
      size: 7,
      font: ctx.fonts.regular,
      color: BLACK,
      rotate: isVerticalOnPage ? degrees(90) : degrees(0),
    })
  }

  // Rotated annotation.
  if (fit.rotated) {
    page.drawText('ROTATED 90°', {
      x: regionX + regionW - 70,
      y: regionY + regionH - 14,
      size: 8,
      font: ctx.fonts.bold,
      color: GRAY_FOOTER,
    })
  }

  // Dimension chains (single-segment for v1; per-stud tick marks are v2).
  drawDimensions(page, ctx, panel, regionX, regionY, regionW, regionH, fit, transform)
}

// Used only as a stand-in cross-section to compute orientation when a
// member's section is unresolved; never drawn from.
const FALLBACK_SECTION = {
  properties: { webDepth_mm: 92, flangeWidth_mm: 42 },
} as unknown as CFSSection

function drawMemberRect(
  page: PDFPage,
  m: CFSMember,
  section: CFSSection | undefined,
  transform: ReturnType<typeof makePanelTransform>,
  toPage: (x_mm: number, y_mm: number) => { x: number; y: number },
  scale: number,
  fill: RGB,
  unresolved: boolean,
): void {
  const sec = section ?? FALLBACK_SECTION
  const bb = memberBoundingBox_mm(m, sec, transform)
  // Two corners are enough to derive page-space rect even when rotated.
  const p0 = toPage(bb.x_mm, bb.y_mm)
  const p1 = toPage(bb.x_mm + bb.width_mm, bb.y_mm + bb.height_mm)
  const px = Math.min(p0.x, p1.x)
  const py = Math.min(p0.y, p1.y)
  const pw = Math.abs(p1.x - p0.x)
  const ph = Math.abs(p1.y - p0.y)
  page.drawRectangle({
    x: px,
    y: py,
    width: Math.max(0.5, pw),
    height: Math.max(0.5, ph),
    color: unresolved ? rgb(1, 0.92, 0.92) : fill,
    borderColor: unresolved ? UNRESOLVED_RED : BLACK,
    borderWidth: unresolved ? 1.5 : 0.35,
  })
  void scale
}

function drawDimensions(
  page: PDFPage,
  ctx: PageCtx,
  panel: CFSPanel,
  regionX: number,
  regionY: number,
  regionW: number,
  regionH: number,
  fit: ReturnType<typeof scaleToFit>,
  transform: ReturnType<typeof makePanelTransform>,
): void {
  const settings = ctx.project.settings
  const widthText = `${lengthForUnits(transform.panelWidth_mm, settings.units)} ${unitsSuffix(settings.units)}`
  const heightText = `${lengthForUnits(transform.panelHeight_mm, settings.units)} ${unitsSuffix(settings.units)}`

  // Horizontal chain along the bottom inside-margin of the region.
  const yChain = regionY + 6
  const xL = regionX + fit.offsetX
  const xR = regionX + fit.offsetX + fit.usedWidth
  page.drawLine({ start: { x: xL, y: yChain }, end: { x: xR, y: yChain }, thickness: 0.5, color: BLACK })
  drawCenteredText(page, ctx.fonts.regular, widthText, 8, (xL + xR) / 2, yChain - 9)

  // Vertical chain along the left inside-margin of the region.
  const xChain = regionX + 6
  const yB = regionY + fit.offsetY
  const yT = regionY + fit.offsetY + fit.usedHeight
  page.drawLine({ start: { x: xChain, y: yB }, end: { x: xChain, y: yT }, thickness: 0.5, color: BLACK })
  page.drawText(heightText, {
    x: xChain - 9,
    y: (yB + yT) / 2 - ctx.fonts.regular.widthOfTextAtSize(heightText, 8) / 2,
    size: 8,
    font: ctx.fonts.regular,
    color: BLACK,
    rotate: degrees(90),
  })

  void panel
  void regionW
  void regionH
}

function drawElevationPlaceholder(page: PDFPage, ctx: PageCtx): void {
  const y = WORK_Y1 - TITLE_BAR_H - ELEVATION_H
  drawCenteredText(
    page,
    ctx.fonts.regular,
    'BOM continuation — elevation on previous page',
    10,
    WORK_X0 + WORK_W / 2,
    y + ELEVATION_H / 2,
  )
}

// ── BOM strip (fastener block + mini-table) ─────────────────────────────────

function drawBOMStrip(
  page: PDFPage,
  ctx: PageCtx,
  panel: CFSPanel,
  rows: readonly BOMRow[],
  isContinuation: boolean,
): void {
  const stripY = WORK_Y0 + TITLE_BLOCK_H
  // Fastener block in the top-left of the strip; mini-table fills the rest.
  drawFastenerBlock(page, ctx, WORK_X0, stripY + BOM_STRIP_H - FASTENER_BLOCK_H)
  const tableX = WORK_X0 + FASTENER_BLOCK_W + 8
  const tableY = stripY
  const tableW = WORK_X1 - tableX
  const tableH = BOM_STRIP_H
  drawBOMTable(page, ctx, panel, rows, tableX, tableY, tableW, tableH, isContinuation)
}

function drawFastenerBlock(page: PDFPage, ctx: PageCtx, x: number, y: number): void {
  page.drawRectangle({
    x,
    y,
    width: FASTENER_BLOCK_W,
    height: FASTENER_BLOCK_H,
    borderColor: GRAY_BORDER,
    borderWidth: 0.5,
  })
  page.drawText('FASTENERS', {
    x: x + 6,
    y: y + FASTENER_BLOCK_H - 14,
    size: 8,
    font: ctx.fonts.bold,
    color: BLACK,
  })
  let cursorY = y + FASTENER_BLOCK_H - 26
  for (const row of FASTENER_SCHEDULE_DEFAULTS) {
    page.drawText(`${row.joint}: ${row.spec}`, {
      x: x + 6,
      y: cursorY,
      size: 7,
      font: ctx.fonts.regular,
      color: BLACK,
    })
    cursorY -= 10
  }
}

function drawBOMTable(
  page: PDFPage,
  ctx: PageCtx,
  panel: CFSPanel,
  rows: readonly BOMRow[],
  x: number,
  y: number,
  w: number,
  h: number,
  isContinuation: boolean,
): void {
  page.drawRectangle({ x, y, width: w, height: h, borderColor: GRAY_BORDER, borderWidth: 0.5 })

  const settings = ctx.project.settings
  const isImperial = settings.units === 'imperial'

  // Columns: Mark, Designation, Length, Qty, Weight
  const colX = [0, 70, 175, 245, 285].map((c) => x + c)
  const colW = [70, 105, 70, 40, w - 285]
  const headers = ['Mark', 'Designation', 'Length', 'Qty', 'Weight']
  const headerY = y + h - 14
  for (let c = 0; c < headers.length; c++) {
    page.drawText(headers[c]!, {
      x: (colX[c] ?? x) + 4,
      y: headerY,
      size: 9,
      font: ctx.fonts.bold,
      color: BLACK,
    })
  }
  page.drawLine({
    start: { x, y: headerY - 4 },
    end: { x: x + w, y: headerY - 4 },
    thickness: 0.5,
    color: BLACK,
  })

  if (isContinuation) {
    page.drawText(`(${panel.label} continued)`, {
      x: x + 4,
      y: y + h - 28,
      size: 8,
      font: ctx.fonts.regular,
      color: GRAY_FOOTER,
    })
  }

  // Rows.
  const rowH = 10
  let cursorY = headerY - 8 - rowH
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    if (i % 2 === 1) {
      page.drawRectangle({
        x,
        y: cursorY - 2,
        width: w,
        height: rowH,
        color: ROW_SHADE,
      })
    }
    const lengthDisplay = isImperial
      ? `${lengthForUnits(row.length_mm, settings.units)} in`
      : `${Math.round(row.length_mm)} mm`
    const weightDisplay = isImperial
      ? `${round2(kgToLb(row.totalWeight_kg))} lb`
      : `${round2(row.totalWeight_kg)} kg`
    const cells = [row.mark, row.designation, lengthDisplay, '1', weightDisplay]
    for (let c = 0; c < cells.length; c++) {
      page.drawText(cells[c] ?? '', {
        x: (colX[c] ?? x) + 4,
        y: cursorY,
        size: 8,
        font: ctx.fonts.regular,
        color: BLACK,
      })
    }
    cursorY -= rowH
    if (cursorY < y + 4) break
  }
  void colW
}

// ── Title block (bottom 0.5 in of every panel page) ─────────────────────────

function drawTitleBlock(
  page: PDFPage,
  ctx: PageCtx,
  panel: CFSPanel,
  pageLabel: string,
): void {
  const x = WORK_X0
  const y = WORK_Y0
  const w = WORK_W
  const h = TITLE_BLOCK_H
  page.drawRectangle({ x, y, width: w, height: h, borderColor: BLACK, borderWidth: 0.5 })

  const cellW = w / 6
  const labels = ['Project', 'Panel', 'Weight', 'Date', 'Sheet', 'Tool']
  const weight = panel.cachedWeight_kg !== undefined ? `${round2(panel.cachedWeight_kg)} kg` : '—'
  const values = [
    ctx.project.name,
    panel.label,
    weight,
    ctx.exportedAt.toISOString().slice(0, 10),
    `${pageLabel} of ${ctx.totalPages}`,
    'AACSteel-Designer v1.0.0',
  ]
  for (let i = 0; i < 6; i++) {
    const cx = x + i * cellW
    if (i > 0) {
      page.drawLine({
        start: { x: cx, y },
        end: { x: cx, y: y + h },
        thickness: 0.25,
        color: BLACK,
      })
    }
    page.drawText(labels[i]!, {
      x: cx + 4,
      y: y + h - 10,
      size: 6,
      font: ctx.fonts.bold,
      color: GRAY_FOOTER,
    })
    page.drawText(values[i]!, {
      x: cx + 4,
      y: y + 6,
      size: 9,
      font: ctx.fonts.regular,
      color: BLACK,
    })
  }
}

// ── Summary page ────────────────────────────────────────────────────────────

function drawSummaryPage(
  ctx: PageCtx,
  panels: readonly CFSPanel[],
  panelRows: ReadonlyMap<string, BOMRow[]>,
  pageNumber: number,
): void {
  const page = ctx.pdf.addPage([PAGE_W, PAGE_H])

  drawCenteredText(
    page,
    ctx.fonts.bold,
    'Project Summary',
    16,
    WORK_X0 + WORK_W / 2,
    WORK_Y1 - 24,
  )

  // 1. Project summary table (top 30 rows by weight).
  const rowsAll: BOMRow[] = []
  for (const rs of panelRows.values()) rowsAll.push(...rs)
  // Aggregate by (designation, length) like the Totals tab in BOM xlsx.
  const aggregateKey = (r: BOMRow): string => `${r.designation}|${Math.round(r.length_mm)}`
  const aggregates = new Map<
    string,
    { designation: string; length_mm: number; qty: number; weight_kg: number }
  >()
  for (const r of rowsAll) {
    const k = aggregateKey(r)
    const prev = aggregates.get(k)
    if (prev) {
      prev.qty += 1
      prev.weight_kg += r.totalWeight_kg
    } else {
      aggregates.set(k, {
        designation: r.designation,
        length_mm: r.length_mm,
        qty: 1,
        weight_kg: r.totalWeight_kg,
      })
    }
  }
  // Stable order: by weight desc, tie-broken by designation then length so
  // equal-weight aggregates don't depend on Map insertion order (§6.4 byte
  // stability).
  const sorted = [...aggregates.values()].sort((a, b) => {
    if (b.weight_kg !== a.weight_kg) return b.weight_kg - a.weight_kg
    if (a.designation !== b.designation)
      return a.designation < b.designation ? -1 : 1
    return a.length_mm - b.length_mm
  })
  const topRows = sorted.slice(0, 30)
  const totalWeight = sorted.reduce((s, r) => s + r.weight_kg, 0)

  let y = WORK_Y1 - 56
  drawSummaryTable(page, ctx, topRows, totalWeight, WORK_X0, y - 200, WORK_W, 200)

  // 2. Panel index recap.
  y = WORK_Y1 - 280
  page.drawText('Panel index', {
    x: WORK_X0,
    y,
    size: 11,
    font: ctx.fonts.bold,
    color: BLACK,
  })
  drawPanelRecap(page, ctx, panels, panelRows, WORK_X0, y - 180, WORK_W, 170)

  // 3. Notes.
  y = WORK_Y0 + 110
  page.drawText('Notes', {
    x: WORK_X0,
    y,
    size: 11,
    font: ctx.fonts.bold,
    color: BLACK,
  })
  const meta = ctx.project.metadata as Record<string, unknown> | undefined
  const notes = meta && typeof meta['notes'] === 'string' ? (meta['notes'] as string) : 'No notes.'
  page.drawText(notes, {
    x: WORK_X0,
    y: y - 16,
    size: 9,
    font: ctx.fonts.regular,
    color: BLACK,
    maxWidth: WORK_W,
  })

  drawFooter(page, ctx, pageNumber)
}

function drawSummaryTable(
  page: PDFPage,
  ctx: PageCtx,
  rows: ReadonlyArray<{ designation: string; length_mm: number; qty: number; weight_kg: number }>,
  totalWeight_kg: number,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  page.drawRectangle({ x, y, width: w, height: h, borderColor: GRAY_BORDER, borderWidth: 0.5 })
  const headers = ['Designation', 'Length (mm)', 'Qty', 'Weight (kg)']
  const colX = [0, 200, 320, 400].map((c) => x + c)
  for (let c = 0; c < headers.length; c++) {
    page.drawText(headers[c]!, {
      x: (colX[c] ?? x) + 4,
      y: y + h - 14,
      size: 9,
      font: ctx.fonts.bold,
      color: BLACK,
    })
  }
  page.drawLine({
    start: { x, y: y + h - 18 },
    end: { x: x + w, y: y + h - 18 },
    thickness: 0.5,
    color: BLACK,
  })

  let cursorY = y + h - 30
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    if (i % 2 === 1) {
      page.drawRectangle({
        x,
        y: cursorY - 2,
        width: w,
        height: 9,
        color: ROW_SHADE,
      })
    }
    const cells = [
      row.designation,
      String(Math.round(row.length_mm)),
      String(row.qty),
      String(round2(row.weight_kg)),
    ]
    for (let c = 0; c < cells.length; c++) {
      page.drawText(cells[c] ?? '', {
        x: (colX[c] ?? x) + 4,
        y: cursorY,
        size: 8,
        font: ctx.fonts.regular,
        color: BLACK,
      })
    }
    cursorY -= 10
    if (cursorY < y + 16) break
  }

  // Totals row at the bottom.
  page.drawLine({
    start: { x, y: y + 14 },
    end: { x: x + w, y: y + 14 },
    thickness: 0.5,
    color: BLACK,
  })
  page.drawText('TOTAL', {
    x: x + 4,
    y: y + 4,
    size: 9,
    font: ctx.fonts.bold,
    color: BLACK,
  })
  page.drawText(`${round2(totalWeight_kg)} kg`, {
    x: (colX[3] ?? x) + 4,
    y: y + 4,
    size: 9,
    font: ctx.fonts.bold,
    color: BLACK,
  })
}

function drawPanelRecap(
  page: PDFPage,
  ctx: PageCtx,
  panels: readonly CFSPanel[],
  panelRows: ReadonlyMap<string, BOMRow[]>,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  page.drawRectangle({ x, y, width: w, height: h, borderColor: GRAY_BORDER, borderWidth: 0.5 })
  const headers = ['#', 'Panel', 'Weight (kg)', 'Members']
  const colX = [0, 30, 200, 320].map((c) => x + c)
  for (let c = 0; c < headers.length; c++) {
    page.drawText(headers[c]!, {
      x: (colX[c] ?? x) + 4,
      y: y + h - 14,
      size: 9,
      font: ctx.fonts.bold,
      color: BLACK,
    })
  }
  page.drawLine({
    start: { x, y: y + h - 18 },
    end: { x: x + w, y: y + h - 18 },
    thickness: 0.5,
    color: BLACK,
  })
  let cursorY = y + h - 30
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i]!
    const weight = p.cachedWeight_kg !== undefined ? round2(p.cachedWeight_kg) : 0
    const memberCount =
      p.cachedMemberCount !== undefined ? p.cachedMemberCount : panelRows.get(p.id)?.length ?? 0
    const cells = [String(i + 1), p.label, String(weight), String(memberCount)]
    for (let c = 0; c < cells.length; c++) {
      page.drawText(cells[c] ?? '', {
        x: (colX[c] ?? x) + 4,
        y: cursorY,
        size: 8,
        font: ctx.fonts.regular,
        color: BLACK,
      })
    }
    cursorY -= 10
    if (cursorY < y + 8) break
  }
  void w
}

// ── Shared chrome ───────────────────────────────────────────────────────────

function drawFooter(page: PDFPage, ctx: PageCtx, pageNumber: number): void {
  const y = 18
  const stamp = `Generated by AACSteel-Designer · ${ctx.exportedAt
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19)}`
  page.drawText(stamp, {
    x: WORK_X0,
    y,
    size: 7,
    font: ctx.fonts.regular,
    color: GRAY_FOOTER,
  })
  const right = String(pageNumber)
  const w = ctx.fonts.regular.widthOfTextAtSize(right, 7)
  page.drawText(right, {
    x: PAGE_W / 2 - w / 2,
    y,
    size: 7,
    font: ctx.fonts.regular,
    color: GRAY_FOOTER,
  })
}

function drawCenteredText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  size: number,
  cx: number,
  baselineY: number,
): void {
  const w = font.widthOfTextAtSize(text, size)
  page.drawText(text, { x: cx - w / 2, y: baselineY, size, font, color: BLACK })
}
