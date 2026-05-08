import { sceneRegistry } from '@pascal-app/core'
import * as THREE from 'three'

/**
 * Bridge from outside Pascal's R3F Canvas tree into Pascal's THREE.Scene.
 *
 * Why this exists: per [§0.3](docs/PROJECT_SPEC.md#03) the upstream Pascal
 * packages are read-only, and `<Editor>` exposes no Canvas-children slot
 * (verified in `packages/editor/src/components/editor/index.tsx` —
 * `<Viewer>` is rendered with a hardcoded `<ViewerSceneContent>` child).
 * We therefore can't mount a CFS renderer/system as a React child of the
 * Canvas. Instead, we attach Three.js objects to Pascal's scene
 * imperatively, by reaching into the scene through `sceneRegistry`.
 *
 * How: every Pascal node that is rendered on screen registers its
 * `Object3D` in `sceneRegistry.nodes` via the `useRegistry` hook
 * (packages/core/src/hooks/scene-registry/scene-registry.ts). Every such
 * Object3D's `.parent` chain leads up to the Canvas's THREE.Scene root.
 * We pick any registered object, walk up to the Scene, and `scene.add(...)`
 * our group.
 *
 * Lifecycle / robustness:
 *  - On first call, the scene may not yet exist (initial app load before
 *    any Pascal node has rendered). The function returns null in that case;
 *    the caller should retry on the next dirty pass.
 *  - Pascal's `editor/lib/scene.ts` calls `sceneRegistry.clear()` on scene
 *    reset. After a clear, our group is orphaned (its `.parent` is set to
 *    null by the previous `remove()` call, but only if Pascal explicitly
 *    removed; in practice the parent stays set but the parent's geometry
 *    has been disposed). The caller can detect orphaning by checking
 *    `cfsGroup.parent` and re-attach by calling `attachToPascalScene`
 *    again.
 *
 * This is the lowest-coupling escape hatch we can ship without modifying
 * upstream Pascal. The cleaner long-term answer is a small upstream PR
 * adding a `viewerCanvasChildren` prop to `<Editor>`; recorded for v2.
 */

const CFS_GROUP_NAME = 'cfs-root-group'

/**
 * Walks up an Object3D's parent chain to find the THREE.Scene root.
 * Returns null if the object isn't yet in the scene graph.
 */
function findScene(obj: THREE.Object3D): THREE.Scene | null {
  let cur: THREE.Object3D | null = obj
  while (cur) {
    if ((cur as THREE.Scene).isScene) return cur as THREE.Scene
    cur = cur.parent
  }
  return null
}

/**
 * Returns Pascal's THREE.Scene, or null if no Pascal node has registered yet.
 *
 * Iterates `sceneRegistry.nodes` until it finds an entry whose parent chain
 * leads to a Scene. Iteration stops at the first hit. Cached internally
 * across calls — once we've found the scene, we keep the reference unless
 * the scene goes away (then re-resolve on next call).
 */
let cachedScene: THREE.Scene | null = null

export function getPascalScene(): THREE.Scene | null {
  if (cachedScene && (cachedScene as { isScene?: boolean }).isScene) {
    return cachedScene
  }
  cachedScene = null
  for (const obj of sceneRegistry.nodes.values()) {
    const scene = findScene(obj)
    if (scene) {
      cachedScene = scene
      return scene
    }
  }
  return null
}

/**
 * Attaches a CFS root group to Pascal's scene. Idempotent: if the group is
 * already a child of the scene, returns true without changes. If the scene
 * isn't reachable yet, returns false — caller should retry later.
 *
 * The group is named `CFS_GROUP_NAME` so subsequent attaches can locate
 * and reuse it across hot-reloads or scene resets.
 */
export function attachToPascalScene(group: THREE.Group): boolean {
  const scene = getPascalScene()
  if (!scene) return false
  if (group.parent === scene) return true
  // Remove from any previous parent (e.g., after a Pascal scene reset
  // re-mounts everything but our group is still attached to the old scene).
  if (group.parent) group.parent.remove(group)
  group.name = CFS_GROUP_NAME
  scene.add(group)
  return true
}

/** Detaches the CFS root group from its parent. Safe to call on an unparented group. */
export function detachFromPascalScene(group: THREE.Group): void {
  if (group.parent) group.parent.remove(group)
}

/** For tests: forces the next `getPascalScene()` to re-resolve from scratch. */
export function _resetSceneCache(): void {
  cachedScene = null
}
