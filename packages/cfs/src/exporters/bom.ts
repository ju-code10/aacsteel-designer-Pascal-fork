// §6.1 — BOMExporter. Multi-tab xlsx (Cover + per-panel + Totals) with
// built-up header expansion.
//
// Library: ExcelJS ^4.4.0. Output: xlsx Blob ready for triggerDownload.

import ExcelJS from 'exceljs'
import type { CFSMember } from '../schema/cfs-member'
import type { CFSMemberLibrary, CFSSection } from '../schema/cfs-member-library'
import type { CFSPanel } from '../schema/cfs-panel'
import type { CFSProject } from '../schema/cfs-project'
import type { CFSWallFraming } from '../schema/cfs-wall-framing'
import type { CFSHeaderType, CFSMemberRole, CFSProjectSettings } from '../schema/primitives'
import { cfsMemberLength_mm } from '../schema/cfs-member'
import type { SceneLike } from '../lib/scene-walk'
import { membersInPanel, sortedPanelsScene } from '../lib/scene-walk'
import {
  kgToLb,
  mmToFeetInchSixteenths,
  mmToInches4dp,
  mmToIntegerMm,
  round2,
} from '../lib/length-format'
import { resolveHeaderType } from '../lib/header-type-resolver'
import { planShippingMarks } from '../lib/shipping-marks'
import {
  HEADER_COMPONENTS,
  type HeaderComponentSpec,
  roleDisplayLabel,
} from './header-components'
import { preflight } from './preflight'

export interface BOMRow {
  panelId: string
  mark: string
  designation: string
  role: string // display label
  length_mm: number
  unitWeight_kg: number
  totalWeight_kg: number
  notes: string
}

export interface BOMResult {
  blob: Blob
  panelCount: number
  totalRowCount: number
  /** Returned for tests + cross-invariants; the workbook itself. */
  workbook: ExcelJS.Workbook
}

// ── Public entry ────────────────────────────────────────────────────────────

export async function exportBOM(
  scene: SceneLike,
  library: CFSMemberLibrary | null,
  project: CFSProject | null,
): Promise<BOMResult> {
  const { library: lib, project: proj } = preflight(scene, library, project, {
    requirePanels: true,
  })

  const marks = planShippingMarks(scene)
  const panels = sortedPanelsScene(scene)
  const sectionsById = new Map(lib.sections.map((s) => [s.id, s]))

  // Expand every panel's members into BOM rows.
  const expandedRows: BOMRow[] = []
  for (const panel of panels) {
    const rows = expandPanelToBOMRows(panel, scene, lib, sectionsById, marks, proj.settings)
    expandedRows.push(...rows)
  }

  const wb = new ExcelJS.Workbook()
  wb.creator = 'AACSteel-Designer'
  wb.created = new Date()
  writeCoverTab(wb, lib, proj, panels.length, expandedRows)

  for (const panel of panels) {
    const panelRows = expandedRows.filter((r) => r.panelId === panel.id)
    writePanelTab(wb, panel, panelRows, proj.settings)
  }

  writeTotalsTab(wb, expandedRows)

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  return { blob, panelCount: panels.length, totalRowCount: expandedRows.length, workbook: wb }
}

// ── Row expansion ───────────────────────────────────────────────────────────

/**
 * Expand one panel's members into BOM rows, applying the built-up
 * header expansion table. Exported because the PDF shop-drawings
 * mini-table (§6.4) must render the same row set as the xlsx per-panel
 * tab, post-expansion.
 */
export function expandPanelToBOMRows(
  panel: CFSPanel,
  scene: SceneLike,
  library: CFSMemberLibrary,
  sectionsById: ReadonlyMap<string, CFSSection>,
  marks: ReadonlyMap<string, string>,
  settings: CFSProjectSettings,
): BOMRow[] {
  const rows: BOMRow[] = []
  const members = membersInPanel(scene, panel.id)
  for (const m of members) {
    const baseMark = marks.get(m.id) ?? m.shippingMark ?? ''
    if (m.role === 'header') {
      const headerType = resolveHeaderType(scene, m, settings)
      const components = HEADER_COMPONENTS[headerType]
      let pieceIndex = 0
      const totalPieces = components.reduce((n, c) => n + c.quantityPerHeader, 0)
      const framing = scene.nodes[m.parentId as unknown as string] as CFSWallFraming | undefined
      for (const comp of components) {
        for (let q = 0; q < comp.quantityPerHeader; q++) {
          pieceIndex++
          const section = resolveComponentSection(comp, framing, settings, library, sectionsById)
          const length_mm = cfsMemberLength_mm(m) * comp.lengthFactor
          rows.push(rowFromExpansion({
            panelId: panel.id,
            mark: `${baseMark}-${letterFor(pieceIndex)}`,
            designation: section?.designation ?? '[UNRESOLVED]',
            role: roleDisplayLabel(comp.role),
            length_mm,
            section,
            notes: `built-up: ${headerType} header component ${pieceIndex} of ${totalPieces}`,
          }))
        }
      }
    } else {
      const section = sectionsById.get(m.sectionId)
      const length_mm = cfsMemberLength_mm(m)
      rows.push(rowFromExpansion({
        panelId: panel.id,
        mark: baseMark,
        designation: section?.designation ?? `[UNRESOLVED: ${m.sectionId}]`,
        role: roleDisplayLabel(m.role),
        length_mm,
        section,
        notes: section ? '' : 'section not in active library',
      }))
    }
  }
  return rows
}

function rowFromExpansion(opts: {
  panelId: string
  mark: string
  designation: string
  role: string
  length_mm: number
  section: CFSSection | undefined
  notes: string
}): BOMRow {
  const unitWeight_kg = opts.section
    ? round2((opts.length_mm * opts.section.linearMass_kgPerM) / 1000)
    : 0
  return {
    panelId: opts.panelId,
    mark: opts.mark,
    designation: opts.designation,
    role: opts.role,
    length_mm: opts.length_mm,
    unitWeight_kg,
    totalWeight_kg: unitWeight_kg, // quantity is always 1 in the per-panel view
    notes: opts.notes,
  }
}

function resolveComponentSection(
  comp: HeaderComponentSpec,
  framing: CFSWallFraming | undefined,
  settings: CFSProjectSettings,
  library: CFSMemberLibrary,
  sectionsById: ReadonlyMap<string, CFSSection>,
): CFSSection | undefined {
  if (comp.sectionRef.kind === 'fixed') {
    return sectionsById.get(comp.sectionRef.sectionId)
  }
  const sectionId =
    comp.sectionRef.kind === 'studSection'
      ? framing?.studSectionId ?? settings.defaultStudSection
      : framing?.trackSectionId ?? settings.defaultTrackSection
  void library
  return sectionsById.get(sectionId)
}

function letterFor(i: number): string {
  // 1 → A, 2 → B, …, 26 → Z, 27 → AA, …
  let s = ''
  let n = i
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

// ── Tab writers ─────────────────────────────────────────────────────────────

function writeCoverTab(
  wb: ExcelJS.Workbook,
  library: CFSMemberLibrary,
  project: CFSProject,
  panelCount: number,
  expandedRows: readonly BOMRow[],
): void {
  const ws = wb.addWorksheet('Cover')
  ws.getColumn(1).width = 18
  ws.getColumn(2).width = 40
  const jobNumber = (project.metadata as Record<string, unknown>)?.jobNumber as string | undefined
  const client = (project.metadata as Record<string, unknown>)?.client as string | undefined
  const totalWeight_kg = expandedRows.reduce((acc, r) => acc + r.totalWeight_kg, 0)

  const rows: [string, string | number][] = [
    ['Project', project.name],
    ['Job number', jobNumber ?? '—'],
    ['Client', client ?? '—'],
    ['Generated', new Date().toISOString()],
    ['Schema version', project.schemaVersion],
    ['Active library', `${library.name} ${library.version}`],
    ['Units', project.settings.units],
    ['Total panel count', panelCount],
    ['Total member count', expandedRows.length],
    [
      'Total weight',
      project.settings.units === 'imperial'
        ? `${round2(totalWeight_kg)} kg / ${round2(kgToLb(totalWeight_kg))} lb`
        : `${round2(totalWeight_kg)} kg`,
    ],
  ]
  for (const r of rows) ws.addRow(r)
  for (let i = 1; i <= rows.length; i++) {
    const labelCell = ws.getCell(`A${i}`)
    labelCell.font = { bold: true }
    labelCell.alignment = { horizontal: 'right' }
    ws.getCell(`B${i}`).alignment = { horizontal: 'left' }
  }
}

const PANEL_HEADERS = [
  'Mark',
  'Designation',
  'Role',
  'Length (mm)',
  'Length (in)',
  'Length (ft-in-16)',
  'Quantity',
  'Unit weight (kg)',
  'Unit weight (lb)',
  'Total weight (kg)',
  'Notes',
] as const

function writePanelTab(
  wb: ExcelJS.Workbook,
  panel: CFSPanel,
  rows: readonly BOMRow[],
  _settings: CFSProjectSettings,
): void {
  void _settings
  // Excel tab names cannot contain `/ \ ? * [ ]`. v1 panel labels are
  // `P-NN` which is safe; if v2 introduces user labels, slugify them.
  const name = ensureUniqueTabName(wb, sanitizeTabName(panel.label))
  const ws = wb.addWorksheet(name)
  ws.addRow(Array.from(PANEL_HEADERS))
  const headerRow = ws.getRow(1)
  headerRow.font = { bold: true }
  headerRow.eachCell((cell) => (cell.alignment = { horizontal: 'center' }))
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  for (const r of rows) {
    ws.addRow([
      r.mark,
      r.designation,
      r.role,
      mmToIntegerMm(r.length_mm),
      mmToInches4dp(r.length_mm),
      mmToFeetInchSixteenths(r.length_mm),
      1,
      r.unitWeight_kg,
      round2(kgToLb(r.unitWeight_kg)),
      r.totalWeight_kg,
      r.notes,
    ])
  }

  // Totals row: TOTAL in A, =SUM(J2:JN) in J. Bold + top border.
  const lastDataRow = rows.length + 1 // header is row 1
  const totalsRowIdx = lastDataRow + 1
  const totalsRow = ws.getRow(totalsRowIdx)
  totalsRow.getCell(1).value = 'TOTAL'
  if (rows.length > 0) {
    totalsRow.getCell(10).value = {
      formula: `SUM(J2:J${lastDataRow})`,
      result: rows.reduce((acc, r) => acc + r.totalWeight_kg, 0),
    }
  } else {
    totalsRow.getCell(10).value = 0
  }
  totalsRow.font = { bold: true }
  totalsRow.eachCell({ includeEmpty: false }, (cell) => {
    cell.border = { top: { style: 'thin' } }
  })

  // Column widths (proportional, not pixel-perfect).
  ws.getColumn(1).width = 14
  ws.getColumn(2).width = 16
  ws.getColumn(3).width = 18
  ws.getColumn(4).width = 12
  ws.getColumn(5).width = 12
  ws.getColumn(6).width = 16
  ws.getColumn(7).width = 9
  ws.getColumn(8).width = 14
  ws.getColumn(9).width = 14
  ws.getColumn(10).width = 16
  ws.getColumn(11).width = 30
}

const TOTALS_HEADERS = [
  'Designation',
  'Length (mm)',
  'Length (in)',
  'Length (ft-in-16)',
  'Quantity',
  'Unit weight (kg)',
  'Total weight (kg)',
  'Total weight (lb)',
  'Panels',
] as const

interface AggKey {
  designation: string
  length_mm_int: number
}
interface AggValue {
  length_mm: number
  quantity: number
  unitWeight_kg: number
  panels: Set<string>
}

function writeTotalsTab(wb: ExcelJS.Workbook, rows: readonly BOMRow[]): void {
  const ws = wb.addWorksheet('Totals')
  ws.addRow(Array.from(TOTALS_HEADERS))
  const headerRow = ws.getRow(1)
  headerRow.font = { bold: true }
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  // Aggregate by (designation, integer mm).
  const agg = new Map<string, AggValue & AggKey>()
  // Panel labels per (panelId).
  const panelLabelById = new Map<string, string>()
  for (const r of rows) panelLabelById.set(r.panelId, '')
  // Reverse-look the panel labels from rows: rows carry panelId but not
  // label. The label is the mark prefix (`P-NN`), so split.
  for (const r of rows) {
    const dash = r.mark.indexOf('-', r.mark.indexOf('-') + 1) // panel-NN-role
    const label = dash > 0 ? r.mark.slice(0, dash) : r.mark
    panelLabelById.set(r.panelId, label)
  }

  for (const r of rows) {
    const intMm = Math.round(r.length_mm)
    const k = `${r.designation}__${intMm}`
    let v = agg.get(k)
    if (!v) {
      v = {
        designation: r.designation,
        length_mm_int: intMm,
        length_mm: r.length_mm,
        quantity: 0,
        unitWeight_kg: r.unitWeight_kg,
        panels: new Set(),
      }
      agg.set(k, v)
    }
    v.quantity += 1
    v.panels.add(panelLabelById.get(r.panelId) ?? r.panelId)
  }

  const aggArr = Array.from(agg.values()).sort((a, b) => {
    if (a.designation !== b.designation) return a.designation < b.designation ? -1 : 1
    return a.length_mm_int - b.length_mm_int
  })

  for (const v of aggArr) {
    const total_kg = round2(v.unitWeight_kg * v.quantity)
    ws.addRow([
      v.designation,
      v.length_mm_int,
      mmToInches4dp(v.length_mm_int),
      mmToFeetInchSixteenths(v.length_mm_int),
      v.quantity,
      v.unitWeight_kg,
      total_kg,
      round2(kgToLb(total_kg)),
      Array.from(v.panels).sort().join(', '),
    ])
  }

  // Totals row.
  const lastDataRow = aggArr.length + 1
  if (aggArr.length > 0) {
    const totalsRow = ws.getRow(lastDataRow + 1)
    totalsRow.getCell(1).value = 'TOTAL'
    totalsRow.getCell(7).value = {
      formula: `SUM(G2:G${lastDataRow})`,
      result: aggArr.reduce((acc, v) => acc + round2(v.unitWeight_kg * v.quantity), 0),
    }
    totalsRow.getCell(8).value = {
      formula: `SUM(H2:H${lastDataRow})`,
      result: aggArr.reduce(
        (acc, v) => acc + round2(kgToLb(round2(v.unitWeight_kg * v.quantity))),
        0,
      ),
    }
    totalsRow.font = { bold: true }
    totalsRow.eachCell({ includeEmpty: false }, (cell) => {
      cell.border = { top: { style: 'thin' } }
    })
  }

  // Widths.
  ws.getColumn(1).width = 16
  ws.getColumn(2).width = 12
  ws.getColumn(3).width = 12
  ws.getColumn(4).width = 16
  ws.getColumn(5).width = 9
  ws.getColumn(6).width = 14
  ws.getColumn(7).width = 16
  ws.getColumn(8).width = 16
  ws.getColumn(9).width = 24
}

const RESERVED_TAB_CHARS = /[\\/?*[\]:]/g

function sanitizeTabName(name: string): string {
  return name.replace(RESERVED_TAB_CHARS, '-').slice(0, 31)
}

function ensureUniqueTabName(wb: ExcelJS.Workbook, name: string): string {
  if (!wb.getWorksheet(name)) return name
  let i = 2
  while (wb.getWorksheet(`${name} (${i})`)) i++
  return `${name} (${i})`
}

// Re-exports for consumers (and tests).
export type { CFSHeaderType, CFSMemberRole }
