import { describe, expect, it } from 'bun:test'
import { buildCanonicalWall } from '../__fixtures__/canonical-wall'
import type { CFSMember } from '../../schema/cfs-member'
import type { CFSProject } from '../../schema/cfs-project'
import type { SceneLike } from '../../lib/scene-walk'
import { exportJSON, importJSON, type ImportResult } from '../json'
import { ExporterError } from '../preflight'

// Fixed timestamp for byte-deterministic exports.
const FIXED_DATE = new Date('2026-05-12T12:00:00.000Z')

// ── Mock stores ────────────────────────────────────────────────────────────
// The importer accepts any object with `getState()` returning the bits it
// needs. Constructing a real Pascal `useScene` would require booting the
// whole core package; the mock is enough to assert on the contract.

function makeMockSceneStore(initialNodes: Record<string, unknown> = {}) {
  const nodes = { ...initialNodes }
  const created: Array<{ node: unknown; parentId: unknown }> = []
  return {
    getState() {
      return {
        nodes,
        createNode(node: unknown, parentId: unknown) {
          const id = (node as { id?: string }).id
          if (typeof id === 'string') nodes[id] = node
          created.push({ node, parentId })
        },
      }
    },
    _created: created,
    _nodes: nodes,
  }
}

function makeMockCFSStore(libraryIds: string[] = []) {
  let cfsModeOn = false
  let activeLibraryId: string | null = null
  return {
    getState() {
      return {
        memberLibraries: Object.fromEntries(
          libraryIds.map((id) => [id, { sections: [] as Array<{ id: string }> }]),
        ),
        setCFSMode(on: boolean) {
          cfsModeOn = on
        },
        setActiveLibrary(id: string) {
          activeLibraryId = id
        },
      }
    },
    _state: {
      get cfsModeOn() {
        return cfsModeOn
      },
      get activeLibraryId() {
        return activeLibraryId
      },
    },
  }
}

// Build a self-consistent JSON file by exporting from a fixture, parsing,
// then optionally mutating.
function exportFile(scene: SceneLike, project: CFSProject) {
  const { fileText } = exportJSON(scene, project, { exportedAt: FIXED_DATE })
  return JSON.parse(fileText) as Record<string, unknown>
}

describe('exportJSON', () => {
  it('JSON-01: empty CFS scene round-trips with zero nodes', () => {
    const scene: SceneLike = { nodes: {} }
    expect(() => exportJSON(scene, null)).toThrow(ExporterError)
    // With a project but no other nodes, the file has 1 CFS node and 0 Pascal.
    const { scene: realScene, project } = buildCanonicalWall()
    const trimmedScene: SceneLike = {
      nodes: Object.fromEntries(
        Object.entries(realScene.nodes).filter(([id]) => id === project.id),
      ),
    }
    const result = exportJSON(trimmedScene, project, { exportedAt: FIXED_DATE })
    expect(result.cfsNodeCount).toBe(1)
    expect(result.pascalNodeCount).toBe(0)
    expect(result.schemaVersion).toBe('1.0.0')
  })

  it('JSON-02: canonical wall — every member id appears in cfsNodes', () => {
    const { scene, project, members } = buildCanonicalWall()
    const file = exportFile(scene, project)
    const cfsNodes = file['cfsNodes'] as Record<string, unknown>
    for (const m of members) {
      expect(cfsNodes).toHaveProperty(m.id as unknown as string)
    }
    // Pascal nodes (site/building/level/wall) live in pascalNodes.
    const pascalNodes = file['pascalNodes'] as Record<string, unknown>
    expect(Object.keys(pascalNodes).some((id) => {
      const t = (pascalNodes[id] as { type?: string }).type
      return t === 'site' || t === 'building' || t === 'level' || t === 'wall'
    })).toBe(true)
  })

  it('separates cfs_* nodes from non-cfs nodes by type prefix', () => {
    const { scene, project } = buildCanonicalWall()
    const file = exportFile(scene, project)
    const cfsNodes = file['cfsNodes'] as Record<string, unknown>
    for (const node of Object.values(cfsNodes)) {
      expect((node as { type: string }).type.startsWith('cfs_')).toBe(true)
    }
  })

  it('emits ISO-8601 timestamps + schemaVersion 1.0.0 + the right generator metadata', () => {
    const { scene, project } = buildCanonicalWall()
    const file = exportFile(scene, project)
    expect(file['schemaVersion']).toBe('1.0.0')
    const gen = file['generator'] as Record<string, unknown>
    expect(gen['tool']).toBe('AACSteel-Designer')
    expect(typeof gen['version']).toBe('string')
    expect(gen['exportedAt']).toBe(FIXED_DATE.toISOString())
  })
})

describe('importJSON', () => {
  it('JSON-02: round-trip preserves every node id', () => {
    const { scene, project } = buildCanonicalWall()
    const file = exportFile(scene, project)
    const sceneStore = makeMockSceneStore()
    const cfsStore = makeMockCFSStore([project.activeLibraryId as unknown as string])
    const result = importJSON(file, sceneStore, cfsStore)
    expect(result.status).toBe('success')
    expect(result.rejectedNodeCount).toBe(0)
    // Every original node id appears in the reconstructed store.
    for (const id of Object.keys(scene.nodes)) {
      expect(sceneStore._nodes).toHaveProperty(id)
    }
  })

  it('JSON-03: multi-panel scene round-trips panel structure', () => {
    const { scene, project } = buildCanonicalWall({ panelCount: 3 })
    const file = exportFile(scene, project)
    const sceneStore = makeMockSceneStore()
    const cfsStore = makeMockCFSStore([project.activeLibraryId as unknown as string])
    importJSON(file, sceneStore, cfsStore)
    // Every panel and every member's panelId survives.
    const panelIds = Object.values(sceneStore._nodes)
      .filter((n) => (n as { type?: string }).type === 'cfs_panel')
      .map((n) => (n as { id: string }).id)
    expect(panelIds.length).toBe(3)
    for (const n of Object.values(sceneStore._nodes)) {
      if ((n as { type?: string }).type === 'cfs_member') {
        const m = n as CFSMember
        if (m.panelId != null) {
          expect(panelIds).toContain(m.panelId as unknown as string)
        }
      }
    }
  })

  it('JSON-04: compliance verdicts round-trip without re-validation', () => {
    const { scene, project } = buildCanonicalWall()
    const stud = Object.values(scene.nodes).find(
      (n) =>
        (n as { type?: string }).type === 'cfs_member' &&
        (n as { role?: string }).role === 'stud',
    ) as { id: string; serviceHoleIds: string[] } | undefined
    if (!stud) throw new Error('expected a stud')
    // Real UUID — `CFSServiceHoleId` is a branded uuid in the schema.
    const holeId = '00000000-0000-4000-8a00-0000000004ff'
    const hole = {
      type: 'cfs_service_hole',
      id: holeId,
      parentId: stud.id,
      positionAlongMember_mm: 200,
      diameter_mm: 38,
      shape: 'round',
      hasStiffener: false,
      compliance: {
        status: 'non-compliant',
        reasons: ['within 305 mm of end (frozen at export time)'],
      },
    }
    scene.nodes[holeId] = hole
    stud.serviceHoleIds = [holeId]

    const file = exportFile(scene, project)
    const sceneStore = makeMockSceneStore()
    const cfsStore = makeMockCFSStore([project.activeLibraryId as unknown as string])
    const result = importJSON(file, sceneStore, cfsStore)
    if (result.status !== 'success') {
      throw new Error(
        `import failed: status=${result.status} messages=${JSON.stringify(result.messages)}`,
      )
    }
    const reimported = sceneStore._nodes[holeId] as Record<string, unknown>
    expect((reimported['compliance'] as { status: string }).status).toBe('non-compliant')
    expect((reimported['compliance'] as { reasons: string[] }).reasons[0]).toContain(
      'frozen at export time',
    )
  })

  it('JSON-05: a Pascal-only scene file imports successfully', () => {
    const file = {
      schemaVersion: '1.0.0',
      generator: {
        tool: 'AACSteel-Designer' as const,
        version: '1.0.0',
        exportedAt: FIXED_DATE.toISOString(),
      },
      pascalNodes: {
        'site-1': { type: 'site', id: 'site-1', parentId: null, children: [] },
      },
      cfsNodes: {},
    }
    const sceneStore = makeMockSceneStore()
    const cfsStore = makeMockCFSStore()
    const result = importJSON(file, sceneStore, cfsStore)
    expect(result.status).toBe('success')
    // isCFSMode unchanged (no CFSProject in file).
    expect(cfsStore._state.cfsModeOn).toBe(false)
  })

  it('JSON-06: a single rejected node yields partial; the rest loads', () => {
    const { scene, project } = buildCanonicalWall()
    const file = exportFile(scene, project)
    const cfsNodes = file['cfsNodes'] as Record<string, Record<string, unknown>>
    // Corrupt one member's role.
    const member = Object.values(cfsNodes).find(
      (n) => n['type'] === 'cfs_member',
    )!
    member['role'] = 'NOT-A-VALID-ROLE'
    const sceneStore = makeMockSceneStore()
    const cfsStore = makeMockCFSStore([project.activeLibraryId as unknown as string])
    const result = importJSON(file, sceneStore, cfsStore)
    expect(result.status).toBe('partial')
    expect(result.rejectedNodeCount).toBeGreaterThanOrEqual(1)
    expect(result.messages.some((m) => m.includes('role'))).toBe(true)
  })

  it('JSON-07: two cfs_project nodes → failure, nothing imported', () => {
    const { scene, project } = buildCanonicalWall()
    const file = exportFile(scene, project)
    const cfsNodes = file['cfsNodes'] as Record<string, Record<string, unknown>>
    // Duplicate the project under a new id.
    const dup = JSON.parse(JSON.stringify(cfsNodes[project.id as unknown as string]))
    dup.id = 'dup-project-id'
    cfsNodes['dup-project-id'] = dup
    const sceneStore = makeMockSceneStore()
    const cfsStore = makeMockCFSStore()
    const result: ImportResult = importJSON(file, sceneStore, cfsStore)
    expect(result.status).toBe('failure')
    expect(result.importedNodeCount).toBe(0)
    expect(Object.keys(sceneStore._nodes)).toEqual([])
  })

  it('JSON-08: unknown future schemaVersion with no migration → failure', () => {
    const { scene, project } = buildCanonicalWall()
    const file = exportFile(scene, project)
    file['schemaVersion'] = '2.0.0'
    const sceneStore = makeMockSceneStore()
    const cfsStore = makeMockCFSStore()
    const result = importJSON(file, sceneStore, cfsStore)
    expect(result.status).toBe('failure')
    expect(result.messages[0]).toMatch(/schema version 2\.0\.0/)
  })

  it('JSON-09: member referencing unknown section → partial with library-warning message', () => {
    const { scene, project } = buildCanonicalWall()
    const file = exportFile(scene, project)
    const cfsNodes = file['cfsNodes'] as Record<string, Record<string, unknown>>
    const member = Object.values(cfsNodes).find(
      (n) => n['type'] === 'cfs_member',
    )!
    // Use a fake but format-valid section id.
    const fakeSection = '00000000-0000-4000-8a00-000000000bad'
    member['sectionId'] = fakeSection
    const sceneStore = makeMockSceneStore()
    // CFS store has libraries but none containing the fake section.
    const cfsStore = makeMockCFSStore([project.activeLibraryId as unknown as string])
    const result = importJSON(file, sceneStore, cfsStore)
    // Library warnings don't reject — status is success unless other issues
    // exist. The fixture has no other issues.
    expect(result.status).toBe('success')
    expect(result.messages.some((m) => m.includes(fakeSection))).toBe(true)
  })

  it('JSON-10: repeated export → import → export is byte-identical (timestamps excluded)', () => {
    const { scene, project } = buildCanonicalWall()
    const firstText = exportJSON(scene, project, { exportedAt: FIXED_DATE }).fileText

    const sceneStore = makeMockSceneStore()
    const cfsStore = makeMockCFSStore([project.activeLibraryId as unknown as string])
    importJSON(JSON.parse(firstText), sceneStore, cfsStore)
    // Find the round-tripped project in the new store.
    const rtProject = Object.values(sceneStore._nodes).find(
      (n) => (n as { type?: string }).type === 'cfs_project',
    ) as CFSProject | undefined
    if (!rtProject) throw new Error('round-tripped project missing')

    const wrappedScene: SceneLike = { nodes: sceneStore._nodes }
    const secondText = exportJSON(wrappedScene, rtProject, {
      exportedAt: FIXED_DATE,
    }).fileText
    expect(secondText).toBe(firstText)
  })

  it.skip('JSON-11: import mid-edit is one undo step', () => {
    // Requires Pascal's full §4.9 batched-undo machinery which v1 does not
    // expose. The current `withBatchedUndo` helper suppresses Zundo
    // entries entirely. Carry-forward to v2 — recorded in PROJECT_SPEC
    // appendix A.5.
  })

  it('JSON-12: nested project.metadata round-trips intact', () => {
    const { scene, project } = buildCanonicalWall()
    project.metadata = {
      ...project.metadata,
      custom: { nested: { key: 'value', list: [1, 2, 3] } },
    }
    const file = exportFile(scene, project)
    const sceneStore = makeMockSceneStore()
    const cfsStore = makeMockCFSStore([project.activeLibraryId as unknown as string])
    importJSON(file, sceneStore, cfsStore)
    const rtProject = sceneStore._nodes[project.id as unknown as string] as CFSProject
    const meta = rtProject.metadata as Record<string, unknown>
    expect(meta['custom']).toEqual({ nested: { key: 'value', list: [1, 2, 3] } })
  })

  it('rejects an empty / non-object input with status: failure', () => {
    const sceneStore = makeMockSceneStore()
    const cfsStore = makeMockCFSStore()
    expect(importJSON(null, sceneStore, cfsStore).status).toBe('failure')
    expect(importJSON({ wrong: 'shape' }, sceneStore, cfsStore).status).toBe(
      'failure',
    )
  })

  it('flips isCFSMode when the file contains a cfs_project', () => {
    const { scene, project } = buildCanonicalWall()
    const file = exportFile(scene, project)
    const sceneStore = makeMockSceneStore()
    const cfsStore = makeMockCFSStore([project.activeLibraryId as unknown as string])
    importJSON(file, sceneStore, cfsStore)
    expect(cfsStore._state.cfsModeOn).toBe(true)
    expect(cfsStore._state.activeLibraryId).toBe(
      project.activeLibraryId as unknown as string,
    )
  })
})
