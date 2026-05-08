import { describe, expect, it } from 'bun:test'
import { CFSMemberId, CFSPanelId, CFSSectionId } from '../ids'

describe('CFS branded ids', () => {
  it('parses a valid UUID for each brand', () => {
    expect(() => CFSMemberId.parse('44444444-4444-4444-a444-444444444444')).not.toThrow()
    expect(() => CFSPanelId.parse('66666666-6666-4666-a666-666666666666')).not.toThrow()
    expect(() => CFSSectionId.parse('88888888-8888-4888-a888-888888888888')).not.toThrow()
  })

  it('rejects non-UUID strings', () => {
    expect(() => CFSMemberId.parse('mem-001')).toThrow()
    expect(() => CFSSectionId.parse('sec-362S162-54')).toThrow()
  })

  it('parses each brand independently — same UUID accepted by every brand', () => {
    const uuid = '44444444-4444-4444-a444-444444444444'
    expect(() => CFSMemberId.parse(uuid)).not.toThrow()
    expect(() => CFSPanelId.parse(uuid)).not.toThrow()
  })
})
