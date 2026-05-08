import { describe, expect, it } from 'bun:test'
import { parseLibrary, ssmaLibraryJson, tryParseLibrary } from './load-ssma'

describe('SSMA loader', () => {
  it('parses the shipped ssma.json', () => {
    const lib = parseLibrary(ssmaLibraryJson)
    expect(lib.name).toBe('SSMA')
    expect(lib.sections.length).toBeGreaterThanOrEqual(12)
  })

  it('all section ids are unique', () => {
    const lib = parseLibrary(ssmaLibraryJson)
    const ids = lib.sections.map((s) => s.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('contains the canonical 362S162-54 stud and 362T125-54 track', () => {
    const lib = parseLibrary(ssmaLibraryJson)
    const stud = lib.sections.find((s) => s.designation === '362S162-54')
    const track = lib.sections.find((s) => s.designation === '362T125-54')
    expect(stud).toBeDefined()
    expect(track).toBeDefined()
    expect(stud?.shape).toBe('C')
    expect(track?.shape).toBe('U')
    expect(stud?.linearMass_kgPerM).toBeCloseTo(1.61, 2)
  })

  it('tryParseLibrary returns ok=false on shape mismatch', () => {
    const result = tryParseLibrary({ id: 'not-a-uuid', name: '', version: '', sections: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/.+/)
  })

  it('tryParseLibrary rejects negative dimensions', () => {
    const lib = JSON.parse(JSON.stringify(ssmaLibraryJson)) as {
      sections: { properties: { webDepth_mm: number } }[]
    }
    const first = lib.sections[0]
    if (first) first.properties.webDepth_mm = -1
    const result = tryParseLibrary(lib)
    expect(result.ok).toBe(false)
  })

  it('tryParseLibrary returns ok=true on a valid library', () => {
    const result = tryParseLibrary(ssmaLibraryJson)
    expect(result.ok).toBe(true)
  })
})
