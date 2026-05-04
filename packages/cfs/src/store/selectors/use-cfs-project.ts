import type { useScene as UseScene } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import { CFSProject } from '../../schema/cfs-project'

type SceneState = ReturnType<(typeof UseScene)['getState']>

export function findCFSProjectId(state: SceneState): string | null {
  for (const node of Object.values(state.nodes)) {
    if ((node as { type?: string }).type === 'cfs_project') {
      return (node as { id: string }).id
    }
  }
  return null
}

export function getCFSProject(state: SceneState): CFSProject | null {
  const id = findCFSProjectId(state)
  if (!id) return null
  return state.nodes[id as keyof typeof state.nodes] as unknown as CFSProject
}

export function useCFSProject(): CFSProject | null {
  return useScene(getCFSProject)
}
