import type { CFSMemberRole } from '@pascal-app/cfs'
import * as THREE from 'three'
import type { WallFrame } from './wall-frame-lookup'

/**
 * Slice 5.2 — per-role orientation for a CFS member's mesh.
 *
 * Background. The geometry built by `extrusion-cache.ts` is in a canonical
 * frame:
 *   - extrusion along local +Z (member axis after rotation)
 *   - cross-section in the local XY plane
 *     - shape X = polygon's z_cs (the "from web back to flange tip" axis)
 *     - shape Y = polygon's y_cs (the web's long-axis direction)
 *
 * Slice 5 used `Quaternion.setFromUnitVectors(0,0,1, axis)` which only
 * fixes one axis (member axis). The about-axis rotation was undefined,
 * so vertical studs ended up with arbitrary flange orientations and
 * top tracks rendered with their U-channel mouth facing sideways or up
 * instead of down. This module replaces that with a role-aware basis
 * that respects the wall's orientation.
 *
 * The CFS installation conventions baked in here (Slice 5.3 correction —
 * verified against the AAC STEEL Light Frames Report PDF for project
 * 8_WINTER, sections WE2001/WE2020/WE2021):
 *   - Vertical members (studs, kings, jambs, chords, cripples):
 *     web's long axis (D, "web depth") points across the wall THICKNESS
 *     (e.g., a 362-series stud reaches 92 mm across the wall depth);
 *     flanges open along the wall LENGTH (B = 41 mm taken per stud).
 *     This is the industry standard — a 600S200 stud in a 200-series
 *     wall has its 152 mm web depth occupying the wall thickness.
 *   - Top track / sill-track: web horizontal on top of the wall,
 *     flanges hang DOWN to receive stud tops.
 *   - Bottom track: web horizontal on the floor, flanges open UP.
 *   - Header / sill: horizontal beam, web vertical (like a stud laid
 *     on its side).
 *
 * Returned matrix has columns = (localX_world, localY_world, localZ_world).
 * The mesh's quaternion is then `Quaternion.setFromRotationMatrix(matrix)`.
 */

const _worldY = new THREE.Vector3(0, 1, 0)
const _worldYDown = new THREE.Vector3(0, -1, 0)
const _localX = new THREE.Vector3()
const _localY = new THREE.Vector3()
const _localZ = new THREE.Vector3()

/**
 * Compose a basis matrix from three unit column vectors. Caller is
 * responsible for ensuring the basis is orthonormal and right-handed
 * (det = +1) — we don't re-orthogonalize.
 */
function basisFromColumns(
  x: THREE.Vector3,
  y: THREE.Vector3,
  z: THREE.Vector3,
  out: THREE.Matrix4,
): THREE.Matrix4 {
  out.set(
    x.x, y.x, z.x, 0,
    x.y, y.y, z.y, 0,
    x.z, y.z, z.z, 0,
    0, 0, 0, 1,
  )
  return out
}

/**
 * Builds the rotation matrix for a member.
 *
 * @param axis        Member axis in world coords (unit vector)
 * @param role        CFSMember.role
 * @param wallFrame   Result of `lookupWallFrame`. May be null when the
 *                    parent wall can't be resolved (mid-edit race) — we
 *                    fall back to a plain axis-only orientation that
 *                    produces a visually-consistent but possibly
 *                    misaligned result.
 * @param out         Pre-allocated Matrix4 to write into (allocation-free).
 */
export function memberOrientationMatrix(
  axis: THREE.Vector3,
  role: CFSMemberRole,
  wallFrame: WallFrame | null,
  out: THREE.Matrix4,
): THREE.Matrix4 {
  // Vertical member roles. Web's long axis (localY in our cross-section
  // frame) points along the wall length. Flanges open toward one wall
  // thickness side.
  const isVertical =
    role === 'stud' ||
    role === 'king-stud' ||
    role === 'jamb-stud' ||
    role === 'chord-stud' ||
    role === 'cripple'

  if (isVertical) {
    _localZ.copy(axis)
    if (wallFrame) {
      // Web's long axis (mesh local Y = polygon's y_cs) maps to the wall
      // NORMAL — the web reaches across the wall thickness. Flanges
      // (mesh local X) then fall along the wall length direction.
      _localY.copy(wallFrame.normal)
      // Re-orthogonalize against axis in case axis isn't perfectly vertical
      // (curved walls, slight float noise).
      _localY.addScaledVector(_localZ, -_localY.dot(_localZ)).normalize()
    } else {
      // No wall frame: just pick something perpendicular to axis. For
      // vertical axis this gives a consistent but arbitrary orientation.
      _localY.copy(_worldY).cross(_localZ)
      if (_localY.lengthSq() < 1e-9) _localY.set(1, 0, 0)
      else _localY.normalize()
    }
    _localX.crossVectors(_localY, _localZ).normalize()
    return basisFromColumns(_localX, _localY, _localZ, out)
  }

  // Horizontal-track family. Flanges DOWN for top-track and sill-track,
  // UP for bottom-track. localX (the cross-section's flange-direction
  // axis) maps directly to the world vertical of the desired flange
  // direction; localY then falls out of the cross product.
  if (role === 'top-track' || role === 'sill-track') {
    _localZ.copy(axis)
    _localX.copy(_worldYDown)
    _localY.crossVectors(_localZ, _localX).normalize()
    return basisFromColumns(_localX, _localY, _localZ, out)
  }
  if (role === 'bottom-track') {
    _localZ.copy(axis)
    _localX.copy(_worldY)
    _localY.crossVectors(_localZ, _localX).normalize()
    return basisFromColumns(_localX, _localY, _localZ, out)
  }

  // Headers and sills: horizontal beam, web vertical (web's long axis is
  // the world vertical). Flanges open in one wall-thickness direction.
  // role === 'header' || role === 'sill'
  _localZ.copy(axis)
  _localY.copy(_worldY)
  _localY.addScaledVector(_localZ, -_localY.dot(_localZ)).normalize()
  _localX.crossVectors(_localY, _localZ).normalize()
  return basisFromColumns(_localX, _localY, _localZ, out)
}

/**
 * Convenience: compute the quaternion directly. Allocates one Matrix4
 * internally — prefer `memberOrientationMatrix` + a shared Quaternion
 * inside hot loops.
 */
export function memberOrientationQuaternion(
  axis: THREE.Vector3,
  role: CFSMemberRole,
  wallFrame: WallFrame | null,
  out: THREE.Quaternion,
): THREE.Quaternion {
  const m = new THREE.Matrix4()
  memberOrientationMatrix(axis, role, wallFrame, m)
  return out.setFromRotationMatrix(m)
}
