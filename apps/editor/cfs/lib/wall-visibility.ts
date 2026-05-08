import { sceneRegistry } from '@pascal-app/core'
import type * as THREE from 'three'

/**
 * Slice 5.2 — when CFS mode is on, hide Pascal wall meshes so the user can
 * inspect the CFS framing underneath. Industry-standard CFS detailing
 * tools (Tekla, Autodesk Advance) do the same: the architectural surface
 * is suppressed so the structural members are unobstructed.
 *
 * We hide ONLY Pascal wall meshes (`sceneRegistry.byType.wall`). Doors and
 * windows are children of walls in Three.js's scene graph, so hiding the
 * wall hides them automatically. Slabs and ceilings are kept visible as
 * floor/ground reference.
 *
 * Lifecycle:
 *   - Original visibility is captured per node id in `originalVisibility`,
 *     so toggling CFS mode off restores the user's visibility settings
 *     even if they had manually hidden a wall.
 *   - Walls registered AFTER CFS mode is on still need to be hidden —
 *     callers (`CFSRoot`) re-run `applyWallVisibility` on every relevant
 *     scene change.
 *   - On scene reset (`sceneRegistry.clear()`) the registry is empty and
 *     the cache is invalidated; future walls get fresh original-visibility
 *     captures.
 */

const originalVisibility = new Map<string, boolean>()
let lastCfsModeOn: boolean | null = null

/**
 * Apply visibility to every Pascal wall mesh based on the current CFS mode.
 * Idempotent. Cheap when nothing changed.
 */
export function applyWallVisibility(isCfsModeOn: boolean): void {
  // Walls that have left the registry since the last call should drop
  // their cached visibility.
  if (originalVisibility.size > 0) {
    for (const id of originalVisibility.keys()) {
      if (!sceneRegistry.nodes.has(id)) originalVisibility.delete(id)
    }
  }

  for (const id of sceneRegistry.byType.wall) {
    const obj = sceneRegistry.nodes.get(id) as THREE.Object3D | undefined
    if (!obj) continue

    if (isCfsModeOn) {
      if (!originalVisibility.has(id)) {
        originalVisibility.set(id, obj.visible)
      }
      obj.visible = false
    } else {
      const prev = originalVisibility.get(id)
      if (prev !== undefined) {
        obj.visible = prev
        originalVisibility.delete(id)
      }
    }
  }
  lastCfsModeOn = isCfsModeOn
}

/**
 * Force the cache to drop its state. Call on scene reset / sign-out so the
 * next mode-toggle re-captures from a fresh baseline.
 */
export function resetWallVisibilityCache(): void {
  originalVisibility.clear()
  lastCfsModeOn = null
}

/** Test-only inspector. */
export function _wallVisibilityCacheSize(): number {
  return originalVisibility.size
}
export function _lastAppliedMode(): boolean | null {
  return lastCfsModeOn
}
