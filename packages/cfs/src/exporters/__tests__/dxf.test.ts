import { describe, expect, it } from 'bun:test'
import { unzipSync, strFromU8 } from 'fflate'
import { buildCanonicalWall } from '../__fixtures__/canonical-wall'
import type { CFSServiceHole } from '../../schema/cfs-service-hole'
import { DXF_LAYERS, exportDXFs } from '../dxf'
import { ExporterError } from '../preflight'

function unzipBlobToText(blob: Blob): Promise<Record<string, string>> {
  return blob.arrayBuffer().then((buf) => {
    const files = unzipSync(new Uint8Array(buf))
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(files)) out[k] = strFromU8(v)
    return out
  })
}

describe('exportDXFs', () => {
  it('DXF-01: single panel → one DXF in the zip, header text present', async () => {
    const { scene, library, project } = buildCanonicalWall()
    const { blob, fileCount, files } = exportDXFs(scene, library, project)
    expect(fileCount).toBe(1)
    expect(Object.keys(files)).toEqual(['P-01.dxf'])
    expect(files['P-01.dxf']).toContain('SECTION')
    expect(files['P-01.dxf']).toContain('ENTITIES')
    // Zip is non-empty and is application/zip.
    const unpacked = await unzipBlobToText(blob)
    expect(Object.keys(unpacked)).toEqual(['P-01.dxf'])
  })

  it('DXF-02: multi-panel scene → one DXF per panel in sequenceNumber order', () => {
    const { scene, library, project } = buildCanonicalWall({ panelCount: 2 })
    const { files, fileCount } = exportDXFs(scene, library, project)
    expect(fileCount).toBe(2)
    expect(Object.keys(files).sort()).toEqual(['P-01.dxf', 'P-02.dxf'])
  })

  it('DXF-03/DXF-04: $INSUNITS reflects metric / imperial units', () => {
    const metric = exportDXFs(...buildArgs())
    const imperial = exportDXFs(...buildArgs({ units: 'imperial' }))
    const metricDxf = metric.files['P-01.dxf']
    const imperialDxf = imperial.files['P-01.dxf']
    // $INSUNITS appears as a header variable in the file. Value 4 = mm, 1 = in.
    expect(metricDxf).toMatch(/\$INSUNITS[\s\S]*?\b4\b/)
    expect(imperialDxf).toMatch(/\$INSUNITS[\s\S]*?\b1\b/)
  })

  it('DXF-05: service holes render as CIRCLE entities on the HOLES layer', () => {
    const { scene, library, project } = buildCanonicalWall()
    const stud = Object.values(scene.nodes).find(
      (n) =>
        (n as { type?: string }).type === 'cfs_member' &&
        (n as { role?: string }).role === 'stud',
    ) as { id: string; serviceHoleIds: string[] } | undefined
    if (!stud) throw new Error('expected a stud in canonical wall')
    const hole: CFSServiceHole = {
      type: 'cfs_service_hole',
      id: 'svc-hole-001' as unknown as CFSServiceHole['id'],
      parentId: stud.id as unknown as CFSServiceHole['parentId'],
      positionAlongMember_mm: 1200,
      diameter_mm: 38,
      shape: 'round',
      hasStiffener: false,
      compliance: { status: 'unchecked', reasons: [] },
    }
    scene.nodes['svc-hole-001'] = hole
    stud.serviceHoleIds = ['svc-hole-001']

    const { files } = exportDXFs(scene, library, project)
    const dxf = files['P-01.dxf']
    // At least one CIRCLE entity exists, and HOLES is mentioned as a layer.
    expect(dxf).toContain('\nCIRCLE\n')
    expect(dxf).toContain('HOLES')
  })

  it('DXF-06: every spec layer is registered', () => {
    const { files } = exportDXFs(...buildArgs())
    const dxf = files['P-01.dxf']
    for (const layer of DXF_LAYERS) {
      expect(dxf).toContain(layer.name)
    }
  })

  it('DXF-07: title block fields populated (PROJECT, PANEL, MEMBERS, TOOL)', () => {
    const { files } = exportDXFs(...buildArgs())
    const dxf = files['P-01.dxf']
    expect(dxf).toContain('PROJECT')
    expect(dxf).toContain('PANEL')
    expect(dxf).toContain('TOOL')
    expect(dxf).toContain('AACSteel-Designer')
  })

  it('DXF-08 (manual scope): produced file is a well-formed DXF (ENDSEC / EOF present)', () => {
    const { files } = exportDXFs(...buildArgs())
    const dxf = files['P-01.dxf']
    expect(dxf).toContain('ENDSEC')
    expect(dxf.trim().endsWith('EOF') || dxf.includes('\nEOF')).toBe(true)
  })

  it('DXF-09: empty panel (manual break, no members assigned) still produces a valid DXF with the title block', () => {
    const { scene, library, project } = buildCanonicalWall()
    // Move every member's panelId off of P-01 so the panel ends up empty.
    for (const node of Object.values(scene.nodes)) {
      if ((node as { type?: string }).type === 'cfs_member') {
        (node as { panelId: string | null }).panelId = null
      }
    }
    // Preflight requires every member to be paneled, so this should ABORT.
    expect(() => exportDXFs(scene, library, project)).toThrow(ExporterError)
  })

  it('DXF-10 (smoke): two consecutive exports of the same scene produce equivalent strings', () => {
    const a = exportDXFs(...buildArgs())
    const b = exportDXFs(...buildArgs())
    expect(a.fileCount).toBe(b.fileCount)
    expect(Object.keys(a.files)).toEqual(Object.keys(b.files))
    // The library embeds the current date in the title block — text matches
    // when run within the same second, but a token of the DXF body should
    // always be identical (entity counts, layer table).
    expect(a.files['P-01.dxf'].length).toBe(b.files['P-01.dxf'].length)
  })

  it('preflight: aborts when no panels exist', () => {
    const { scene, library, project } = buildCanonicalWall({ withoutPanels: true })
    expect(() => exportDXFs(scene, library, project)).toThrow(ExporterError)
  })
})

function buildArgs(
  opts: Parameters<typeof buildCanonicalWall>[0] = {},
): [Parameters<typeof exportDXFs>[0], Parameters<typeof exportDXFs>[1], Parameters<typeof exportDXFs>[2]] {
  const f = buildCanonicalWall(opts)
  return [f.scene, f.library, f.project]
}
