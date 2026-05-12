import { describe, expect, it } from 'bun:test'
import { localToWorld, wallHeightFromPascalWall, wallLengthFromPascalWall } from '../wall-frame'

describe('wall-frame', () => {
  it('wallLengthFromPascalWall converts metres to mm via 2D distance', () => {
    expect(wallLengthFromPascalWall({ id: 'w', start: [0, 0], end: [3.6, 0] })).toBeCloseTo(3600, 6)
    expect(wallLengthFromPascalWall({ id: 'w', start: [0, 0], end: [3, 4] })).toBeCloseTo(5000, 6)
  })

  it('wallHeightFromPascalWall returns mm or null when missing', () => {
    expect(wallHeightFromPascalWall({ id: 'w', start: [0, 0], end: [1, 0], height: 2.7 })).toBe(2700)
    expect(wallHeightFromPascalWall({ id: 'w', start: [0, 0], end: [1, 0] })).toBeNull()
  })

  it('localToWorld places (0,0,0) at the wall start', () => {
    const w = { id: 'w', start: [1, 2] as const, end: [4, 6] as const }
    const p = localToWorld(w, { x_mm: 0, y_mm: 0, z_mm: 0 })
    expect(p).toEqual({ x_mm: 1000, y_mm: 0, z_mm: 2000 })
  })

  it('localToWorld places (length,0,0) at the wall end', () => {
    const w = { id: 'w', start: [0, 0] as const, end: [3, 4] as const }
    const len = wallLengthFromPascalWall(w)
    const p = localToWorld(w, { x_mm: len, y_mm: 0, z_mm: 0 })
    expect(p.x_mm).toBeCloseTo(3000, 6)
    expect(p.z_mm).toBeCloseTo(4000, 6)
  })

  it('localToWorld respects the y-axis vertical', () => {
    const w = { id: 'w', start: [0, 0] as const, end: [1, 0] as const }
    const p = localToWorld(w, { x_mm: 500, y_mm: 2700, z_mm: 0 })
    expect(p.y_mm).toBe(2700)
  })

  it('localToWorld z offset is perpendicular to the wall in level plane', () => {
    const w = { id: 'w', start: [0, 0] as const, end: [1, 0] as const }
    const p = localToWorld(w, { x_mm: 0, y_mm: 0, z_mm: 100 })
    expect(p.x_mm).toBeCloseTo(0, 6)
    expect(p.z_mm).toBeCloseTo(100, 6)
  })

  it('localToWorld handles zero-length walls without NaN', () => {
    const w = { id: 'w', start: [1, 2] as const, end: [1, 2] as const }
    const p = localToWorld(w, { x_mm: 0, y_mm: 1000, z_mm: 0 })
    expect(p).toEqual({ x_mm: 1000, y_mm: 1000, z_mm: 2000 })
  })

  it('localToWorld lifts y by levelElevation_mm when supplied (multi-story fix)', () => {
    const w = { id: 'w', start: [0, 0] as const, end: [3, 0] as const }
    const ground = localToWorld(w, { x_mm: 0, y_mm: 0, z_mm: 0 })
    const upper = localToWorld(w, { x_mm: 0, y_mm: 0, z_mm: 0 }, 3000)
    expect(ground.y_mm).toBe(0)
    expect(upper.y_mm).toBe(3000)
    // x and z stay anchored to the wall's level-local frame.
    expect(upper.x_mm).toBe(ground.x_mm)
    expect(upper.z_mm).toBe(ground.z_mm)
  })

  it('localToWorld stacks elevation onto wall-local y', () => {
    const w = { id: 'w', start: [0, 0] as const, end: [3, 0] as const }
    const headOfUpperWall = localToWorld(
      w,
      { x_mm: 0, y_mm: 2700, z_mm: 0 },
      3000,
    )
    expect(headOfUpperWall.y_mm).toBe(5700)
  })

  it('localToWorld zero-length variant also adds elevation', () => {
    const w = { id: 'w', start: [1, 2] as const, end: [1, 2] as const }
    const p = localToWorld(w, { x_mm: 0, y_mm: 500, z_mm: 0 }, 2700)
    expect(p.y_mm).toBe(3200)
  })
})
