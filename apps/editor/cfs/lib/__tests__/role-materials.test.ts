import { afterEach, describe, expect, it } from 'bun:test'
import {
  _roleMaterialCacheSize,
  disposeRoleMaterials,
  getRoleMaterial,
  roleColorHex,
} from '../role-materials'

afterEach(() => {
  disposeRoleMaterials()
})

describe('getRoleMaterial', () => {
  it('returns the same material instance for the same role (caching)', () => {
    const a = getRoleMaterial('stud')
    const b = getRoleMaterial('stud')
    expect(a).toBe(b)
    expect(_roleMaterialCacheSize()).toBe(1)
  })

  it('returns different material instances for different roles', () => {
    const stud = getRoleMaterial('stud')
    const header = getRoleMaterial('header')
    expect(stud).not.toBe(header)
    expect(stud.color.getHex()).not.toBe(header.color.getHex())
    expect(_roleMaterialCacheSize()).toBe(2)
  })

  it('uses metallic=0.9 and roughness=0.6 per §5.3', () => {
    const m = getRoleMaterial('stud')
    expect(m.metalness).toBe(0.9)
    expect(m.roughness).toBe(0.6)
  })

  it('top-track and bottom-track share the same gray color (both are tracks)', () => {
    expect(roleColorHex('top-track')).toBe(roleColorHex('bottom-track'))
  })

  it('header, sill, and sill-track share the same red (per §6.3 layer scheme)', () => {
    expect(roleColorHex('header')).toBe(roleColorHex('sill'))
    expect(roleColorHex('header')).toBe(roleColorHex('sill-track'))
  })

  it('chord-stud is darker than field stud (matches §1.2 "end studs dark blue")', () => {
    // We approximate "darker" via lower combined RGB intensity.
    const intensity = (hex: number) => ((hex >> 16) & 0xff) + ((hex >> 8) & 0xff) + (hex & 0xff)
    expect(intensity(roleColorHex('chord-stud'))).toBeLessThan(intensity(roleColorHex('stud')))
  })

  it('disposeRoleMaterials clears the cache so the next call rebuilds', () => {
    const before = getRoleMaterial('header')
    disposeRoleMaterials()
    expect(_roleMaterialCacheSize()).toBe(0)
    const after = getRoleMaterial('header')
    expect(after).not.toBe(before)
  })
})
