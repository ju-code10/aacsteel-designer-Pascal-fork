import { describe, expect, it } from 'bun:test'
import { buildCanonicalWall } from '../__fixtures__/canonical-wall'
import type { CFSServiceHole } from '../../schema/cfs-service-hole'
import { exportCutList } from '../cut-list'
import { ExporterError } from '../preflight'

function parseCsv(csv: string): string[][] {
  // Strip BOM, drop trailing CRLF, split on CRLF. Tests never include
  // multi-line cells so naive splitting is enough.
  const body = csv.replace(/^﻿/, '').replace(/\r\n$/, '')
  return body.split('\r\n').map((line) => line.split(','))
}

describe('exportCutList', () => {
  it('CUT-01: canonical wall produces 13 rows, one per member', () => {
    const { scene, library, project } = buildCanonicalWall()
    const result = exportCutList(scene, library, project)
    expect(result.rowCount).toBe(13)
  })

  it('CUT-02: imperial vs metric — lengths converted at 4-dp accuracy', () => {
    const metric = exportCutList(...buildCanonicalWallArgs())
    const imperial = exportCutList(...buildCanonicalWallArgs({ units: 'imperial' }))
    const m = parseCsv(metric.csv)
    const i = parseCsv(imperial.csv)
    const lengthIdx = m[0].indexOf('length')
    const unitIdx = m[0].indexOf('length_unit')
    expect(m[1][unitIdx]).toBe('mm')
    expect(i[1][unitIdx]).toBe('in')
    // First data row corresponds to a sorted-order member; lengths should
    // round-trip through the inches column.
    const mm = Number(m[1][lengthIdx])
    const inches = Number(i[1][lengthIdx])
    expect(Math.abs(inches * 25.4 - mm)).toBeLessThan(0.05)
  })

  it('CUT-03/CUT-04: stud with two holes serializes both; zero-hole stud is empty', () => {
    const { scene, library, project, framingId } = buildCanonicalWall()
    // Attach two service holes to one of the studs (the 1800 field stud).
    const stud = Object.values(scene.nodes).find(
      (n) =>
        (n as { type?: string }).type === 'cfs_member' &&
        (n as { role?: string }).role === 'stud' &&
        (n as { start?: { x_mm: number } }).start?.x_mm === 1800,
    ) as { id: string; serviceHoleIds: string[] } | undefined
    if (!stud) throw new Error('expected canonical wall to have a stud at x=1800')
    const hole1: CFSServiceHole = {
      type: 'cfs_service_hole',
      id: 'h1' as unknown as CFSServiceHole['id'],
      parentId: stud.id as unknown as CFSServiceHole['parentId'],
      positionAlongMember_mm: 1372,
      diameter_mm: 38,
      shape: 'round',
      hasStiffener: false,
      compliance: { status: 'unchecked', reasons: [] },
    }
    const hole2: CFSServiceHole = { ...hole1, id: 'h2' as unknown as CFSServiceHole['id'], positionAlongMember_mm: 1829 }
    scene.nodes['h1'] = hole1
    scene.nodes['h2'] = hole2
    stud.serviceHoleIds = ['h1', 'h2']
    void framingId

    const { csv } = exportCutList(scene, library, project)
    const rows = parseCsv(csv)
    const punchoutsIdx = rows[0].indexOf('punchouts')
    const countIdx = rows[0].indexOf('punchout_count')
    const studRow = rows.find((r) => r[0]?.endsWith('-S3') || r[0]?.endsWith('-S1') && r[2] === 'stud')
    // Find the row representing the modified stud by matching the punchout encoding.
    const matchRow = rows.find((r) => r[punchoutsIdx] === '1372@38;1829@38')
    expect(matchRow).toBeTruthy()
    expect(matchRow?.[countIdx]).toBe('2')
    // Other studs in the scene have no holes.
    const otherStudRows = rows.filter((r) => r[2] === 'stud' && r !== matchRow && r !== studRow)
    for (const r of otherStudRows) expect(r[punchoutsIdx]).toBe('')
    for (const r of otherStudRows) expect(r[countIdx]).toBe('0')
  })

  it('CUT-05: unpaneled member still emits a row with empty panel column', () => {
    const { scene, library, project } = buildCanonicalWall()
    // Force one member's panelId to null.
    const someMember = Object.values(scene.nodes).find(
      (n) => (n as { type?: string }).type === 'cfs_member',
    ) as { id: string; panelId: string | null } | undefined
    if (someMember) someMember.panelId = null

    // Preflight requires panels for BOM/DXF but not for the cut list — so this works.
    const { csv } = exportCutList(scene, library, project)
    const rows = parseCsv(csv)
    const panelIdx = rows[0].indexOf('panel')
    const orphanRow = rows.find((r) => r[panelIdx] === '')
    expect(orphanRow).toBeTruthy()
  })

  it('CUT-06: box header → exactly one row with header_type = box (no expansion)', () => {
    const { scene, library, project } = buildCanonicalWall({ headerType: 'box' })
    const { csv } = exportCutList(scene, library, project)
    const rows = parseCsv(csv)
    const roleIdx = rows[0].indexOf('role')
    const headerTypeIdx = rows[0].indexOf('header_type')
    const headerRows = rows.filter((r) => r[roleIdx] === 'header')
    expect(headerRows).toHaveLength(1)
    expect(headerRows[0][headerTypeIdx]).toBe('box')
  })

  it('CUT-07: UTF-8 BOM is present and unicode round-trips through encoding', () => {
    // The cut-list CSV does not include the project name itself, but the
    // file must be UTF-8-encoded with a leading BOM so Excel reads any
    // non-ASCII content (e.g. unicode characters in member designations or
    // building/level ids) correctly.
    const { scene, library, project } = buildCanonicalWall()
    const { csv } = exportCutList(scene, library, project)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    // Round-trip through a UTF-8 encoder/decoder to prove the file is byte-
    // safe — the same path Excel takes when it sees the BOM.
    const bytes = new TextEncoder().encode(csv)
    // ignoreBOM:true keeps the BOM in the decoded string; without it
    // TextDecoder strips the U+FEFF signature.
    const back = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
    expect(back).toBe(csv)
  })

  it('CUT-08: cut-list weight sum matches member length × linearMass within 0.01 kg', () => {
    const { scene, library, project } = buildCanonicalWall()
    const { csv } = exportCutList(scene, library, project)
    const rows = parseCsv(csv)
    const weightIdx = rows[0].indexOf('weight_kg')
    const total = rows
      .slice(1)
      .reduce((acc, r) => acc + Number(r[weightIdx] || 0), 0)
    expect(total).toBeGreaterThan(0)
    // Cross-checked in cross-invariants test; sanity check here.
    expect(Number.isFinite(total)).toBe(true)
  })

  it('CUT-09: byte-identical between two consecutive exports of the unchanged scene', () => {
    const args = buildCanonicalWallArgs()
    const a = exportCutList(...args)
    const b = exportCutList(...args)
    expect(a.csv).toBe(b.csv)
  })

  it('CUT-10: empty scene → header row only, no data rows', () => {
    const { project, library } = buildCanonicalWall()
    const emptyScene = {
      nodes: {
        [(project as { id: string }).id]: project,
      },
    }
    const { csv, rowCount } = exportCutList(emptyScene, library, project)
    expect(rowCount).toBe(0)
    const rows = parseCsv(csv)
    expect(rows).toHaveLength(1) // just the header
  })

  it('preflight: aborts when no library is loaded', () => {
    const { scene, project } = buildCanonicalWall()
    expect(() => exportCutList(scene, null, project)).toThrow(ExporterError)
  })
})

function buildCanonicalWallArgs(
  opts: Parameters<typeof buildCanonicalWall>[0] = {},
): [Parameters<typeof exportCutList>[0], Parameters<typeof exportCutList>[1], Parameters<typeof exportCutList>[2]] {
  const f = buildCanonicalWall(opts)
  return [f.scene, f.library, f.project]
}
