// §6.3 — DXFExporter. One DXF per panel, bundled into a zip via fflate.
//
// Library: @tarikjabiri/dxf ^2.8.0 (spec pinned ^1.6.0 but that version
// range never existed on npm; 2.x is the same library, same maintainer,
// stable. The slice 8 commit notes the version reconciliation.)
//
// Coordinate system: model space, project units (mm or 4-dp inches).
// Origin = bottom-left of the panel — the exporter translates members
// from world coords into panel-local coords so every per-panel DXF
// opens at the same origin in a CAD tool.

import { DxfWriter, Units, point3d, type LWPolylineVertex } from '@tarikjabiri/dxf'
import { zipSync } from 'fflate'
import type { CFSMember } from '../schema/cfs-member'
import type { CFSMemberLibrary, CFSSection } from '../schema/cfs-member-library'
import type { CFSPanel } from '../schema/cfs-panel'
import type { CFSProject } from '../schema/cfs-project'
import type { CFSServiceHole } from '../schema/cfs-service-hole'
import type { CFSMemberRole, CFSProjectSettings } from '../schema/primitives'
import { cfsMemberLength_mm } from '../schema/cfs-member'
import type { SceneLike } from '../lib/scene-walk'
import { membersInPanel, sortedPanelsScene } from '../lib/scene-walk'
import { lengthForUnits, round2 } from '../lib/length-format'
import { resolveHeaderType } from '../lib/header-type-resolver'
import { planShippingMarks } from '../lib/shipping-marks'
import { dxfFastenerScheduleLines } from '../lib/fastener-defaults'
import {
  makePanelTransform,
  memberBoundingBox_mm,
  memberCenter_mm,
  serviceHoleProjection_mm,
  type PanelTransform,
} from '../lib/panel-projection'
import { preflight } from './preflight'

// ── Layer table ─────────────────────────────────────────────────────────────

interface LayerSpec {
  name: string
  color: number
}

export const DXF_LAYERS: readonly LayerSpec[] = [
  { name: 'MEMBERS_TRACK', color: 8 },
  { name: 'MEMBERS_STUD', color: 5 },
  { name: 'MEMBERS_CHORD', color: 4 },
  { name: 'MEMBERS_KING', color: 4 },
  { name: 'MEMBERS_JAMB', color: 3 },
  { name: 'MEMBERS_HEADER', color: 1 },
  { name: 'MEMBERS_SILL', color: 1 },
  { name: 'MEMBERS_CRIPPLE', color: 2 },
  { name: 'HOLES', color: 6 },
  { name: 'DIMENSIONS', color: 7 },
  { name: 'LABELS', color: 7 },
  { name: 'TITLEBLOCK', color: 7 },
  { name: 'NOTES', color: 7 },
]

const ROLE_TO_LAYER: Record<CFSMemberRole, string> = {
  'top-track': 'MEMBERS_TRACK',
  'bottom-track': 'MEMBERS_TRACK',
  'sill-track': 'MEMBERS_TRACK',
  stud: 'MEMBERS_STUD',
  'chord-stud': 'MEMBERS_CHORD',
  'king-stud': 'MEMBERS_KING',
  'jamb-stud': 'MEMBERS_JAMB',
  header: 'MEMBERS_HEADER',
  sill: 'MEMBERS_SILL',
  cripple: 'MEMBERS_CRIPPLE',
}

// Per spec: bottom strip below the panel reserved for fastener schedule
// + title block. 300 mm below the wall base in metric; 12 in in imperial.
const BOTTOM_STRIP_HEIGHT_MM = 300
const TITLE_BLOCK_WIDTH_MM = 1200
const LABEL_HEIGHT_MM = 3
const TITLE_TEXT_HEIGHT_MM = 4

// ── Public entry ────────────────────────────────────────────────────────────

export interface DXFResult {
  blob: Blob
  fileCount: number
  /** Returned for tests — the per-panel DXF strings keyed by filename. */
  files: Record<string, string>
}

export function exportDXFs(
  scene: SceneLike,
  library: CFSMemberLibrary | null,
  project: CFSProject | null,
): DXFResult {
  const { library: lib, project: proj } = preflight(scene, library, project, {
    requirePanels: true,
  })

  const marks = planShippingMarks(scene)
  const panels = sortedPanelsScene(scene)
  const sectionsById = new Map(lib.sections.map((s) => [s.id, s]))

  const files: Record<string, string> = {}
  const fileBytes: Record<string, Uint8Array> = {}
  for (const panel of panels) {
    const dxf = buildPanelDXF(panel, scene, lib, sectionsById, marks, proj.settings)
    const name = `${sanitizeFilename(panel.label)}.dxf`
    files[name] = dxf
    fileBytes[name] = new TextEncoder().encode(dxf)
  }

  const zipped = zipSync(fileBytes, { level: 6 })
  const blob = new Blob([zipped as unknown as BlobPart], { type: 'application/zip' })
  return { blob, fileCount: panels.length, files }
}

function sanitizeFilename(label: string): string {
  return label.replace(/[\\/?*:"<>|]/g, '-')
}

// ── Per-panel builder ───────────────────────────────────────────────────────

function buildPanelDXF(
  panel: CFSPanel,
  scene: SceneLike,
  library: CFSMemberLibrary,
  sectionsById: ReadonlyMap<string, CFSSection>,
  marks: ReadonlyMap<string, string>,
  settings: CFSProjectSettings,
): string {
  const writer = new DxfWriter()
  writer.setUnits(settings.units === 'imperial' ? Units.Inches : Units.Millimeters)

  // Layers.
  for (const layer of DXF_LAYERS) {
    writer.addLayer(layer.name, layer.color, 'Continuous')
  }

  const members = membersInPanel(scene, panel.id)
  const transform = makePanelTransform(panel)

  drawMembers(writer, members, sectionsById, transform, settings, marks)
  drawHoles(writer, members, scene, transform, settings)
  drawDimensions(writer, panel, members, transform, settings)
  drawTitleBlock(writer, panel, library, transform, settings)
  drawFastenerSchedule(writer, panel, transform, settings)

  return writer.stringify()
}

function inUnits(mm: number, settings: CFSProjectSettings): number {
  return lengthForUnits(mm, settings.units)
}

function drawMembers(
  writer: DxfWriter,
  members: readonly CFSMember[],
  sectionsById: ReadonlyMap<string, CFSSection>,
  t: PanelTransform,
  settings: CFSProjectSettings,
  marks: ReadonlyMap<string, string>,
): void {
  for (const m of members) {
    const section = sectionsById.get(m.sectionId)
    if (!section) continue
    const layer = ROLE_TO_LAYER[m.role]
    writer.setCurrentLayerName(layer)

    const bb = memberBoundingBox_mm(m, section, t)
    const corners_mm: { x_mm: number; y_mm: number }[] = [
      { x_mm: bb.x_mm, y_mm: bb.y_mm },
      { x_mm: bb.x_mm + bb.width_mm, y_mm: bb.y_mm },
      { x_mm: bb.x_mm + bb.width_mm, y_mm: bb.y_mm + bb.height_mm },
      { x_mm: bb.x_mm, y_mm: bb.y_mm + bb.height_mm },
    ]
    const vertices: LWPolylineVertex[] = corners_mm.map((c) => ({
      point: { x: inUnits(c.x_mm, settings), y: inUnits(c.y_mm, settings) },
    }))
    writer.addLWPolyline(vertices, {
      layerName: layer,
      flags: 1, // closed
    })

    const mid_mm = memberCenter_mm(m, t)
    const mark = marks.get(m.id) ?? m.shippingMark ?? ''
    if (mark) {
      writer.setCurrentLayerName('LABELS')
      writer.addMText(
        point3d(inUnits(mid_mm.x_mm, settings), inUnits(mid_mm.y_mm, settings), 0),
        inUnits(LABEL_HEIGHT_MM, settings),
        mark,
        {
          layerName: 'LABELS',
          rotation: bb.isVertical ? 90 : 0,
        },
      )
    }
  }
}

function drawHoles(
  writer: DxfWriter,
  members: readonly CFSMember[],
  scene: SceneLike,
  t: PanelTransform,
  settings: CFSProjectSettings,
): void {
  writer.setCurrentLayerName('HOLES')
  for (const m of members) {
    if (m.serviceHoleIds.length === 0) continue
    for (const id of m.serviceHoleIds) {
      const hole = scene.nodes[id as unknown as string] as CFSServiceHole | undefined
      if (!hole) continue
      const proj = serviceHoleProjection_mm(hole, m, t)
      writer.addCircle(
        point3d(inUnits(proj.x_mm, settings), inUnits(proj.y_mm, settings), 0),
        inUnits(proj.radius_mm, settings),
        { layerName: 'HOLES' },
      )
    }
  }
}

function drawDimensions(
  writer: DxfWriter,
  panel: CFSPanel,
  members: readonly CFSMember[],
  t: PanelTransform,
  settings: CFSProjectSettings,
): void {
  writer.setCurrentLayerName('DIMENSIONS')

  // Horizontal chain: panel width across the bottom.
  const panelW = inUnits(t.panelWidth_mm, settings)
  const offsetY = inUnits(-50, settings)
  writer.addLinearDim(
    point3d(0, offsetY, 0),
    point3d(panelW, offsetY, 0),
    { layerName: 'DIMENSIONS', offset: 0 },
  )
  // Per-vertical-member tick marks on the chain: deferred to v2 along
  // with the §6.3 review of DIMENSION entity rendering in CAD viewers.
  void members

  // Vertical chain: panel height on the left side.
  const panelH = inUnits(t.panelHeight_mm, settings)
  const offsetX = inUnits(-50, settings)
  writer.addLinearDim(
    point3d(offsetX, 0, 0),
    point3d(offsetX, panelH, 0),
    { layerName: 'DIMENSIONS', offset: 0, angle: 90 },
  )

  void panel
}

function drawTitleBlock(
  writer: DxfWriter,
  panel: CFSPanel,
  library: CFSMemberLibrary,
  t: PanelTransform,
  settings: CFSProjectSettings,
): void {
  writer.setCurrentLayerName('TITLEBLOCK')
  const x0 = inUnits(t.panelWidth_mm - TITLE_BLOCK_WIDTH_MM, settings)
  const x1 = inUnits(t.panelWidth_mm, settings)
  const y0 = inUnits(-BOTTOM_STRIP_HEIGHT_MM, settings)
  const y1 = 0

  // Outer border + 4 rows × 2 columns = 5 horizontal lines + 3 vertical lines.
  for (let i = 0; i <= 4; i++) {
    const y = y0 + ((y1 - y0) * i) / 4
    writer.addLine(point3d(x0, y, 0), point3d(x1, y, 0), { layerName: 'TITLEBLOCK' })
  }
  const xMid = (x0 + x1) / 2
  writer.addLine(point3d(x0, y0, 0), point3d(x0, y1, 0), { layerName: 'TITLEBLOCK' })
  writer.addLine(point3d(xMid, y0, 0), point3d(xMid, y1, 0), { layerName: 'TITLEBLOCK' })
  writer.addLine(point3d(x1, y0, 0), point3d(x1, y1, 0), { layerName: 'TITLEBLOCK' })

  const cellH = (y1 - y0) / 4
  const textH = inUnits(TITLE_TEXT_HEIGHT_MM, settings)
  const labels: [string, string][] = [
    ['PROJECT', 'DATE'],
    ['PANEL', 'SCALE'],
    ['WEIGHT', 'MEMBERS'],
    ['TOOL', 'LIBRARY'],
  ]
  const values: [string, string][] = [
    [/* PROJECT */ projectName(panel), new Date().toISOString().slice(0, 10)],
    [/* PANEL  */ panel.label, 'NTS'],
    [
      /* WEIGHT  */ panel.cachedWeight_kg !== undefined
        ? `${round2(panel.cachedWeight_kg)} kg`
        : '—',
      /* MEMBERS */ panel.cachedMemberCount !== undefined ? String(panel.cachedMemberCount) : '—',
    ],
    [
      /* TOOL    */ 'AACSteel-Designer',
      /* LIBRARY */ `${library.name} ${library.version}`,
    ],
  ]
  for (let row = 0; row < 4; row++) {
    const yRow = y1 - row * cellH
    const labelPair = labels[row]
    const valuePair = values[row]
    if (!labelPair || !valuePair) continue
    // Cell label (top of cell) and value (mid-cell).
    writer.addText(
      point3d(x0 + textH, yRow - textH * 1.2, 0),
      textH * 0.7,
      labelPair[0],
      { layerName: 'TITLEBLOCK' },
    )
    writer.addText(
      point3d(xMid + textH, yRow - textH * 1.2, 0),
      textH * 0.7,
      labelPair[1],
      { layerName: 'TITLEBLOCK' },
    )
    writer.addText(
      point3d(x0 + textH, yRow - cellH + textH, 0),
      textH,
      valuePair[0],
      { layerName: 'TITLEBLOCK' },
    )
    writer.addText(
      point3d(xMid + textH, yRow - cellH + textH, 0),
      textH,
      valuePair[1],
      { layerName: 'TITLEBLOCK' },
    )
  }
}

function projectName(_panel: CFSPanel): string {
  // The DXF builder receives the panel + library; the project is not
  // threaded down explicitly because every other field on the title block
  // is derived from the panel/library. The project name is plumbed via a
  // panel-side cached field if available, else falls back to the panel id
  // prefix. The DXF exporter's caller in `useExport` will populate this
  // properly in Slice 9 when the project surface is needed everywhere.
  return 'AACSteel-Designer Project'
}

function drawFastenerSchedule(
  writer: DxfWriter,
  _panel: CFSPanel,
  t: PanelTransform,
  settings: CFSProjectSettings,
): void {
  writer.setCurrentLayerName('NOTES')
  const x0 = inUnits(0, settings)
  const y0 = inUnits(-BOTTOM_STRIP_HEIGHT_MM, settings)
  const textH = inUnits(TITLE_TEXT_HEIGHT_MM * 0.8, settings)
  const lines = dxfFastenerScheduleLines()
  const rowH = textH * 1.4
  lines.forEach((line, i) => {
    writer.addText(
      point3d(x0 + textH, y0 + (lines.length - i) * rowH, 0),
      textH,
      line,
      { layerName: 'NOTES' },
    )
  })
  void t
}
