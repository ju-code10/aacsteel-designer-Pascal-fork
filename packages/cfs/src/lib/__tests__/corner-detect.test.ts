import { describe, expect, it } from 'bun:test'
import { isCornerOwned } from '../corner-detect'

describe('corner-detect', () => {
  it('framing with no peers always owns its chord', () => {
    expect(isCornerOwned('a', { x_mm: 0, z_mm: 0 }, [])).toBe(true)
  })

  it('two framings sharing a corner: lexicographically smaller id wins', () => {
    const peer = { framingId: 'b', position: { x_mm: 0, z_mm: 0 } }
    expect(isCornerOwned('a', { x_mm: 0, z_mm: 0 }, [peer])).toBe(true)
    expect(isCornerOwned('b', { x_mm: 0, z_mm: 0 }, [{ framingId: 'a', position: { x_mm: 0, z_mm: 0 } }])).toBe(false)
  })

  it('peer at a different position does not affect ownership', () => {
    const peer = { framingId: 'a', position: { x_mm: 5000, z_mm: 0 } }
    expect(isCornerOwned('z', { x_mm: 0, z_mm: 0 }, [peer])).toBe(true)
  })

  it('coincidence is checked within 1 mm tolerance', () => {
    const peer = { framingId: 'a', position: { x_mm: 0.4, z_mm: 0 } }
    expect(isCornerOwned('z', { x_mm: 0, z_mm: 0 }, [peer])).toBe(false)
  })

  it('three-way intersection picks the smallest of the three', () => {
    const peers = [
      { framingId: 'b', position: { x_mm: 0, z_mm: 0 } },
      { framingId: 'c', position: { x_mm: 0, z_mm: 0 } },
    ]
    expect(isCornerOwned('a', { x_mm: 0, z_mm: 0 }, peers)).toBe(true)
    expect(isCornerOwned('b', { x_mm: 0, z_mm: 0 }, [
      { framingId: 'a', position: { x_mm: 0, z_mm: 0 } },
      { framingId: 'c', position: { x_mm: 0, z_mm: 0 } },
    ])).toBe(false)
  })
})
