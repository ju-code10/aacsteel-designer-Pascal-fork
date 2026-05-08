import { describe, expect, it } from 'bun:test'
import * as THREE from 'three'
import { memberOrientationMatrix } from '../member-orientation'
import type { WallFrame } from '../wall-frame-lookup'

const wallAlongX: WallFrame = {
  direction: new THREE.Vector3(1, 0, 0),
  normal: new THREE.Vector3(0, 0, 1), // direction × Y
}

const wallAlongZ: WallFrame = {
  direction: new THREE.Vector3(0, 0, 1),
  normal: new THREE.Vector3(-1, 0, 0),
}

function basisColumns(m: THREE.Matrix4): {
  x: THREE.Vector3
  y: THREE.Vector3
  z: THREE.Vector3
} {
  const e = m.elements
  return {
    x: new THREE.Vector3(e[0], e[1], e[2]),
    y: new THREE.Vector3(e[4], e[5], e[6]),
    z: new THREE.Vector3(e[8], e[9], e[10]),
  }
}

function isUnit(v: THREE.Vector3): boolean {
  return Math.abs(v.length() - 1) < 1e-6
}

function isOrthonormal(m: THREE.Matrix4): boolean {
  const { x, y, z } = basisColumns(m)
  if (!(isUnit(x) && isUnit(y) && isUnit(z))) return false
  if (Math.abs(x.dot(y)) > 1e-6) return false
  if (Math.abs(y.dot(z)) > 1e-6) return false
  if (Math.abs(z.dot(x)) > 1e-6) return false
  // Right-handed: x × y = z
  const cross = new THREE.Vector3().crossVectors(x, y)
  return cross.distanceTo(z) < 1e-6
}

describe('memberOrientationMatrix — vertical members', () => {
  it('vertical stud in a wall along X: web depth (D) aligns with wall thickness, flanges along wall length', () => {
    const out = new THREE.Matrix4()
    memberOrientationMatrix(new THREE.Vector3(0, 1, 0), 'stud', wallAlongX, out)
    expect(isOrthonormal(out)).toBe(true)
    const { x, y, z } = basisColumns(out)
    // localZ (extrusion axis) = +Y
    expect(z.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-6)
    // localY (web's long axis = D dimension) = wall normal = +Z (wall thickness)
    expect(y.distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(1e-6)
    // localX (flange direction = B dimension) along wall length = -X
    // (sign comes from localY × localZ for the right-handed basis;
    //  the absolute direction within the wall plane is what matters,
    //  consistent across all studs in a wall)
    expect(x.distanceTo(new THREE.Vector3(-1, 0, 0))).toBeLessThan(1e-6)
  })

  it('vertical stud in a wall along Z: cross-section orients to that wall', () => {
    const out = new THREE.Matrix4()
    memberOrientationMatrix(new THREE.Vector3(0, 1, 0), 'stud', wallAlongZ, out)
    expect(isOrthonormal(out)).toBe(true)
    const { y } = basisColumns(out)
    // localY = wall normal for wallAlongZ = (-1, 0, 0)
    expect(y.distanceTo(new THREE.Vector3(-1, 0, 0))).toBeLessThan(1e-6)
  })

  it('king/jamb/chord/cripple all share the vertical-stud orientation', () => {
    for (const role of ['king-stud', 'jamb-stud', 'chord-stud', 'cripple'] as const) {
      const out = new THREE.Matrix4()
      memberOrientationMatrix(new THREE.Vector3(0, 1, 0), role, wallAlongX, out)
      expect(isOrthonormal(out)).toBe(true)
      const { y } = basisColumns(out)
      // localY = wall normal (web in wall thickness)
      expect(y.distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(1e-6)
    }
  })

  it('without a wall frame, vertical members still produce a valid orientation (fallback)', () => {
    const out = new THREE.Matrix4()
    memberOrientationMatrix(new THREE.Vector3(0, 1, 0), 'stud', null, out)
    expect(isOrthonormal(out)).toBe(true)
  })
})

describe('memberOrientationMatrix — tracks', () => {
  it('top-track flanges point DOWN (localX = -Y in world)', () => {
    const out = new THREE.Matrix4()
    memberOrientationMatrix(new THREE.Vector3(1, 0, 0), 'top-track', wallAlongX, out)
    expect(isOrthonormal(out)).toBe(true)
    const { x } = basisColumns(out)
    // localX is the cross-section's flange-direction axis. For a top track
    // the flanges open downward, so localX_world should be -Y.
    expect(x.distanceTo(new THREE.Vector3(0, -1, 0))).toBeLessThan(1e-6)
  })

  it('bottom-track flanges point UP (localX = +Y in world)', () => {
    const out = new THREE.Matrix4()
    memberOrientationMatrix(new THREE.Vector3(1, 0, 0), 'bottom-track', wallAlongX, out)
    expect(isOrthonormal(out)).toBe(true)
    const { x } = basisColumns(out)
    expect(x.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-6)
  })

  it('sill-track flanges point DOWN like top-track', () => {
    const out = new THREE.Matrix4()
    memberOrientationMatrix(new THREE.Vector3(1, 0, 0), 'sill-track', wallAlongX, out)
    expect(isOrthonormal(out)).toBe(true)
    const { x } = basisColumns(out)
    expect(x.distanceTo(new THREE.Vector3(0, -1, 0))).toBeLessThan(1e-6)
  })

  it('top-track on a Z-axis wall keeps flanges DOWN (the rotation respects the wall direction)', () => {
    const out = new THREE.Matrix4()
    memberOrientationMatrix(new THREE.Vector3(0, 0, 1), 'top-track', wallAlongZ, out)
    expect(isOrthonormal(out)).toBe(true)
    const { x } = basisColumns(out)
    expect(x.distanceTo(new THREE.Vector3(0, -1, 0))).toBeLessThan(1e-6)
  })
})

describe('memberOrientationMatrix — headers and sills', () => {
  it('header is a horizontal beam with web vertical (localY = +Y)', () => {
    const out = new THREE.Matrix4()
    memberOrientationMatrix(new THREE.Vector3(1, 0, 0), 'header', wallAlongX, out)
    expect(isOrthonormal(out)).toBe(true)
    const { y } = basisColumns(out)
    expect(y.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-6)
  })

  it('sill is a horizontal beam with web vertical (same as header)', () => {
    const out = new THREE.Matrix4()
    memberOrientationMatrix(new THREE.Vector3(1, 0, 0), 'sill', wallAlongX, out)
    expect(isOrthonormal(out)).toBe(true)
    const { y } = basisColumns(out)
    expect(y.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-6)
  })
})

describe('memberOrientationMatrix — every role yields a right-handed orthonormal basis', () => {
  const roles = [
    'top-track',
    'bottom-track',
    'stud',
    'chord-stud',
    'king-stud',
    'jamb-stud',
    'header',
    'sill',
    'sill-track',
    'cripple',
  ] as const
  it.each(roles.map((r) => [r]))('role=%s produces a valid SO(3) basis', (role) => {
    const axis = role.includes('track') || role === 'header' || role === 'sill'
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0)
    const out = new THREE.Matrix4()
    memberOrientationMatrix(axis, role, wallAlongX, out)
    expect(isOrthonormal(out)).toBe(true)
  })
})
