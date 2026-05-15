import { beforeEach, describe, expect, it } from 'bun:test'
import { useScene } from '@pascal-app/core'
import { ssmaLibraryJson } from '../../library/load-ssma'
import { CFSProject } from '../../schema/cfs-project'
import type { CFSMember } from '../../schema/cfs-member'
import type { CFSWallFraming } from '../../schema/cfs-wall-framing'
import { CFSProjectSettings } from '../../schema/primitives'
import { useCFS } from '../../store/use-cfs'
import { runFramingPass } from '../framing-pass'
import { runPanelizationPass } from '../panelization-pass'

const SITE_ID = 'site_test_root'
let nextUuid = 0
function uuid(): string {
  nextUuid += 1
  const seg = nextUuid.toString(16).padStart(12, '0')
  return `00000000-0000-4000-8a00-${seg}`
}

function resetAll(): void {
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
  nextUuid = 0
}

interface SeedOpts {
  /** Pascal-2D start point in metres (x along world-x, y along world-z). */
  wallStart_m: readonly [number, number]
  /** Pascal-2D end point in metres. */
  wallEnd_m: readonly [number, number]
  panelMaxWidth_mm: number
  panelMaxWeight_kg?: number
}

async function seedScene(opts: SeedOpts): Promise<{
  framingId: string
  wallId: string
}> {
  await useCFS.getState().loadLibrary(ssmaLibraryJson)
  const library = Object.values(useCFS.getState().memberLibraries)[0]
  if (!library) throw new Error('seed: ssma library failed to register')

  const studSection = library.sections.find(
    (s) => s.shape === 'C' && s.designation === '362S162-54',
  )
  const trackSection = library.sections.find(
    (s) => s.shape === 'U' && s.designation === '362T125-54',
  )
  if (!studSection || !trackSection) throw new Error('seed: missing sections in ssma seed')

  const settings = CFSProjectSettings.parse({
    defaultStudSection: studSection.id,
    defaultTrackSection: trackSection.id,
    panelMaxWidth_mm: opts.panelMaxWidth_mm,
    panelMaxWeight_kg: opts.panelMaxWeight_kg ?? 680,
  })

  const project = CFSProject.parse({
    type: 'cfs_project',
    id: uuid(),
    parentId: SITE_ID,
    schemaVersion: '1.0.0',
    name: 'test project',
    settings,
    libraries: [library.id],
    activeLibraryId: library.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {},
  })

  const framingId = uuid()
  const wallId = `wall_${nextUuid}`

  useScene.setState((s) => ({
    nodes: {
      ...s.nodes,
      [SITE_ID]: { type: 'site', id: SITE_ID, parentId: null, children: [] } as never,
      [project.id]: project as unknown as never,
      [wallId]: {
        type: 'wall',
        id: wallId,
        parentId: SITE_ID,
        children: [],
        start: opts.wallStart_m,
        end: opts.wallEnd_m,
        height: 2.7,
      } as never,
      [framingId]: {
        type: 'cfs_wall_framing',
        id: framingId,
        parentId: wallId,
        studSpacing_mm: null,
        studSectionId: null,
        trackSectionId: null,
        defaultHeaderType: null,
        wallHeight_mm: null,
      } as unknown as CFSWallFraming as never,
    },
    rootNodeIds: [SITE_ID as never],
  }))
  useScene.temporal.getState().clear()
  useScene.getState().dirtyNodes.add(framingId as never)
  return { framingId, wallId }
}

function tracksOf(framingId: string): CFSMember[] {
  const out: CFSMember[] = []
  for (const n of Object.values(useScene.getState().nodes)) {
    if ((n as { type?: string }).type !== 'cfs_member') continue
    if ((n as { parentId?: string }).parentId !== framingId) continue
    const m = n as unknown as CFSMember
    if (m.role === 'top-track' || m.role === 'bottom-track') out.push(m)
  }
  return out
}

describe('runPanelizationPass — track split coordinates', () => {
  beforeEach(() => {
    resetAll()
  })

  it('PNL-01: panel-split tracks stay on the wall centerline when wall.start is off-origin', async () => {
    // Bug repro: tracks float perpendicular to the wall by wall.start * 1000
    // when panelization re-projects world z through localToWorld as if it
    // were local z. Wall along +x at world z = 3 m forces a non-trivial
    // wall.start[1] so the bug surfaces in the asserted track world z.
    const { framingId } = await seedScene({
      wallStart_m: [5, 3],
      wallEnd_m: [12, 3], // 7 m long along +x
      panelMaxWidth_mm: 4000, // forces 2 panels => 1 break => tracks split
    })
    runFramingPass()

    const framingTracks = tracksOf(framingId)
    expect(framingTracks).toHaveLength(2) // one top, one bottom, full-wall
    for (const t of framingTracks) {
      // Sanity: framing pass already places tracks on world z = 3000.
      expect(t.start.z_mm).toBeCloseTo(3000, 6)
      expect(t.end.z_mm).toBeCloseTo(3000, 6)
    }

    const result = runPanelizationPass(framingId as never)
    expect(result.status).toBe('ok')
    expect(result.panelsCreated).toBeGreaterThanOrEqual(2)

    const splitTracks = tracksOf(framingId)
    // 2 panels × {top, bottom} = 4 track pieces.
    expect(splitTracks).toHaveLength(4)
    for (const t of splitTracks) {
      expect(t.start.z_mm).toBeCloseTo(3000, 6)
      expect(t.end.z_mm).toBeCloseTo(3000, 6)
    }

    // World x of every endpoint stays within the wall's x-range [5000, 12000].
    for (const t of splitTracks) {
      expect(t.start.x_mm).toBeGreaterThanOrEqual(5000 - 0.5)
      expect(t.start.x_mm).toBeLessThanOrEqual(12000 + 0.5)
      expect(t.end.x_mm).toBeGreaterThanOrEqual(5000 - 0.5)
      expect(t.end.x_mm).toBeLessThanOrEqual(12000 + 0.5)
    }

    // top-tracks at y = wall height; bottom-tracks at y = 0.
    const tops = splitTracks.filter((t) => t.role === 'top-track')
    const bottoms = splitTracks.filter((t) => t.role === 'bottom-track')
    expect(tops).toHaveLength(2)
    expect(bottoms).toHaveLength(2)
    for (const t of tops) expect(t.start.y_mm).toBeCloseTo(2700, 6)
    for (const b of bottoms) expect(b.start.y_mm).toBeCloseTo(0, 6)
  })

  it('PNL-02: panel-split tracks span the full wall length with no gap and no overlap', async () => {
    const { framingId } = await seedScene({
      wallStart_m: [5, 3],
      wallEnd_m: [12, 3],
      panelMaxWidth_mm: 4000,
    })
    runFramingPass()
    runPanelizationPass(framingId as never)

    const tops = tracksOf(framingId)
      .filter((t) => t.role === 'top-track')
      .map((t) => ({
        start_x: Math.min(t.start.x_mm, t.end.x_mm),
        end_x: Math.max(t.start.x_mm, t.end.x_mm),
      }))
      .sort((a, b) => a.start_x - b.start_x)
    expect(tops[0]!.start_x).toBeCloseTo(5000, 3)
    expect(tops[tops.length - 1]!.end_x).toBeCloseTo(12000, 3)
    for (let i = 1; i < tops.length; i += 1) {
      // Adjacent pieces meet end-to-end at the panel break.
      expect(tops[i]!.start_x).toBeCloseTo(tops[i - 1]!.end_x, 3)
    }
  })
})
