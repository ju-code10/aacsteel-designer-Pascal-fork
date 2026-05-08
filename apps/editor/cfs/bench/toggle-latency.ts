/**
 * Build slice 5 open-item measurement (appendix A.4):
 *
 *   "Measure the latency of switching from architectural to CFS mode in a
 *    populated scene. If user-perceptible (>100 ms), revisit the gating
 *    decision in §5.0 and consider keeping geometry up-to-date even when
 *    invisible."
 *
 * This script seeds a synthetic 200-wall scene's worth of CFS members, runs
 * the geometry pass once with CFS mode OFF (cold cache, hidden group), then
 * toggles the mode ON and measures how long the next pass takes. We report:
 *
 *   - cold-build time: the FIRST pass with CFS mode on (cache cold)
 *   - warm-toggle time: turn off → on with cache warm (the user-perceptible
 *     latency the spec asks about)
 *
 * Run with `bun run apps/editor/cfs/bench/toggle-latency.ts`. Output is
 * plain text; copy into the slice-5 commit message under "Open items".
 *
 * Limitations:
 *   - Runs in node (bun) without a real WebGPU renderer. Geometry build
 *     time is measured; GPU upload time is NOT. Real toggle-on latency in
 *     the browser is geometry build + Three.js update + GPU upload, so the
 *     number reported here is a LOWER bound. If the bench reports
 *     >100 ms, the spec gating revisit is mandatory; if it reports <100 ms,
 *     the browser should be checked manually before declaring the open
 *     item closed.
 */

// Run via:
//   cd apps/editor && bun run --preload ./test-setup.ts cfs/bench/toggle-latency.ts
//
// The --preload step registers Bun mocks for `three-bvh-csg` and
// `three-mesh-bvh` before any other import resolves; without it, Pascal's
// core barrel transitively pulls in the UMD build, which fails to
// initialize under Bun's CJS interop ("The superclass is not a
// constructor"). The bench scene has no service holes so the CSG path is
// never exercised — we only need the imports to resolve.

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
  runGeometryPass,
  teardownGeometryPassContext,
} from '../systems/geometry-pass'
import { _resetSceneCache } from '../lib/pascal-scene-bridge'
import { clearExtrusionCache, getExtrusionCacheStats } from '../lib/extrusion-cache'
import { disposeRoleMaterials } from '../lib/role-materials'

const N_WALLS = 200
const STUDS_PER_WALL = 6 // typical 3.6m wall at 600mm o.c.
const HEADERS_PER_WALL = 1
const KINGS_JAMBS_PER_WALL = 4

function setupScene(): void {
  // Pascal scene seed so the bridge can reach the THREE.Scene.
  const scene = new THREE.Scene()
  const seedObj = new THREE.Object3D()
  scene.add(seedObj)
  sceneRegistry.clear()
  sceneRegistry.nodes.set('seed', seedObj)
  _resetSceneCache()

  useScene.setState({
    nodes: {},
    rootNodeIds: [],
    dirtyNodes: new Set(),
    collections: {},
  } as never)

  const result = tryParseLibrary(ssmaLibraryJson)
  if (!result.ok) throw new Error(result.error)
  const studSection = result.library.sections.find((s) => s.shape === 'C')
  const trackSection = result.library.sections.find((s) => s.shape === 'U')
  if (!studSection || !trackSection) throw new Error('library missing C or U sections')

  useCFS.setState({
    isCFSMode: false, // start OFF
    inspectorTab: 'wall',
    hoveredMemberId: null,
    selectedPanelId: null,
    activeTool: null,
    memberLibraries: { [result.library.id]: result.library },
    activeLibraryId: result.library.id,
    unitsDisplay: 'imperial',
    preferredHeaderType: 'box',
    isLibraryLoading: false,
    libraryLoadError: null,
  })

  const nodes: Record<string, unknown> = {
    site: { type: 'site', id: 'site', parentId: null, children: [] },
  }

  let memCounter = 0
  for (let w = 0; w < N_WALLS; w++) {
    const framingId = `frm_${w}` as CFSWallFramingId
    nodes[framingId] = {
      type: 'cfs_wall_framing',
      id: framingId,
      parentId: 'site',
      studSpacing_mm: null,
      studSectionId: null,
      trackSectionId: null,
      defaultHeaderType: null,
      wallHeight_mm: null,
      cachedTotalWeight_kg: 0,
      cachedMemberCount: 0,
    }

    // Walls arranged in a grid 20×10 with 5 m spacing (just for spread).
    const baseX = (w % 20) * 5000
    const baseZ = Math.floor(w / 20) * 5000

    // Field studs
    for (let s = 0; s < STUDS_PER_WALL; s++) {
      const id = `mem_${memCounter++}` as CFSMemberId
      const x = baseX + 600 * s
      nodes[id] = {
        type: 'cfs_member',
        id,
        parentId: framingId,
        role: 'stud',
        sectionId: studSection.id,
        start: { x_mm: x, y_mm: 0, z_mm: baseZ },
        end: { x_mm: x, y_mm: 2743, z_mm: baseZ },
        orientation_deg: 0,
        panelId: null,
        serviceHoleIds: [],
        children: [],
      } satisfies CFSMember
    }
    // Tracks
    for (const role of ['top-track', 'bottom-track'] as const) {
      const id = `mem_${memCounter++}` as CFSMemberId
      const y = role === 'top-track' ? 2743 : 0
      nodes[id] = {
        type: 'cfs_member',
        id,
        parentId: framingId,
        role,
        sectionId: trackSection.id,
        start: { x_mm: baseX, y_mm: y, z_mm: baseZ },
        end: { x_mm: baseX + 3600, y_mm: y, z_mm: baseZ },
        orientation_deg: 0,
        panelId: null,
        serviceHoleIds: [],
        children: [],
      } satisfies CFSMember
    }
    // Header + kings + jambs
    for (let k = 0; k < HEADERS_PER_WALL; k++) {
      const id = `mem_${memCounter++}` as CFSMemberId
      nodes[id] = {
        type: 'cfs_member',
        id,
        parentId: framingId,
        role: 'header',
        sectionId: studSection.id,
        start: { x_mm: baseX + 600, y_mm: 2100, z_mm: baseZ },
        end: { x_mm: baseX + 1500, y_mm: 2100, z_mm: baseZ },
        orientation_deg: 0,
        panelId: null,
        serviceHoleIds: [],
        children: [],
      } satisfies CFSMember
    }
    for (let kj = 0; kj < KINGS_JAMBS_PER_WALL; kj++) {
      const id = `mem_${memCounter++}` as CFSMemberId
      const role = kj < 2 ? 'king-stud' : 'jamb-stud'
      const x = baseX + 600 + kj * 100
      nodes[id] = {
        type: 'cfs_member',
        id,
        parentId: framingId,
        role,
        sectionId: studSection.id,
        start: { x_mm: x, y_mm: 0, z_mm: baseZ },
        end: { x_mm: x, y_mm: 2743, z_mm: baseZ },
        orientation_deg: 0,
        panelId: null,
        serviceHoleIds: [],
        children: [],
      } satisfies CFSMember
    }
  }

  useScene.setState({ nodes: nodes as never, rootNodeIds: ['site'] as never })
}

function timed<T>(label: string, fn: () => T): { ms: number; value: T } {
  const t0 = performance.now()
  const value = fn()
  const ms = performance.now() - t0
  console.log(`  ${label}: ${ms.toFixed(2)} ms`)
  return { ms, value }
}

function bench(): void {
  console.log(
    `\nCFSGeometrySystem toggle-latency bench (appendix A.4 / build slice 5)`,
  )
  console.log(
    `  Scene: ${N_WALLS} walls × ${STUDS_PER_WALL + HEADERS_PER_WALL + KINGS_JAMBS_PER_WALL + 2} members each = ~${N_WALLS * (STUDS_PER_WALL + HEADERS_PER_WALL + KINGS_JAMBS_PER_WALL + 2)} CFSMembers`,
  )

  setupScene()
  const ctx = createGeometryPassContext()

  // Pass 1: CFS mode OFF — should hide group and return fast.
  timed('pass with CFS mode OFF (no work expected)', () => runGeometryPass(ctx))

  // Pass 2: toggle mode ON — cold cache, full build of every mesh.
  useCFS.setState({ isCFSMode: true })
  const cold = timed('cold toggle ON (cache empty, build everything)', () =>
    runGeometryPass(ctx),
  )

  // Pass 3: toggle OFF then back ON — the spec's open question. Cache is
  // warm; geometry already built; signatures match so the pass should be
  // a near-no-op.
  useCFS.setState({ isCFSMode: false })
  runGeometryPass(ctx) // hide
  useCFS.setState({ isCFSMode: true })
  const warm = timed('warm toggle ON (cache hot, no scene change)', () =>
    runGeometryPass(ctx),
  )

  const stats = getExtrusionCacheStats()
  console.log(
    `\n  Extrusion cache: ${stats.size} entries, ${(stats.bytes / 1024 / 1024).toFixed(2)} MB, ${stats.hits} hits / ${stats.misses} misses`,
  )
  console.log(`\nVerdict (spec threshold: <100 ms = unperceptible):`)
  console.log(`  cold: ${cold.ms.toFixed(2)} ms ${cold.ms < 100 ? '✓' : '⚠ exceeds spec threshold'}`)
  console.log(`  warm: ${warm.ms.toFixed(2)} ms ${warm.ms < 100 ? '✓' : '⚠ exceeds spec threshold'}`)
  console.log(
    `\nNote: this is the geometry-build cost only. The browser also pays GPU upload time on toggle-on.\n`,
  )

  teardownGeometryPassContext(ctx)
  clearExtrusionCache()
  disposeRoleMaterials()
}

bench()
