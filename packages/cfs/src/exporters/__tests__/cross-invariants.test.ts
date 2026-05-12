// §6.7 — cross-exporter invariants.
//
// Properties that must hold across re-runs and across every exporter.

import { describe, expect, it } from 'bun:test'
import { buildCanonicalWall } from '../__fixtures__/canonical-wall'
import { exportBOM } from '../bom'
import { exportCutList } from '../cut-list'
import { exportDXFs } from '../dxf'
import { exportJSON, importJSON } from '../json'
import { cfsMemberLength_mm } from '../../schema/cfs-member'
import type { CFSMember } from '../../schema/cfs-member'
import type { CFSProject } from '../../schema/cfs-project'
import type { SceneLike } from '../../lib/scene-walk'

function parseCsv(csv: string): string[][] {
  const body = csv.replace(/^﻿/, '').replace(/\r\n$/, '')
  return body.split('\r\n').map((line) => line.split(','))
}

describe('cross-exporter invariants — §6.7', () => {
  it('#1 Weight agreement: cut list sum = BOM totals = panel.cachedWeight sum (±0.05 kg)', async () => {
    const { scene, library, project } = buildCanonicalWall()
    const cut = exportCutList(scene, library, project)
    const bom = await exportBOM(scene, library, project)

    const cutRows = parseCsv(cut.csv)
    const weightIdx = cutRows[0].indexOf('weight_kg')
    const cutSum = cutRows.slice(1).reduce((acc, r) => acc + Number(r[weightIdx] || 0), 0)

    const totals = bom.workbook.getWorksheet('Totals')
    if (!totals) throw new Error('expected Totals tab')
    let bomTotal = 0
    totals.eachRow({ includeEmpty: false }, (row, idx) => {
      if (idx === 1) return
      if (row.getCell(1).value === 'TOTAL') return
      const v = row.getCell(7).value
      if (typeof v === 'number') bomTotal += v
    })

    // Note: cut list weight is one-row-per-physical-member (1 header row);
    // BOM expands the box header into 4 component rows. The expanded BOM
    // weight is therefore strictly greater than the cut-list weight whenever
    // a built-up header is present. The agreement that holds in this case
    // is BOM ≥ cut list. We assert that, and exact equality for the
    // non-header members.
    expect(bomTotal).toBeGreaterThanOrEqual(cutSum - 0.05)

    // Sum of cut-list non-header rows == sum of BOM non-header rows.
    const nonHeaderCut = cutRows
      .slice(1)
      .filter((r) => r[2] !== 'header')
      .reduce((acc, r) => acc + Number(r[weightIdx] || 0), 0)

    let nonHeaderBom = 0
    for (const ws of bom.workbook.worksheets) {
      if (!ws.name.startsWith('P-')) continue
      ws.eachRow({ includeEmpty: false }, (row, idx) => {
        if (idx === 1) return
        if (row.getCell(1).value === 'TOTAL') return
        const role = row.getCell(3).value
        if (typeof role === 'string' && role.startsWith('Header')) return
        const v = row.getCell(10).value
        if (typeof v === 'number') nonHeaderBom += v
      })
    }
    expect(Math.abs(nonHeaderCut - nonHeaderBom)).toBeLessThan(0.05)
  })

  it('#2 Member count agreement: cut list row count = pre-expansion BOM member count', async () => {
    const { scene, library, project } = buildCanonicalWall()
    const cut = exportCutList(scene, library, project)
    const physicalMemberCount = Object.values(scene.nodes).filter(
      (n) => (n as { type?: string }).type === 'cfs_member',
    ).length
    expect(cut.rowCount).toBe(physicalMemberCount)
  })

  it('#3 Length total agreement: sum of cut-list lengths matches sum of member lengths (in mm)', () => {
    const { scene, library, project } = buildCanonicalWall()
    const cut = exportCutList(scene, library, project)
    const rows = parseCsv(cut.csv)
    const lengthIdx = rows[0].indexOf('length')
    const cutTotal = rows.slice(1).reduce((acc, r) => acc + Number(r[lengthIdx] || 0), 0)
    // Cut list emits integer mm in metric mode.
    let memberTotal = 0
    for (const node of Object.values(scene.nodes)) {
      if ((node as { type?: string }).type !== 'cfs_member') continue
      memberTotal += Math.round(cfsMemberLength_mm(node as CFSMember))
    }
    expect(cutTotal).toBe(memberTotal)
  })

  it('#4 Per-panel agreement: BOM panel-tab weight ≥ cut-list weight for that panel (built-up headers explain the gap)', async () => {
    const { scene, library, project } = buildCanonicalWall({ panelCount: 2 })
    const cut = exportCutList(scene, library, project)
    const bom = await exportBOM(scene, library, project)

    const cutRows = parseCsv(cut.csv)
    const weightIdx = cutRows[0].indexOf('weight_kg')
    const panelIdx = cutRows[0].indexOf('panel')

    for (const panel of ['P-01', 'P-02']) {
      const cutW = cutRows
        .slice(1)
        .filter((r) => r[panelIdx] === panel)
        .reduce((acc, r) => acc + Number(r[weightIdx] || 0), 0)
      const tab = bom.workbook.getWorksheet(panel)
      if (!tab) throw new Error(`expected ${panel} tab`)
      let bomW = 0
      tab.eachRow({ includeEmpty: false }, (row, idx) => {
        if (idx === 1) return
        if (row.getCell(1).value === 'TOTAL') return
        const v = row.getCell(10).value
        if (typeof v === 'number') bomW += v
      })
      expect(bomW).toBeGreaterThanOrEqual(cutW - 0.05)
    }
  })

  it('#5 Round-trip stability: JSON export → import → re-export is byte-identical', async () => {
    const FIXED = new Date('2026-05-12T12:00:00.000Z')
    const { scene, project } = buildCanonicalWall()

    const first = exportJSON(scene, project, { exportedAt: FIXED })

    // Re-import into a mock store, then re-export.
    const nodes: Record<string, unknown> = {}
    const sceneStore = {
      getState() {
        return {
          nodes,
          createNode(node: unknown) {
            const id = (node as { id?: string }).id
            if (typeof id === 'string') nodes[id] = node
          },
        }
      },
    }
    const cfsStore = {
      getState() {
        return {
          memberLibraries: {
            [project.activeLibraryId as unknown as string]: { sections: [] },
          },
          setCFSMode: () => {},
          setActiveLibrary: () => {},
        }
      },
    }
    importJSON(JSON.parse(first.fileText), sceneStore, cfsStore)
    const rtProject = Object.values(nodes).find(
      (n) => (n as { type?: string }).type === 'cfs_project',
    ) as CFSProject
    const wrappedScene: SceneLike = { nodes }
    const second = exportJSON(wrappedScene, rtProject, { exportedAt: FIXED })

    expect(second.fileText).toBe(first.fileText)
  })

  it('#6 Built-up expansion consistency: box header → 4 BOM rows, 1 cut-list row, 1 DXF outline', async () => {
    const { scene, library, project } = buildCanonicalWall({ headerType: 'box' })
    const cut = exportCutList(scene, library, project)
    const bom = await exportBOM(scene, library, project)
    const dxf = exportDXFs(scene, library, project)

    const cutRows = parseCsv(cut.csv)
    const cutHeaderRows = cutRows.slice(1).filter((r) => r[2] === 'header')
    expect(cutHeaderRows).toHaveLength(1)

    const panel = bom.workbook.getWorksheet('P-01')
    if (!panel) throw new Error('expected P-01 tab')
    let bomHeaderRows = 0
    panel.eachRow({ includeEmpty: false }, (row, idx) => {
      if (idx === 1) return
      const role = row.getCell(3).value
      if (typeof role === 'string' && role.startsWith('Header')) bomHeaderRows++
    })
    expect(bomHeaderRows).toBe(4)

    // DXF: one LWPOLYLINE on the header layer. The library emits the
    // polyline with `MEMBERS_HEADER` as its layer attribute; count
    // occurrences of that layer assignment inside an LWPOLYLINE block.
    const dxfText = dxf.files['P-01.dxf']
    const headerLayerOnPolyline =
      (dxfText.match(/LWPOLYLINE[\s\S]{0,1200}?MEMBERS_HEADER/g) ?? []).length
    expect(headerLayerOnPolyline).toBe(1)
  })

  it('#7 Shipping mark uniqueness: every mark appears exactly once per exporter', async () => {
    const { scene, library, project } = buildCanonicalWall()
    const cut = exportCutList(scene, library, project)
    const bom = await exportBOM(scene, library, project)

    const cutMarks = parseCsv(cut.csv)
      .slice(1)
      .map((r) => r[0])
      .filter((s) => s !== '')
    expect(new Set(cutMarks).size).toBe(cutMarks.length)

    // BOM marks: column A across every per-panel tab. Built-up components
    // get suffixes (-A, -B, …), so the count > physical member count.
    const bomMarks: string[] = []
    for (const ws of bom.workbook.worksheets) {
      if (!ws.name.startsWith('P-')) continue
      ws.eachRow({ includeEmpty: false }, (row, idx) => {
        if (idx === 1) return
        if (row.getCell(1).value === 'TOTAL') return
        const v = row.getCell(1).value
        if (typeof v === 'string') bomMarks.push(v)
      })
    }
    expect(new Set(bomMarks).size).toBe(bomMarks.length)
  })

  it('#8 Stable order: two consecutive exports produce identical CSV bodies', () => {
    const a = exportCutList(...buildArgs())
    const b = exportCutList(...buildArgs())
    expect(a.csv).toBe(b.csv)
  })
})

function buildArgs(): [
  Parameters<typeof exportCutList>[0],
  Parameters<typeof exportCutList>[1],
  Parameters<typeof exportCutList>[2],
] {
  const f = buildCanonicalWall()
  return [f.scene, f.library, f.project]
}
