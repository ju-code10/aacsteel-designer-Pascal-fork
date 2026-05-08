import type { useScene } from '@pascal-app/core'
import type { PascalNodeId } from '../schema/ids'

type SceneState = ReturnType<(typeof useScene)['getState']>

// Resolves the Pascal scene-graph root that a CFSProject should attach to.
// Pascal's loadScene() creates a Site → Building → Level chain and registers
// the Site as the only root id. We attach the CFSProject to whichever root
// node is of type 'site', falling back to the first root id (or null if the
// scene has not been loaded).
export function findSiteRootId(state: SceneState): PascalNodeId | null {
  const { rootNodeIds, nodes } = state
  for (const rootId of rootNodeIds) {
    const root = nodes[rootId]
    if (root && root.type === 'site') return rootId as unknown as PascalNodeId
  }
  const fallback = rootNodeIds[0]
  return fallback ? (fallback as unknown as PascalNodeId) : null
}
