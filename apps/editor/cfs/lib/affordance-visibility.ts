import { sceneRegistry } from '@pascal-app/core'
import type * as THREE from 'three'

/**
 * Pascal's `CeilingSelectionAffordanceSystem` (in `packages/editor`, read-
 * only upstream) renders a 3D corner-bracket Group per ceiling so the user
 * can click to select it. In CFS mode that bracket shows up as a translucent
 * cube floating over the wall framing — distracting and easy to mis-click.
 *
 * The affordance is a `THREE.Group` rendered into the level Object3D via
 * `createPortal`, positioned at `(0, ceiling.height + 0.035, 0)` — at the
 * level's local origin (x = z = 0) and lifted to the ceiling height. That
 * signature is unique enough to detect by walking each level Object3D's
 * direct children: any Group at (0, y > 1.5, 0) is an affordance.
 *
 * We toggle `visible` (not remove) so Pascal's R3F tree stays intact and
 * the affordance reappears the moment CFS mode is turned off. Visibility
 * is captured per Object3D so a user-hidden ceiling stays hidden when CFS
 * is turned off again.
 */

const cache = new Map<THREE.Object3D, boolean>()

const PLAN_TOL_M = 0.001
const MIN_Y_M = 1.5

function looksLikeCeilingAffordance(child: THREE.Object3D): boolean {
  if (child.type !== 'Group') return false
  if (Math.abs(child.position.x) > PLAN_TOL_M) return false
  if (Math.abs(child.position.z) > PLAN_TOL_M) return false
  if (child.position.y < MIN_Y_M) return false
  return true
}

export function applyCeilingAffordanceVisibility(isCfsModeOn: boolean): void {
  const seen = new Set<THREE.Object3D>()
  for (const levelId of sceneRegistry.byType.level) {
    const levelObj = sceneRegistry.nodes.get(levelId)
    if (!levelObj) continue
    for (const child of levelObj.children) {
      if (!looksLikeCeilingAffordance(child)) continue
      seen.add(child)
      if (isCfsModeOn) {
        if (!cache.has(child)) cache.set(child, child.visible)
        child.visible = false
      } else {
        const prev = cache.get(child)
        if (prev !== undefined) {
          child.visible = prev
          cache.delete(child)
        }
      }
    }
  }
  // Drop entries for affordances that have unmounted (ceiling deleted).
  for (const obj of cache.keys()) {
    if (!seen.has(obj)) cache.delete(obj)
  }
}

export function resetCeilingAffordanceVisibilityCache(): void {
  cache.clear()
}
