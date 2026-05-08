import type { CFSMember } from '@pascal-app/cfs'
import { useScene } from '@pascal-app/core'
import * as THREE from 'three'

/**
 * Slice 5.2 — given a CFS member, walk up to the parent Pascal wall and
 * return its **horizontal direction** and **horizontal normal** in world
 * coordinates. These two unit vectors fully specify the wall's orientation
 * in the world XZ plane and are what the geometry pass needs to compute
 * role-aware member orientation (so top-track flanges point DOWN, stud
 * webs face the wall surface, etc.).
 *
 * Walk: `member.parentId` (CFSWallFraming id) → framing → `framing.parentId`
 * (Pascal wall id) → wall → wall.start, wall.end (each `[x_m, z_m]` in the
 * world horizontal plane per Pascal convention; world Y is up).
 *
 * Returns null when the chain cannot be resolved (deleted parent, scene
 * mid-mutation). Caller falls back to the plain `setFromUnitVectors`
 * orientation when null is returned, which produces a visually consistent
 * but possibly wrong-way-around result.
 */

export interface WallFrame {
  /** Unit vector in world XZ pointing along the wall length. */
  direction: THREE.Vector3
  /** Unit vector in world XZ perpendicular to direction (wall thickness side). */
  normal: THREE.Vector3
}

const _worldY = new THREE.Vector3(0, 1, 0)

/**
 * Resolves the parent Pascal wall for a CFS member. Returns null when the
 * member's framing or wall can't be found in the scene (mid-edit race,
 * deleted parent).
 */
export function lookupWallFrame(member: CFSMember): WallFrame | null {
  const nodes = useScene.getState().nodes
  const framing = nodes[member.parentId as never] as
    | { parentId?: string }
    | undefined
  if (!framing?.parentId) return null
  const wall = nodes[framing.parentId as never] as
    | { type?: string; start?: readonly [number, number]; end?: readonly [number, number] }
    | undefined
  if (!wall || wall.type !== 'wall' || !wall.start || !wall.end) return null

  // Pascal wall.start / wall.end are `[x_m, z_m]` (world horizontal plane).
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const len = Math.hypot(dx, dz)
  if (len < 1e-9) return null

  const direction = new THREE.Vector3(dx / len, 0, dz / len)
  // Horizontal normal: rotate direction 90° about world Y. For direction
  // (dx, 0, dz), the perpendicular in horizontal plane is (-dz, 0, dx)
  // or (dz, 0, -dx). We use direction × Y so the basis is right-handed
  // when paired with a vertical member axis.
  const normal = new THREE.Vector3().crossVectors(direction, _worldY).normalize()
  return { direction, normal }
}
