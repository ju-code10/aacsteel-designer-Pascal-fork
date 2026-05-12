import { describe, expect, it } from 'bun:test'
import { buildCanonicalWall } from '../__fixtures__/canonical-wall'
import type { CFSProject } from '../../schema/cfs-project'
import type { SceneLike } from '../../lib/scene-walk'
import { exportJSON, importJSON } from '../json'
import { checkRoundTripInvariants } from '../json-invariants'

const FIXED_DATE = new Date('2026-05-12T12:00:00.000Z')

function importAndCollect(file: string, libraryId: string): SceneLike {
  const nodes: Record<string, unknown> = {}
  const sceneStore = {
    getState() {
      return {
        nodes,
        createNode(node: unknown) {
          const id = (node as { id?: string }).id
          if (typeof id === 'string') nodes[id] = node
        },
      }
    },
  }
  const cfsStore = {
    getState() {
      return {
        memberLibraries: { [libraryId]: { sections: [] } },
        setCFSMode: () => {},
        setActiveLibrary: () => {},
      }
    },
  }
  importJSON(JSON.parse(file), sceneStore, cfsStore)
  return { nodes }
}

describe('checkRoundTripInvariants', () => {
  it('reports zero violations on the canonical wall round-trip', () => {
    const { scene, project } = buildCanonicalWall()
    const exported = exportJSON(scene, project, { exportedAt: FIXED_DATE })
    const after = importAndCollect(
      exported.fileText,
      project.activeLibraryId as unknown as string,
    )
    const violations = checkRoundTripInvariants(scene, after)
    expect(violations).toEqual([])
  })

  it('reports node-count and node-ids violations when a node is dropped', () => {
    const { scene, project } = buildCanonicalWall()
    const exported = exportJSON(scene, project, { exportedAt: FIXED_DATE })
    const after = importAndCollect(
      exported.fileText,
      project.activeLibraryId as unknown as string,
    )
    // Drop one node from the "after" scene.
    const someMemberId = Object.keys(after.nodes).find(
      (id) => (after.nodes[id] as { type?: string }).type === 'cfs_member',
    )
    if (someMemberId) delete after.nodes[someMemberId]
    const violations = checkRoundTripInvariants(scene, after)
    expect(violations.some((v) => v.invariant === 'node-count')).toBe(true)
    expect(violations.some((v) => v.invariant === 'node-ids')).toBe(true)
  })

  it('reports compliance violations when a hole verdict diverges', () => {
    const { scene, project } = buildCanonicalWall()
    // Inject a hole pre-export and tamper post-import.
    const stud = Object.values(scene.nodes).find(
      (n) =>
        (n as { type?: string }).type === 'cfs_member' &&
        (n as { role?: string }).role === 'stud',
    ) as { id: string; serviceHoleIds: string[] } | undefined
    if (!stud) throw new Error('expected a stud')
    const holeId = '00000000-0000-4000-8a00-0000000005ff'
    scene.nodes[holeId] = {
      type: 'cfs_service_hole',
      id: holeId,
      parentId: stud.id,
      positionAlongMember_mm: 200,
      diameter_mm: 38,
      shape: 'round',
      hasStiffener: false,
      compliance: { status: 'compliant', reasons: [] },
    }
    stud.serviceHoleIds = [holeId]

    const exported = exportJSON(scene, project, { exportedAt: FIXED_DATE })
    const after = importAndCollect(
      exported.fileText,
      project.activeLibraryId as unknown as string,
    )
    // Tamper: flip the imported verdict.
    const reimported = after.nodes[holeId] as { compliance: { status: string } }
    reimported.compliance.status = 'non-compliant'

    const violations = checkRoundTripInvariants(scene, after)
    expect(violations.some((v) => v.invariant === 'compliance')).toBe(true)
  })

  it('reports cached-aggregates drift', () => {
    const { scene, project } = buildCanonicalWall()
    const exported = exportJSON(scene, project, { exportedAt: FIXED_DATE })
    const after = importAndCollect(
      exported.fileText,
      project.activeLibraryId as unknown as string,
    )
    const panelId = Object.keys(after.nodes).find(
      (id) => (after.nodes[id] as { type?: string }).type === 'cfs_panel',
    )
    if (!panelId) throw new Error('no panel')
    ;(after.nodes[panelId] as { cachedWeight_kg?: number }).cachedWeight_kg = 999
    const violations = checkRoundTripInvariants(scene, after)
    expect(violations.some((v) => v.invariant === 'cached-aggregates')).toBe(true)
    void project
  })
})
