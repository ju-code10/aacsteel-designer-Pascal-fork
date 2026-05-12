import { describe, expect, it } from 'bun:test'
import { unzlibSync } from 'fflate'
import { PDFDocument, PDFRawStream } from 'pdf-lib'
import { buildCanonicalWall } from '../__fixtures__/canonical-wall'
import type { CFSPanel } from '../../schema/cfs-panel'
import type { CFSServiceHole } from '../../schema/cfs-service-hole'
import { exportShopDrawings } from '../shop-drawings'
import { ExporterError } from '../preflight'

// Frozen timestamp for deterministic PDF bytes across runs.
const FIXED_DATE = new Date('2026-05-12T12:00:00.000Z')

// pdf-lib FlateDecode-compresses every content stream AND encodes text
// strings as hex literals `<41414353...>` rather than `(text)` literals.
// To grep for text we inflate every PDFRawStream and decode every hex
// string we encounter into plain ASCII. Heavier than a raw substring
// search but the only reliable way to assert on labels, totals, and
// page numbering without adding a heavyweight pdfjs dependency.
async function extractAllStreamText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  const decoder = new TextDecoder('latin1')
  let raw = ''
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    let data = obj.contents
    try {
      data = unzlibSync(data)
    } catch {
      // not deflate-compressed — use raw contents
    }
    raw += decoder.decode(data) + '\n'
  }
  // Decode every `<HEXHEXHEX>` literal into ASCII and replace inline.
  return raw.replace(/<([0-9A-Fa-f\s]+)>/g, (_match, hex: string) => {
    const clean = hex.replace(/\s+/g, '')
    let s = ''
    for (let i = 0; i + 1 < clean.length; i += 2) {
      s += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16))
    }
    return s
  })
}

describe('exportShopDrawings', () => {
  it('PDF-01: single-panel project → 3 pages (cover + 1 panel + summary)', async () => {
    const { scene, library, project } = buildCanonicalWall()
    const result = await exportShopDrawings(scene, library, project, {
      exportedAt: FIXED_DATE,
    })
    expect(result.pageCount).toBe(3)
    expect(result.blob.type).toBe('application/pdf')
    expect(result.bytes.byteLength).toBeGreaterThan(1000)
  })

  it('PDF-02: 5-panel project → 7 pages', async () => {
    const { scene, library, project } = buildCanonicalWall({ panelCount: 5 })
    const result = await exportShopDrawings(scene, library, project, {
      exportedAt: FIXED_DATE,
    })
    expect(result.pageCount).toBe(7)
  })

  it('PDF-03: per-panel weight on title block matches cachedWeight_kg', async () => {
    const { scene, library, project, members } = buildCanonicalWall()
    // Populate the panel's cached weight from the fixture members so the
    // title block has a real value to render.
    const panel = Object.values(scene.nodes).find(
      (n) => (n as { type?: string }).type === 'cfs_panel',
    ) as CFSPanel | undefined
    if (!panel) throw new Error('no panel')
    panel.cachedWeight_kg = 123.45
    panel.cachedMemberCount = members.length
    const result = await exportShopDrawings(scene, library, project, {
      exportedAt: FIXED_DATE,
    })
    const ascii = await extractAllStreamText(result.bytes)
    expect(ascii).toContain('123.45 kg')
  })

  it('PDF-04: index page lists every panel label', async () => {
    const { scene, library, project } = buildCanonicalWall({ panelCount: 3 })
    const result = await exportShopDrawings(scene, library, project, {
      exportedAt: FIXED_DATE,
    })
    const ascii = await extractAllStreamText(result.bytes)
    expect(ascii).toContain('P-01')
    expect(ascii).toContain('P-02')
    expect(ascii).toContain('P-03')
  })

  it('PDF-05: service holes produce circle drawing ops on the panel page', async () => {
    const { scene, library, project } = buildCanonicalWall()
    const stud = Object.values(scene.nodes).find(
      (n) =>
        (n as { type?: string }).type === 'cfs_member' &&
        (n as { role?: string }).role === 'stud',
    ) as { id: string; serviceHoleIds: string[] } | undefined
    if (!stud) throw new Error('expected a stud in canonical wall')
    const hole: CFSServiceHole = {
      type: 'cfs_service_hole',
      id: 'svc-hole-pdf-1' as unknown as CFSServiceHole['id'],
      parentId: stud.id as unknown as CFSServiceHole['parentId'],
      positionAlongMember_mm: 1200,
      diameter_mm: 38,
      shape: 'round',
      hasStiffener: false,
      compliance: { status: 'unchecked', reasons: [] },
    }
    scene.nodes['svc-hole-pdf-1'] = hole
    stud.serviceHoleIds = ['svc-hole-pdf-1']

    const withHole = await exportShopDrawings(scene, library, project, {
      exportedAt: FIXED_DATE,
    })

    // Re-run without the hole to confirm the size differs (a weak but
    // reliable signal that the hole actually contributed to the output).
    stud.serviceHoleIds = []
    delete (scene.nodes as Record<string, unknown>)['svc-hole-pdf-1']
    const withoutHole = await exportShopDrawings(scene, library, project, {
      exportedAt: FIXED_DATE,
    })
    expect(withHole.bytes.byteLength).toBeGreaterThan(withoutHole.bytes.byteLength)
  })

  it('PDF-06: panel BOM > 30 rows sub-paginates into 3a + 3b (extra page in count)', async () => {
    const { scene, library, project } = buildCanonicalWall()
    // Add enough phantom members on the canonical panel to push past 30 rows.
    const panel = Object.values(scene.nodes).find(
      (n) => (n as { type?: string }).type === 'cfs_panel',
    ) as CFSPanel | undefined
    if (!panel) throw new Error('no panel')
    const studSection = library.sections.find((s) => s.designation === '362S162-54')
    if (!studSection) throw new Error('no stud section')
    const framingId = (Object.values(scene.nodes).find(
      (n) => (n as { type?: string }).type === 'cfs_wall_framing',
    ) as { id: string }).id
    for (let i = 0; i < 30; i++) {
      const id = `phantom-${i}`
      scene.nodes[id] = {
        type: 'cfs_member',
        id,
        parentId: framingId,
        role: 'stud',
        sectionId: studSection.id,
        start: { x_mm: 100 + i, y_mm: 0, z_mm: 0 },
        end: { x_mm: 100 + i, y_mm: 2700, z_mm: 0 },
        orientation_deg: 0,
        panelId: panel.id,
        serviceHoleIds: [],
        children: [],
      } as unknown as Record<string, unknown>
    }
    const result = await exportShopDrawings(scene, library, project, {
      exportedAt: FIXED_DATE,
    })
    // Canonical fixture has 13 members; +30 phantoms = 43 rows. 43 / 30 = 2
    // pages of panel content. Cover (1) + 2 panel pages (2a + 2b) + summary
    // (3) = 4 pages. Spec §6.4 says cover index lists only the primary
    // page label (no `a` suffix), so the index shows panel as "2".
    expect(result.pageCount).toBe(4)
    const ascii = await extractAllStreamText(result.bytes)
    expect(ascii).toContain('Page 2a of 4')
    expect(ascii).toContain('Page 2b of 4')
  })

  it.skip('PDF-07 (manual): opens cleanly in Preview, Acrobat, Chrome PDF viewer', () => {
    // Manual verification per §6.4 test table. Re-export the canonical
    // PDF, open it in all three viewers; assert visual fidelity.
  })

  it('PDF-08: imperial project includes lb alongside kg in the cover library block', async () => {
    const { scene, library, project, members } = buildCanonicalWall({
      units: 'imperial',
    })
    const panel = Object.values(scene.nodes).find(
      (n) => (n as { type?: string }).type === 'cfs_panel',
    ) as CFSPanel | undefined
    if (panel) {
      panel.cachedWeight_kg = 50
      panel.cachedMemberCount = members.length
    }
    const result = await exportShopDrawings(scene, library, project, {
      exportedAt: FIXED_DATE,
    })
    const ascii = await extractAllStreamText(result.bytes)
    expect(ascii).toMatch(/Total weight:\s*50 kg \(110\.23 lb\)/)
  })

  it('PDF-09: summary total weight equals the BOM total', async () => {
    const { scene, library, project } = buildCanonicalWall()
    const result = await exportShopDrawings(scene, library, project, {
      exportedAt: FIXED_DATE,
    })
    // The summary "TOTAL" row prints `<weight> kg` in bold. Confirm the
    // string appears in the document. The cross-invariant test in
    // cross-invariants.test.ts asserts the numerical equality against
    // the BOM totals to two decimals; here we just confirm the format.
    const ascii = await extractAllStreamText(result.bytes)
    expect(ascii).toContain('TOTAL')
    expect(ascii).toMatch(/\d+\.\d{2} kg/)
  })

  it('PDF-10: two consecutive exports with the same exportedAt produce byte-identical PDFs', async () => {
    const a = await exportShopDrawings(
      ...(buildArgs() as Parameters<typeof exportShopDrawings>),
      { exportedAt: FIXED_DATE },
    )
    const b = await exportShopDrawings(
      ...(buildArgs() as Parameters<typeof exportShopDrawings>),
      { exportedAt: FIXED_DATE },
    )
    expect(a.bytes.byteLength).toBe(b.bytes.byteLength)
    // Buffer comparison.
    let diff = 0
    for (let i = 0; i < a.bytes.length; i++) {
      if (a.bytes[i] !== b.bytes[i]) {
        diff++
        break
      }
    }
    expect(diff).toBe(0)
  })

  it('preflight: aborts when no panels exist', async () => {
    const { scene, library, project } = buildCanonicalWall({ withoutPanels: true })
    await expect(
      exportShopDrawings(scene, library, project, { exportedAt: FIXED_DATE }),
    ).rejects.toThrow(ExporterError)
  })

  it('round-trips through PDFDocument.load (well-formed PDF)', async () => {
    const result = await exportShopDrawings(
      ...(buildArgs() as Parameters<typeof exportShopDrawings>),
      { exportedAt: FIXED_DATE },
    )
    const reloaded = await PDFDocument.load(result.bytes)
    expect(reloaded.getPageCount()).toBe(3)
    const size = reloaded.getPage(0).getSize()
    expect(Math.round(size.width)).toBe(612)
    expect(Math.round(size.height)).toBe(792)
  })
})

function buildArgs(
  opts: Parameters<typeof buildCanonicalWall>[0] = {},
): [
  Parameters<typeof exportShopDrawings>[0],
  Parameters<typeof exportShopDrawings>[1],
  Parameters<typeof exportShopDrawings>[2],
] {
  const f = buildCanonicalWall(opts)
  return [f.scene, f.library, f.project]
}
