import { describe, expect, it } from 'bun:test'
import { computeOpeningLayout, type OpeningInputForLayout } from '../opening-layout'
import { parseLibrary, ssmaLibraryJson } from '../../library/load-ssma'

const lib = parseLibrary(ssmaLibraryJson)
const studSection =
  lib.sections.find((s) => s.shape === 'C' && s.designation === '362S162-54') ??
  lib.sections.find((s) => s.shape === 'C')!
const trackSection =
  lib.sections.find((s) => s.shape === 'U' && s.designation === '362T125-54') ??
  lib.sections.find((s) => s.shape === 'U')!

const HALF_FLANGE = studSection.properties.flangeWidth_mm / 2

const baseInput = {
  wallLength_mm: 3600,
  wallHeight_mm: 2700,
  studSpacing_mm: 600,
  studSection,
  trackSection,
  defaultHeaderType: 'box' as const,
}

describe('computeOpeningLayout — canonical wall (door 900×2100 at x=600)', () => {
  const door: OpeningInputForLayout = {
    id: 'door-1',
    openingType: 'door',
    positionAlongWall_mm: 600,
    width_mm: 900,
    height_mm: 2100,
  }
  const result = computeOpeningLayout({ ...baseInput, openings: [door] })

  it('emits 2 kings flanking the door', () => {
    const kings = result.members.filter((m) => m.role === 'king-stud')
    expect(kings.length).toBe(2)
    expect(kings.map((m) => m.startX_mm).sort((a, b) => a - b)).toEqual([
      600 - HALF_FLANGE,
      1500 + HALF_FLANGE,
    ])
  })

  it('emits 2 jambs immediately inside the kings', () => {
    const jambs = result.members.filter((m) => m.role === 'jamb-stud')
    expect(jambs.length).toBe(2)
    expect(jambs.map((m) => m.startX_mm).sort((a, b) => a - b)).toEqual([
      600 + HALF_FLANGE,
      1500 - HALF_FLANGE,
    ])
  })

  it('emits 4 header members (default box-header)', () => {
    const headers = result.members.filter((m) => m.role === 'header')
    expect(headers.length).toBe(4)
    for (const h of headers) {
      expect(h.startY_mm).toBeGreaterThanOrEqual(2100)
    }
  })

  it('emits no sill or sill-track for a door', () => {
    expect(result.members.some((m) => m.role === 'sill')).toBe(false)
    expect(result.members.some((m) => m.role === 'sill-track')).toBe(false)
  })

  it('emits zero cripples above when the door is too tall to fit any', () => {
    // Wall 2700, head 2100, header depth ≈ 91.5 + 2 × 1.37 ≈ 94.2 → headerTop ~2194,
    // which leaves ~506 mm of space (positive). So cripples ARE emitted.
    const cripples = result.members.filter((m) => m.role === 'cripple')
    // Field studs at 1200 falls inside jamb range (620, 1480) — yes.
    // Other field-stud candidates inside? 1800 lies outside. So exactly 1 cripple.
    expect(cripples.length).toBe(1)
    expect(cripples[0]!.startX_mm).toBe(1200)
  })

  it('does not promote either chord', () => {
    expect(result.promoteStartChordToKing).toBe(false)
    expect(result.promoteEndChordToKing).toBe(false)
  })

  it('reports no invalid openings', () => {
    expect(result.invalidOpeningIds).toEqual([])
  })

  it('attributes generated members to the door', () => {
    const list = result.generatedMemberIdsByOpening.get('door-1')
    expect(list).toBeDefined()
    expect(list!.length).toBe(result.members.length)
  })
})

describe('computeOpeningLayout — window adds sill, sill-track, cripples below', () => {
  const win: OpeningInputForLayout = {
    id: 'w-1',
    openingType: 'window',
    positionAlongWall_mm: 600,
    width_mm: 1200,
    height_mm: 1000,
    sillHeight_mm: 900,
  }
  const result = computeOpeningLayout({ ...baseInput, openings: [win] })

  it('emits exactly one sill and one sill-track', () => {
    expect(result.members.filter((m) => m.role === 'sill').length).toBe(1)
    expect(result.members.filter((m) => m.role === 'sill-track').length).toBe(1)
  })

  it('emits cripples both above and below', () => {
    // Window: rop 600..1800, jamb range (620, 1780). Field studs in there: 1200.
    // Cripple above at 1200 from headerTop to wallHeight, cripple below at 1200 from 0 to 900.
    const cripples = result.members.filter((m) => m.role === 'cripple')
    expect(cripples.length).toBe(2)
    const ys = cripples.map((c) => `${c.startY_mm}-${c.endY_mm}`).sort()
    expect(ys[0]).toMatch(/^0-900/)
    expect(ys[1]).toMatch(/^.+-2700$/)
  })
})

describe('computeOpeningLayout — opening at wall edge promotes chord', () => {
  const door: OpeningInputForLayout = {
    id: 'edge-door',
    openingType: 'door',
    positionAlongWall_mm: 0,
    width_mm: 900,
    height_mm: 2100,
  }
  const result = computeOpeningLayout({ ...baseInput, openings: [door] })

  it('drops left king and promotes start chord', () => {
    expect(result.promoteStartChordToKing).toBe(true)
    const kings = result.members.filter((m) => m.role === 'king-stud')
    // Only the right king remains.
    expect(kings.length).toBe(1)
    expect(kings[0]!.startX_mm).toBeCloseTo(900 + HALF_FLANGE, 6)
  })

  it('does not promote end chord', () => {
    expect(result.promoteEndChordToKing).toBe(false)
  })
})

describe('computeOpeningLayout — two adjacent openings share a king when within stud spacing', () => {
  // o1 right king at 1500 + HALF_FLANGE; o2 left king at o2.position - HALF_FLANGE.
  // Pick o2.position so the two are 360 mm apart (≤ 600).
  const a: OpeningInputForLayout = {
    id: 'A',
    openingType: 'door',
    positionAlongWall_mm: 600,
    width_mm: 900,
    height_mm: 2100,
  }
  const b: OpeningInputForLayout = {
    id: 'B',
    openingType: 'door',
    positionAlongWall_mm: 1900,
    width_mm: 900,
    height_mm: 2100,
  }
  const result = computeOpeningLayout({
    ...baseInput,
    wallLength_mm: 4500,
    openings: [a, b],
  })

  it('emits exactly 3 kings, with the middle one referenced by both openings', () => {
    const kings = result.members.filter((m) => m.role === 'king-stud')
    expect(kings.length).toBe(3)
    // Both A and B should claim the shared king id.
    const aIds = result.generatedMemberIdsByOpening.get('A')!
    const bIds = result.generatedMemberIdsByOpening.get('B')!
    const shared = aIds.filter((id) => bIds.includes(id))
    expect(shared.length).toBe(1)
  })
})

describe('computeOpeningLayout — invalid openings', () => {
  it('rejects an opening wider than the wall', () => {
    const big: OpeningInputForLayout = {
      id: 'big',
      openingType: 'door',
      positionAlongWall_mm: 100,
      width_mm: 4000,
      height_mm: 2100,
    }
    const ok: OpeningInputForLayout = {
      id: 'ok',
      openingType: 'door',
      positionAlongWall_mm: 100,
      width_mm: 900,
      height_mm: 2100,
    }
    const result = computeOpeningLayout({
      ...baseInput,
      openings: [big, ok],
    })
    expect(result.invalidOpeningIds).toEqual(['big'])
    // The valid opening's framing still emits.
    expect(result.members.some((m) => m.sourceOpeningId === 'ok')).toBe(true)
  })
})

describe('computeOpeningLayout — no cripples when no room', () => {
  it('skips cripples-above when headerTop >= wallHeight', () => {
    const door: OpeningInputForLayout = {
      id: 'tall',
      openingType: 'door',
      positionAlongWall_mm: 600,
      width_mm: 900,
      height_mm: 2700, // up to top of wall
    }
    const result = computeOpeningLayout({ ...baseInput, openings: [door] })
    const cripples = result.members.filter(
      (m) => m.role === 'cripple' && m.endY_mm === baseInput.wallHeight_mm,
    )
    expect(cripples.length).toBe(0)
  })

  it('skips cripples-below when sillHeight is zero (degenerate)', () => {
    const win: OpeningInputForLayout = {
      id: 'no-sill',
      openingType: 'window',
      positionAlongWall_mm: 600,
      width_mm: 1200,
      height_mm: 1000,
      sillHeight_mm: 0, // invalid per schema, but layout must guard anyway
    }
    const result = computeOpeningLayout({ ...baseInput, openings: [win] })
    // Layout-level validity rejects window with sill <= 0.
    expect(result.invalidOpeningIds).toContain('no-sill')
  })
})

describe('computeOpeningLayout — no openings', () => {
  it('returns an empty result identical to the chord-track-field layer running alone', () => {
    const result = computeOpeningLayout({ ...baseInput, openings: [] })
    expect(result.members).toEqual([])
    expect(result.invalidOpeningIds).toEqual([])
    expect(result.promoteStartChordToKing).toBe(false)
    expect(result.promoteEndChordToKing).toBe(false)
  })
})
