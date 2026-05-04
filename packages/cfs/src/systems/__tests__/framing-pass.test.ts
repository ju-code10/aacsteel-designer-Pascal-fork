import { beforeEach, describe, expect, it } from 'bun:test'
import { useScene } from '@pascal-app/core'
import { ssmaLibraryJson } from '../../library/load-ssma'
import { CFSProject } from '../../schema/cfs-project'
import type { CFSMember } from '../../schema/cfs-member'
import type { CFSWallFraming } from '../../schema/cfs-wall-framing'
import { CFSProjectSettings } from '../../schema/primitives'
import { useCFS } from '../../store/use-cfs'
import { runFramingPass } from '../framing-pass'

const SITE_ID = 'site_test_root'
const WALL_ID = 'wall_test_001'
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
  wallLength_m?: number
  wallHeight_m?: number
  framingHeightOverride_mm?: number | null
  studSpacingOverride_mm?: number | null
}

async function seedScene(opts: SeedOpts = {}): Promise<{
  framingId: string
  wallId: string
  projectId: string
}> {
  await useCFS.getState().loadLibrary(ssmaLibraryJson)
  const library = Object.values(useCFS.getState().memberLibraries)[0]
  if (!library) throw new Error('seed: ssma library failed to register')

  const studSection = library.sections.find(
    (s) => s.shape === 'C' && s.designation === '362S162-54',
  ) ?? library.sections.find((s) => s.shape === 'C')
  const trackSection = library.sections.find(
    (s) => s.shape === 'U' && s.designation === '362T125-54',
  ) ?? library.sections.find((s) => s.shape === 'U')
  if (!studSection || !trackSection) throw new Error('seed: missing sections in ssma seed')

  const settings = CFSProjectSettings.parse({
    defaultStudSection: studSection.id,
    defaultTrackSection: trackSection.id,
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
  const wallId = `${WALL_ID}_${nextUuid}`
  const length_m = opts.wallLength_m ?? 3.6
  const height_m = opts.wallHeight_m ?? 2.7

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
        start: [0, 0],
        end: [length_m, 0],
        height: height_m,
      } as never,
      [framingId]: {
        type: 'cfs_wall_framing',
        id: framingId,
        parentId: wallId,
        studSpacing_mm: opts.studSpacingOverride_mm ?? null,
        studSectionId: null,
        trackSectionId: null,
        defaultHeaderType: null,
        wallHeight_mm: opts.framingHeightOverride_mm ?? null,
      } as unknown as CFSWallFraming as never,
    },
    rootNodeIds: [SITE_ID as never],
  }))
  useScene.temporal.getState().clear()
  useScene.getState().dirtyNodes.add(framingId as never)
  return { framingId, wallId, projectId: project.id }
}

function membersOf(framingId: string): CFSMember[] {
  const out: CFSMember[] = []
  for (const n of Object.values(useScene.getState().nodes)) {
    if ((n as { type?: string }).type === 'cfs_member' && (n as { parentId?: string }).parentId === framingId) {
      out.push(n as unknown as CFSMember)
    }
  }
  return out
}

describe('runFramingPass — slice 3 (steps 1–4)', () => {
  beforeEach(() => {
    resetAll()
  })

  it('FRM-01: 3600 mm wall at 600 mm spacing → 2 tracks + 2 chords + 5 field studs', async () => {
    const { framingId } = await seedScene({ wallLength_m: 3.6, studSpacingOverride_mm: 600 })
    runFramingPass()
    const members = membersOf(framingId)
    const counts: Record<string, number> = {}
    for (const m of members) counts[m.role] = (counts[m.role] ?? 0) + 1
    expect(counts['top-track']).toBe(1)
    expect(counts['bottom-track']).toBe(1)
    expect(counts['chord-stud']).toBe(2)
    expect(counts['stud']).toBe(5)
    expect(members.length).toBe(9)
  })

  it('FRM-02: 600 mm wall at 600 mm spacing → 2 tracks + 2 chords + 0 field studs', async () => {
    const { framingId } = await seedScene({ wallLength_m: 0.6, studSpacingOverride_mm: 600 })
    runFramingPass()
    const members = membersOf(framingId)
    const counts: Record<string, number> = {}
    for (const m of members) counts[m.role] = (counts[m.role] ?? 0) + 1
    expect(counts['stud'] ?? 0).toBe(0)
    expect(counts['chord-stud']).toBe(2)
    expect(counts['top-track']).toBe(1)
    expect(counts['bottom-track']).toBe(1)
  })

  it('FRM-03: 4200 mm wall at 600 mm spacing → 6 field studs', async () => {
    const { framingId } = await seedScene({ wallLength_m: 4.2, studSpacingOverride_mm: 600 })
    runFramingPass()
    const counts = { stud: 0 }
    for (const m of membersOf(framingId)) {
      if (m.role === 'stud') counts.stud += 1
    }
    expect(counts.stud).toBe(6)
  })

  it('FRM-04: 4500 mm wall, 600 mm spacing — last candidate at distance == half spacing is OMITTED (per inclusive half-spacing rule)', async () => {
    const { framingId } = await seedScene({ wallLength_m: 4.5, studSpacingOverride_mm: 600 })
    runFramingPass()
    const studs = membersOf(framingId).filter((m) => m.role === 'stud')
    // candidates: 600, 1200, 1800, 2400, 3000, 3600, 4200; distance(4200→4500)=300=half ⇒ omit
    expect(studs.length).toBe(6)
    const xs = studs.map((m) => m.start.x_mm).sort((a, b) => a - b)
    expect(xs[xs.length - 1]).toBeCloseTo(3600, 0)
  })

  it('FRM-09: settings change re-lays out framings dirtied via setActiveLibrary path', async () => {
    const { framingId } = await seedScene({ wallLength_m: 3.6, studSpacingOverride_mm: 600 })
    runFramingPass()
    const initialStuds = membersOf(framingId).filter((m) => m.role === 'stud').length
    expect(initialStuds).toBe(5)

    // Update framing override to tighter spacing and dirty.
    useScene.getState().updateNode(framingId as never, { studSpacing_mm: 400 } as never)
    useScene.getState().dirtyNodes.add(framingId as never)
    runFramingPass()
    const after = membersOf(framingId).filter((m) => m.role === 'stud').length
    // For 3600 mm wall at 400 mm spacing: 8 field studs.
    expect(after).toBe(8)
  })

  it('FRM-14: pass status is "no-library" and leaves framing dirty when no library is loaded', async () => {
    // Seed without loading a library.
    const wallId = 'wall_x'
    const framingId = uuid()
    useScene.setState((s) => ({
      nodes: {
        ...s.nodes,
        [SITE_ID]: { type: 'site', id: SITE_ID, parentId: null, children: [] } as never,
        [wallId]: {
          type: 'wall',
          id: wallId,
          parentId: SITE_ID,
          start: [0, 0],
          end: [3.6, 0],
          height: 2.7,
        } as never,
        [framingId]: {
          type: 'cfs_wall_framing',
          id: framingId,
          parentId: wallId,
          studSpacing_mm: 600,
          studSectionId: null,
          trackSectionId: null,
          defaultHeaderType: null,
          wallHeight_mm: null,
        } as never,
      },
      rootNodeIds: [SITE_ID as never],
    }))
    useScene.getState().dirtyNodes.add(framingId as never)

    const results = runFramingPass()
    expect(results[0].status).toBe('no-library')
    // Framing remains dirty so a later pass picks it up after library hydrates.
    expect(useScene.getState().dirtyNodes.has(framingId as never)).toBe(true)
    expect(membersOf(framingId).length).toBe(0)
  })

  it('FRM-15: only dirty framings are processed (single-wall edit in a multi-wall scene)', async () => {
    const { framingId: a } = await seedScene({ wallLength_m: 3.6, studSpacingOverride_mm: 600 })
    runFramingPass()
    // Add a second seeded wall+framing.
    const { framingId: b } = await seedScene({ wallLength_m: 1.8, studSpacingOverride_mm: 600 })
    runFramingPass()
    const aBefore = membersOf(a).length
    const bBefore = membersOf(b).length
    expect(aBefore).toBeGreaterThan(0)
    expect(bBefore).toBeGreaterThan(0)

    // Dirty only `a`.
    useScene.getState().dirtyNodes.clear()
    useScene.getState().dirtyNodes.add(a as never)
    runFramingPass()
    expect(membersOf(a).length).toBe(aBefore)
    expect(membersOf(b).length).toBe(bBefore)
  })

  it('writes cachedMemberCount and cachedTotalWeight_kg back to the framing', async () => {
    const { framingId } = await seedScene({ wallLength_m: 3.6, studSpacingOverride_mm: 600 })
    runFramingPass()
    const framing = useScene.getState().nodes[framingId as never] as unknown as CFSWallFraming
    expect(framing.cachedMemberCount).toBe(9)
    expect(framing.cachedTotalWeight_kg).toBeGreaterThan(0)
  })

  it('idempotent: running the pass twice on the same dirty framing produces the same members', async () => {
    const { framingId } = await seedScene({ wallLength_m: 3.6, studSpacingOverride_mm: 600 })
    runFramingPass()
    const idsBefore = new Set(membersOf(framingId).map((m) => m.id))
    useScene.getState().dirtyNodes.add(framingId as never)
    runFramingPass()
    const idsAfter = new Set(membersOf(framingId).map((m) => m.id))
    expect(idsAfter.size).toBe(idsBefore.size)
    // Member ids should be stable thanks to the diff matcher.
    for (const id of idsBefore) expect(idsAfter.has(id)).toBe(true)
  })

  it('zero-length wall: skipped with status, no members generated', async () => {
    const { framingId } = await seedScene({ wallLength_m: 0.0, studSpacingOverride_mm: 600 })
    const results = runFramingPass()
    expect(results[0].status).toBe('zero-length-wall')
    expect(membersOf(framingId).length).toBe(0)
  })
})
