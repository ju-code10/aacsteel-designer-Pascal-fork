import { beforeEach, describe, expect, it } from 'bun:test'
import { useScene } from '@pascal-app/core'
import { ssmaLibraryJson } from '../../../library/load-ssma'
import { useCFS } from '../../use-cfs'
import { findCFSProjectId, getCFSProject } from '../use-cfs-project'
import { getProjectSettings, updateProjectSettings } from '../use-project-settings'

function reset(): void {
  useCFS.setState({
    isCFSMode: false,
    inspectorTab: 'wall',
    hoveredMemberId: null,
    selectedPanelId: null,
    memberLibraries: {},
    activeLibraryId: null,
    unitsDisplay: 'imperial',
    preferredHeaderType: 'box',
    isLibraryLoading: false,
    libraryLoadError: null,
  })
  useScene.setState({
    nodes: {},
    rootNodeIds: [],
    dirtyNodes: new Set(),
    collections: {},
  })
  useScene.temporal.getState().clear()
}

async function createProject(): Promise<void> {
  await useCFS.getState().loadLibrary(ssmaLibraryJson)
  const siteId = 'site_settings_test'
  useScene.setState((s) => ({
    nodes: { ...s.nodes, [siteId]: { type: 'site', id: siteId } as never },
    rootNodeIds: [siteId as never],
  }))
  useCFS.getState().setCFSMode(true)
}

describe('useProjectSettings selector + updateProjectSettings', () => {
  beforeEach(reset)

  it('getProjectSettings returns null before project is created', () => {
    expect(getProjectSettings(useScene.getState())).toBeNull()
  })

  it('returns settings after project creation', async () => {
    await createProject()
    const settings = getProjectSettings(useScene.getState())
    expect(settings).not.toBeNull()
    expect(settings?.defaultStudSpacing_mm).toBe(406.4)
  })

  it('updateProjectSettings produces one Zundo step and dirties only the project', async () => {
    await createProject()
    const projectId = findCFSProjectId(useScene.getState())
    expect(projectId).not.toBeNull()
    useScene.getState().dirtyNodes.clear()
    const before = useScene.temporal.getState().pastStates.length

    updateProjectSettings({ panelMaxWidth_mm: 4000 })

    const after = useScene.temporal.getState().pastStates.length
    expect(after - before).toBe(1)
    expect(getProjectSettings(useScene.getState())?.panelMaxWidth_mm).toBe(4000)

    const dirty = useScene.getState().dirtyNodes
    expect(dirty.has(projectId as never)).toBe(true)
  })

  it('updateProjectSettings rejects invalid values via Zod', async () => {
    await createProject()
    expect(() => updateProjectSettings({ panelMaxWidth_mm: -1 })).toThrow()
    expect(getProjectSettings(useScene.getState())?.panelMaxWidth_mm).toBe(3658)
  })

  it('getCFSProject + findCFSProjectId stay consistent', async () => {
    await createProject()
    const id = findCFSProjectId(useScene.getState())
    const project = getCFSProject(useScene.getState())
    expect(project?.id).toBe(id as never)
  })
})
