import type { AnyNode, AnyNodeId, useScene as UseScene } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import type { CFSProject } from '../../schema/cfs-project'
import { CFSProjectSettings } from '../../schema/primitives'
import type { CFSProjectSettings as CFSProjectSettingsType } from '../../schema/primitives'
import { findCFSProjectId, getCFSProject } from './use-cfs-project'

type SceneState = ReturnType<(typeof UseScene)['getState']>

export function getProjectSettings(state: SceneState): CFSProjectSettingsType | null {
  const project = getCFSProject(state)
  return project ? project.settings : null
}

export function useProjectSettings(): CFSProjectSettingsType | null {
  return useScene(getProjectSettings)
}

export function updateProjectSettings(patch: Partial<CFSProjectSettingsType>): void {
  const state = useScene.getState()
  const projectId = findCFSProjectId(state)
  if (!projectId) return

  const project = state.nodes[projectId as keyof typeof state.nodes] as unknown as CFSProject
  const next = CFSProjectSettings.parse({ ...project.settings, ...patch })
  state.updateNode(projectId as unknown as AnyNodeId, {
    settings: next,
    updatedAt: new Date().toISOString(),
  } as unknown as Partial<AnyNode>)
}
