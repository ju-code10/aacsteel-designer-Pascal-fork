import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { sceneRegistry, useScene } from '@pascal-app/core'
import {
  type CFSMember,
  type CFSMemberId,
  type CFSWallFramingId,
  ssmaLibraryJson,
  tryParseLibrary,
  useCFS,
} from '@pascal-app/cfs'
import * as THREE from 'three'
import {
  createGeometryPassContext,
  type GeometryPassContext,
  runGeometryPass,
  teardownGeometryPassContext,
} from '../geometry-pass'
import { clearExtrusionCache } from '../../lib/extrusion-cache'
import { disposeRoleMaterials } from '../../lib/role-materials'
import { _resetSceneCache } from '../../lib/pascal-scene-bridge'

const SITE_ID = 'site_geom_test_root'
const FRAMING_ID = 'frm_geom_test' as CFSWallFramingId
let STUD_SECTION_ID: string

function resetAll(): void {
  useCFS.setState({
    isCFSMode: false,
    inspectorTab: 'wall',
    hoveredMemberId: null,
    selectedPanelId: null,
    activeTool: null,
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
  } as never)
  useScene.temporal.getState().clear()
  sceneRegistry.clear()
  _resetSceneCache()
  clearExtrusionCache()
  disposeRoleMaterials()
}

async function loadLibraryAndEnableCFS(): Promise<void> {
  const result = tryParseLibrary(ssmaLibraryJson)
  if (!result.ok) throw new Error(`fixture library failed to parse: ${result.error}`)
  // Pick any C-section stud from the shipped library (real IDs are UUIDs).
  const studSection = result.library.sections.find((s) => s.shape === 'C')
  if (!studSection) throw new Error('shipped ssma.json must include at least one C section')
  STUD_SECTION_ID = studSection.id
  useCFS.setState({
    memberLibraries: { [result.library.id]: result.library },
    activeLibraryId: result.library.id,
    isCFSMode: true,
  })
}

function seedFraming(): void {
  useScene.setState((s) => ({
    nodes: {
      ...s.nodes,
      [SITE_ID]: { type: 'site', id: SITE_ID, parentId: null, children: [FRAMING_ID] } as never,
      [FRAMING_ID]: {
        type: 'cfs_wall_framing',
        id: FRAMING_ID,
        parentId: SITE_ID,
        studSpacing_mm: null,
        studSectionId: null,
        trackSectionId: null,
        defaultHeaderType: null,
        wallHeight_mm: null,
        cachedTotalWeight_kg: 0,
        cachedMemberCount: 0,
      } as never,
    },
    rootNodeIds: [SITE_ID as never],
  }))
}

let memCounter = 0
function seedMember(role: CFSMember['role'], opts: Partial<CFSMember> = {}): CFSMemberId {
  memCounter++
  const id = `mem_geom_${memCounter}` as CFSMemberId
  const member: CFSMember = {
    type: 'cfs_member',
    id,
    parentId: FRAMING_ID,
    role,
    sectionId: STUD_SECTION_ID as never,
    start: { x_mm: 0, y_mm: 0, z_mm: 0 },
    end: { x_mm: 0, y_mm: 2743, z_mm: 0 },
    orientation_deg: 0,
    panelId: null,
    serviceHoleIds: [],
    ...opts,
  } as CFSMember
  useScene.setState((s) => ({ nodes: { ...s.nodes, [id]: member as never } }))
  return id
}

function seedScene(): void {
  // A scene without our root group attached. Add a Pascal-style mesh so the
  // bridge has something to walk up from.
  const scene = new THREE.Scene()
  const seedObj = new THREE.Object3D()
  scene.add(seedObj)
  sceneRegistry.nodes.set('seed-obj', seedObj)
}

let ctx: GeometryPassContext

beforeEach(async () => {
  memCounter = 0
  resetAll()
  ctx = createGeometryPassContext()
  await loadLibraryAndEnableCFS()
  seedScene()
  seedFraming()
})

afterEach(() => {
  teardownGeometryPassContext(ctx)
})

describe('geometry pass — basic rendering', () => {
  it('hides the root group when CFS mode is off', () => {
    useCFS.setState({ isCFSMode: false })
    runGeometryPass(ctx)
    expect(ctx.rootGroup.visible).toBe(false)
  })

  it('GEO-09: renders a non-instanced mesh per non-stud member', () => {
    seedMember('header', {
      start: { x_mm: 0, y_mm: 2100, z_mm: 0 },
      end: { x_mm: 900, y_mm: 2100, z_mm: 0 },
    })
    seedMember('king-stud')
    runGeometryPass(ctx)
    expect(ctx.rendered.size).toBe(2)
    expect(ctx.rootGroup.children.length).toBe(2)
  })

  it('GEO-05: collapses field studs into a per-wall InstancedMesh', () => {
    for (let i = 0; i < 6; i++) {
      seedMember('stud', {
        start: { x_mm: 600 * i, y_mm: 0, z_mm: 0 },
        end: { x_mm: 600 * i, y_mm: 2743, z_mm: 0 },
      })
    }
    runGeometryPass(ctx)
    expect(ctx.studGroups.size).toBe(1)
    const handle = ctx.studGroups.get(FRAMING_ID)
    expect(handle?.mesh.count).toBe(6)
    // Single InstancedMesh draw call for all 6 studs.
    expect(handle?.mesh.isInstancedMesh).toBe(true)
  })

  it('registers each non-instanced mesh in sceneRegistry under its CFSMember id (for picking)', () => {
    const headerId = seedMember('header')
    runGeometryPass(ctx)
    const obj = sceneRegistry.nodes.get(headerId)
    expect(obj).toBeDefined()
    expect((obj as THREE.Mesh).userData.cfsMemberId).toBe(headerId)
  })
})

describe('geometry pass — diff & idempotence', () => {
  it('the second pass with no scene changes leaves the rendered mesh untouched', () => {
    seedMember('header')
    runGeometryPass(ctx)
    const meshA = ctx.rendered.values().next().value!.mesh
    const geomA = meshA.geometry
    runGeometryPass(ctx)
    const meshB = ctx.rendered.values().next().value!.mesh
    expect(meshB).toBe(meshA)
    expect(meshB.geometry).toBe(geomA)
  })

  it('removing a member on a subsequent pass disposes its mesh and unregisters it', () => {
    const id = seedMember('header')
    runGeometryPass(ctx)
    expect(ctx.rendered.has(id)).toBe(true)
    expect(sceneRegistry.nodes.has(id)).toBe(true)

    useScene.setState((s) => {
      const next = { ...s.nodes }
      delete next[id]
      return { nodes: next }
    })
    runGeometryPass(ctx)
    expect(ctx.rendered.has(id)).toBe(false)
    expect(sceneRegistry.nodes.has(id)).toBe(false)
  })

  it('changing a member\'s end point rebuilds its geometry', () => {
    const id = seedMember('header', {
      start: { x_mm: 0, y_mm: 2100, z_mm: 0 },
      end: { x_mm: 900, y_mm: 2100, z_mm: 0 },
    })
    runGeometryPass(ctx)
    const meshBefore = ctx.rendered.get(id)!.mesh
    const geomBefore = meshBefore.geometry

    useScene.setState((s) => ({
      nodes: {
        ...s.nodes,
        [id]: {
          ...(s.nodes[id] as CFSMember),
          end: { x_mm: 1500, y_mm: 2100, z_mm: 0 },
        } as never,
      },
    }))
    runGeometryPass(ctx)
    const meshAfter = ctx.rendered.get(id)!.mesh
    expect(meshAfter).toBe(meshBefore) // same Mesh instance
    expect(meshAfter.geometry).not.toBe(geomBefore) // but new geometry
  })

  it('a stud added to an existing wall triggers an InstancedMesh rebuild', () => {
    seedMember('stud')
    runGeometryPass(ctx)
    const handleBefore = ctx.studGroups.get(FRAMING_ID)
    const meshBefore = handleBefore?.mesh
    expect(meshBefore?.count).toBe(1)

    seedMember('stud', {
      start: { x_mm: 600, y_mm: 0, z_mm: 0 },
      end: { x_mm: 600, y_mm: 2743, z_mm: 0 },
    })
    runGeometryPass(ctx)
    const handleAfter = ctx.studGroups.get(FRAMING_ID)
    expect(handleAfter?.mesh.count).toBe(2)
    expect(handleAfter?.mesh).not.toBe(meshBefore) // full rebuild per spec line 545
  })
})

describe('geometry pass — cascade cleanup (slice 5.1)', () => {
  it('removes every rendered mesh after a wall + framing + members are cascade-deleted from useScene', () => {
    // Seed a wall that owns the framing in its children array, so a wall
    // delete cascades through Pascal's deleteNodesAction.
    const wallId = 'wall_cascade_geom'
    useScene.setState((s) => ({
      nodes: {
        ...s.nodes,
        [wallId]: {
          type: 'wall',
          id: wallId,
          parentId: SITE_ID,
          children: [FRAMING_ID],
          start: [0, 0],
          end: [3.6, 0],
          height: 2.7,
        } as never,
      },
    }))
    // Re-parent the framing under the wall (the seedFraming helper put it
    // under SITE_ID); it also needs to register in the wall's children list.
    useScene.setState((s) => ({
      nodes: {
        ...s.nodes,
        [FRAMING_ID]: {
          ...(s.nodes[FRAMING_ID] as Record<string, unknown>),
          parentId: wallId,
          children: ['mem_geom_1', 'mem_geom_2'],
        } as never,
      },
    }))

    const headerId = seedMember('header', {
      start: { x_mm: 0, y_mm: 2100, z_mm: 0 },
      end: { x_mm: 900, y_mm: 2100, z_mm: 0 },
    })
    seedMember('stud') // a field stud, exercising the InstancedMesh path

    runGeometryPass(ctx)
    expect(ctx.rendered.has(headerId)).toBe(true)
    expect(ctx.studGroups.size).toBe(1)
    expect(sceneRegistry.nodes.has(headerId)).toBe(true)

    // Now the user-action: delete the wall. Pascal cascades through
    // wall.children → framing → framing.children → members.
    useScene.getState().deleteNode(wallId as never)

    runGeometryPass(ctx)
    expect(ctx.rendered.size).toBe(0)
    expect(ctx.studGroups.size).toBe(0)
    expect(sceneRegistry.nodes.has(headerId)).toBe(false)
  })
})

describe('geometry pass — Pascal scene attachment', () => {
  it('attaches the root group to Pascal\'s scene as soon as it is reachable', () => {
    seedMember('header')
    runGeometryPass(ctx)
    expect(ctx.rootGroup.parent).not.toBeNull()
    expect((ctx.rootGroup.parent as THREE.Scene).isScene).toBe(true)
  })

  it('does not throw when Pascal\'s scene is not yet reachable (defers attachment)', () => {
    sceneRegistry.clear() // remove the seed-obj
    _resetSceneCache()
    seedMember('header')
    expect(() => runGeometryPass(ctx)).not.toThrow()
    expect(ctx.rootGroup.parent).toBeNull()
  })
})
