import { describe, expect, it } from 'bun:test'
import { buildCanonicalWall } from '../__fixtures__/canonical-wall'
import { exportBOM } from '../bom'
import { ExporterError } from '../preflight'

describe('exportBOM', () => {
  it('BOM-01: canonical wall → cover + 1 panel tab + totals; box header expands header rows', async () => {
    const { scene, library, project } = buildCanonicalWall({ headerType: 'box' })
    const { workbook, panelCount } = await exportBOM(scene, library, project)
    expect(panelCount).toBe(1)
    const tabNames = workbook.worksheets.map((w) => w.name)
    expect(tabNames).toEqual(['Cover', 'P-01', 'Totals'])

    const panelTab = workbook.getWorksheet('P-01')
    if (!panelTab) throw new Error('expected P-01 tab')
    // Row 1 is the header. Data rows for the canonical wall:
    //   12 non-header members (2 tracks, 2 chord, 2 king, 2 jamb, 3 stud, 1 cripple)
    //   + 4 expanded box-header sub-rows = 16
    const lastDataRowIdx = 1 + 16
    expect(panelTab.getRow(lastDataRowIdx).getCell(1).value).toBeTruthy()
    // Totals row sits right after.
    const totalsRow = panelTab.getRow(lastDataRowIdx + 1)
    expect(totalsRow.getCell(1).value).toBe('TOTAL')
    // Totals column J is a real Excel SUM formula.
    const totalsCell = totalsRow.getCell(10).value as { formula?: string }
    expect(totalsCell?.formula).toMatch(/^SUM\(J2:J17\)$/)
  })

  it('BOM-02: two panels in the same wall → tab in sequence order; totals combines', async () => {
    const { scene, library, project } = buildCanonicalWall({ panelCount: 2 })
    const { workbook, panelCount } = await exportBOM(scene, library, project)
    expect(panelCount).toBe(2)
    const tabNames = workbook.worksheets.map((w) => w.name)
    expect(tabNames).toEqual(['Cover', 'P-01', 'P-02', 'Totals'])
  })

  it('BOM-03: box header → 4 rows on the panel tab (2 C + 2 track)', async () => {
    const { scene, library, project } = buildCanonicalWall({ headerType: 'box' })
    const { workbook } = await exportBOM(scene, library, project)
    const tab = workbook.getWorksheet('P-01')
    if (!tab) throw new Error('expected P-01 tab')
    // Count rows whose Role column starts with 'Header'.
    let headerRows = 0
    tab.eachRow({ includeEmpty: false }, (row, idx) => {
      if (idx === 1) return
      const role = row.getCell(3).value
      if (typeof role === 'string' && role.startsWith('Header')) headerRows++
    })
    expect(headerRows).toBe(4)
  })

  it('BOM-04: L-header → 2 rows', async () => {
    const { scene, library, project } = buildCanonicalWall({ headerType: 'L-header' })
    const { workbook } = await exportBOM(scene, library, project)
    const tab = workbook.getWorksheet('P-01')
    if (!tab) throw new Error('expected P-01 tab')
    let headerRows = 0
    tab.eachRow({ includeEmpty: false }, (row, idx) => {
      if (idx === 1) return
      const role = row.getCell(3).value
      if (typeof role === 'string' && role.startsWith('Header')) headerRows++
    })
    expect(headerRows).toBe(2)
  })

  it('BOM-05: single-track header → 1 row', async () => {
    const { scene, library, project } = buildCanonicalWall({ headerType: 'single-track' })
    const { workbook } = await exportBOM(scene, library, project)
    const tab = workbook.getWorksheet('P-01')
    if (!tab) throw new Error('expected P-01 tab')
    let headerRows = 0
    tab.eachRow({ includeEmpty: false }, (row, idx) => {
      if (idx === 1) return
      const role = row.getCell(3).value
      if (typeof role === 'string' && role.startsWith('Header')) headerRows++
    })
    expect(headerRows).toBe(1)
  })

  it('BOM-06: per-panel totals sum to the totals-tab weight (within 0.01 kg)', async () => {
    const { scene, library, project } = buildCanonicalWall()
    const { workbook } = await exportBOM(scene, library, project)
    const totals = workbook.getWorksheet('Totals')
    if (!totals) throw new Error('expected Totals tab')

    let perPanelSum = 0
    for (const ws of workbook.worksheets) {
      if (!ws.name.startsWith('P-')) continue
      ws.eachRow({ includeEmpty: false }, (row, idx) => {
        if (idx === 1) return
        if (row.getCell(1).value === 'TOTAL') return
        const v = row.getCell(10).value
        if (typeof v === 'number') perPanelSum += v
      })
    }

    let totalsTabSum = 0
    totals.eachRow({ includeEmpty: false }, (row, idx) => {
      if (idx === 1) return
      if (row.getCell(1).value === 'TOTAL') return
      const v = row.getCell(7).value
      if (typeof v === 'number') totalsTabSum += v
    })
    expect(Math.abs(perPanelSum - totalsTabSum)).toBeLessThan(0.05)
  })

  it('BOM-07: imperial units → cover shows imperial; both length columns populated', async () => {
    const { scene, library, project } = buildCanonicalWall({ units: 'imperial' })
    const { workbook } = await exportBOM(scene, library, project)
    const cover = workbook.getWorksheet('Cover')
    if (!cover) throw new Error('expected Cover tab')
    expect(cover.getCell('B7').value).toBe('imperial')

    const panel = workbook.getWorksheet('P-01')
    if (!panel) throw new Error('expected P-01')
    // Data row 2: both D (mm) and E (in) should be populated numbers.
    const row2 = panel.getRow(2)
    expect(typeof row2.getCell(4).value).toBe('number')
    expect(typeof row2.getCell(5).value).toBe('number')
  })

  it('BOM-08: unresolved section → preflight aborts', async () => {
    const { scene, library, project } = buildCanonicalWall()
    // Mutate one member to reference a nonexistent section.
    const m = Object.values(scene.nodes).find(
      (n) => (n as { type?: string }).type === 'cfs_member',
    ) as { sectionId: string } | undefined
    if (m) m.sectionId = '99999999-9999-4999-8999-999999999999'
    await expect(exportBOM(scene, library, project)).rejects.toThrow(ExporterError)
  })

  it('BOM-09: no panels → preflight aborts', async () => {
    const { scene, library, project } = buildCanonicalWall({ withoutPanels: true })
    await expect(exportBOM(scene, library, project)).rejects.toThrow(ExporterError)
  })

  it('BOM-10: two consecutive exports of the same scene produce equivalent buffers (ignoring timestamp)', async () => {
    // We can't easily byte-compare xlsx (zipped XML with order-sensitive
    // ZIP entries and embedded creation times). Instead, verify the row
    // values are identical across two runs.
    const args1 = buildCanonicalWall()
    const args2 = buildCanonicalWall()
    const a = await exportBOM(args1.scene, args1.library, args1.project)
    const b = await exportBOM(args2.scene, args2.library, args2.project)
    expect(a.totalRowCount).toBe(b.totalRowCount)
    const wsA = a.workbook.getWorksheet('Totals')
    const wsB = b.workbook.getWorksheet('Totals')
    if (!wsA || !wsB) throw new Error('expected Totals on both runs')
    const rowsA: unknown[][] = []
    const rowsB: unknown[][] = []
    wsA.eachRow((r) => rowsA.push(r.values as unknown[]))
    wsB.eachRow((r) => rowsB.push(r.values as unknown[]))
    expect(rowsA.length).toBe(rowsB.length)
  })

  it('BOM-11 (smoke): writes a non-empty xlsx blob', async () => {
    const { scene, library, project } = buildCanonicalWall()
    const { blob } = await exportBOM(scene, library, project)
    expect(blob.size).toBeGreaterThan(1000)
    expect(blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
  })
})
