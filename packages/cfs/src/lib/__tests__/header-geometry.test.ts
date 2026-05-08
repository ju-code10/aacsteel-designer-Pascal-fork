import { describe, expect, it } from 'bun:test'
import { computeHeaderGeometry } from '../header-geometry'
import { parseLibrary, ssmaLibraryJson } from '../../library/load-ssma'

const lib = parseLibrary(ssmaLibraryJson)
const studSection =
  lib.sections.find((s) => s.shape === 'C' && s.designation === '362S162-54') ??
  lib.sections.find((s) => s.shape === 'C')!
const trackSection =
  lib.sections.find((s) => s.shape === 'U' && s.designation === '362T125-54') ??
  lib.sections.find((s) => s.shape === 'U')!

const baseInput = {
  studSection,
  trackSection,
  jambLeftX_mm: 600,
  jambRightX_mm: 1500,
  headHeight_mm: 2100,
}

describe('computeHeaderGeometry — member counts per type', () => {
  it('box → 4 members (2 C + 2 track caps)', () => {
    const geom = computeHeaderGeometry({ ...baseInput, type: 'box' })
    expect(geom.members.length).toBe(4)
    const cs = geom.members.filter((m) => m.sectionId === studSection.id)
    const ts = geom.members.filter((m) => m.sectionId === trackSection.id)
    expect(cs.length).toBe(2)
    expect(ts.length).toBe(2)
  })

  it('L-header → 2 members (1 C + 1 track)', () => {
    const geom = computeHeaderGeometry({ ...baseInput, type: 'L-header' })
    expect(geom.members.length).toBe(2)
    expect(geom.members.find((m) => m.sectionId === studSection.id)).toBeDefined()
    expect(geom.members.find((m) => m.sectionId === trackSection.id)).toBeDefined()
  })

  it('back-to-back → 2 members (both C)', () => {
    const geom = computeHeaderGeometry({ ...baseInput, type: 'back-to-back' })
    expect(geom.members.length).toBe(2)
    expect(geom.members.every((m) => m.sectionId === studSection.id)).toBe(true)
  })

  it('single-track → 1 member, always track section', () => {
    const geom = computeHeaderGeometry({ ...baseInput, type: 'single-track' })
    expect(geom.members.length).toBe(1)
    expect(geom.members[0]!.sectionId).toBe(trackSection.id)
  })

  it('proprietary → 1 placeholder member', () => {
    const geom = computeHeaderGeometry({ ...baseInput, type: 'proprietary' })
    expect(geom.members.length).toBe(1)
  })
})

describe('computeHeaderGeometry — span endpoints', () => {
  it('every member spans exactly the jamb x range for every type', () => {
    const types = ['box', 'L-header', 'back-to-back', 'single-track', 'proprietary'] as const
    for (const type of types) {
      const geom = computeHeaderGeometry({ ...baseInput, type })
      for (const m of geom.members) {
        expect(m.startX_mm).toBe(baseInput.jambLeftX_mm)
        expect(m.endX_mm).toBe(baseInput.jambRightX_mm)
      }
    }
  })
})

describe('computeHeaderGeometry — depth', () => {
  it('box depth = stud webDepth + 2 × stud thickness', () => {
    const geom = computeHeaderGeometry({ ...baseInput, type: 'box' })
    const expected =
      studSection.properties.webDepth_mm + 2 * studSection.properties.thickness_mm
    expect(geom.depth_mm).toBeCloseTo(expected, 6)
  })

  it('L-header / back-to-back / proprietary depth = stud webDepth', () => {
    for (const type of ['L-header', 'back-to-back', 'proprietary'] as const) {
      const geom = computeHeaderGeometry({ ...baseInput, type })
      expect(geom.depth_mm).toBeCloseTo(studSection.properties.webDepth_mm, 6)
    }
  })

  it('single-track depth = track webDepth', () => {
    const geom = computeHeaderGeometry({ ...baseInput, type: 'single-track' })
    expect(geom.depth_mm).toBeCloseTo(trackSection.properties.webDepth_mm, 6)
  })
})

describe('computeHeaderGeometry — single-track section override', () => {
  it('returns track section even when called with a different stud', () => {
    const otherStud =
      lib.sections.find((s) => s.shape === 'C' && s.designation !== '362S162-54') ??
      lib.sections[0]!
    const geom = computeHeaderGeometry({
      ...baseInput,
      studSection: otherStud as typeof studSection,
      type: 'single-track',
    })
    expect(geom.members[0]!.sectionId).toBe(trackSection.id)
  })
})
