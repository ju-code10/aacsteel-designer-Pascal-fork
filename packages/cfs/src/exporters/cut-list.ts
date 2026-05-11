// §6.2 — CutListExporter. CSV (UTF-8 with BOM, CRLF) where every row is
// one physical CFSMember in the scene. Built-up headers are NOT expanded
// here — that's the BOM's job (§6.1).

import type { CFSMember } from '../schema/cfs-member'
import type { CFSMemberLibrary } from '../schema/cfs-member-library'
import type { CFSPanel } from '../schema/cfs-panel'
import type { CFSProject } from '../schema/cfs-project'
import type { CFSServiceHole } from '../schema/cfs-service-hole'
import { cfsMemberLength_mm } from '../schema/cfs-member'
import type { SceneLike } from '../lib/scene-walk'
import { writeCSVWithBOM } from '../lib/csv'
import {
  lengthForUnits,
  round2,
  unitsSuffix,
} from '../lib/length-format'
import { resolveHeaderType } from '../lib/header-type-resolver'
import { planShippingMarks } from '../lib/shipping-marks'
import {
  buildingOf,
  levelOf,
  shortId,
  sortedMembersScene,
  wallOf,
} from '../lib/scene-walk'
import { preflight } from './preflight'

const HEADERS = [
  'mark',
  'designation',
  'role',
  'length',
  'length_unit',
  'quantity',
  'weight_kg',
  'panel',
  'wall',
  'building',
  'level',
  'header_type',
  'punchouts',
  'punchout_count',
  'notes',
] as const

export interface CutListResult {
  blob: Blob
  rowCount: number // data rows, excluding the header row
  csv: string // exposed for tests (and the cross-invariants suite)
}

export function exportCutList(
  scene: SceneLike,
  library: CFSMemberLibrary | null,
  project: CFSProject | null,
): CutListResult {
  const { library: lib, project: proj } = preflight(scene, library, project, {
    requirePanels: false,
  })

  // Compute shipping marks fresh; the cut-list-only path does not write
  // them back to the scene (the production path in `useExport` calls
  // `applyShippingMarks` before this so the scene + cut list agree).
  const marks = planShippingMarks(scene)

  const useImperial = proj.settings.units === 'imperial'
  const lengthUnit = unitsSuffix(proj.settings.units)
  const sectionsById = new Map(lib.sections.map((s) => [s.id, s]))

  const members = sortedMembersScene(scene)
  const rows: (string | number)[][] = [Array.from(HEADERS)]

  for (const m of members) {
    const section = sectionsById.get(m.sectionId)
    const length_mm = cfsMemberLength_mm(m)
    const length = lengthForUnits(length_mm, proj.settings.units)
    const weight_kg = section
      ? round2((length_mm * section.linearMass_kgPerM) / 1000)
      : 0

    // Service holes, sorted by position along the member.
    const holes: CFSServiceHole[] = []
    for (const id of m.serviceHoleIds) {
      const node = scene.nodes[id as unknown as string] as CFSServiceHole | undefined
      if (node) holes.push(node)
    }
    holes.sort((a, b) => a.positionAlongMember_mm - b.positionAlongMember_mm)
    const punchouts = holes
      .map((h) => {
        const pos = lengthForUnits(h.positionAlongMember_mm, proj.settings.units)
        const dia = lengthForUnits(h.diameter_mm, proj.settings.units)
        return `${pos}@${dia}`
      })
      .join(';')

    const panelLabel = m.panelId
      ? (scene.nodes[m.panelId as unknown as string] as CFSPanel | undefined)?.label ?? ''
      : ''

    const wallId = wallOf(scene, m.parentId)
    const wallLabel = wallId ? shortId(wallId) : ''
    const buildingLabel = wallId ? (buildingOf(scene, wallId) ? shortId(buildingOf(scene, wallId) as string) : '') : ''
    const levelLabel = wallId ? (levelOf(scene, wallId) ? shortId(levelOf(scene, wallId) as string) : '') : ''

    const headerType = m.role === 'header' ? resolveHeaderType(scene, m, proj.settings) : ''
    const notes = !section ? 'unresolved section' : !wallId ? 'orphan member' : ''

    const mark = marks.get(m.id) ?? m.shippingMark ?? ''

    rows.push([
      mark,
      section?.designation ?? '',
      m.role,
      length,
      lengthUnit,
      1,
      weight_kg,
      panelLabel,
      wallLabel,
      buildingLabel,
      levelLabel,
      headerType,
      punchouts,
      holes.length,
      notes,
    ])
  }

  const csv = writeCSVWithBOM(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  return { blob, rowCount: rows.length - 1, csv }
}
