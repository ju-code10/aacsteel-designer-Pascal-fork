import { beforeEach, describe, expect, it } from 'bun:test'
import { useScene } from '@pascal-app/core'
import { ssmaLibraryJson } from '../../library/load-ssma'
import { CFSProject } from '../../schema/cfs-project'
import type { CFSMember } from '../../schema/cfs-member'
import type { CFSOpening } from '../../schema/cfs-opening'
import { CFSOpening as CFSOpeningSchema } from '../../schema/cfs-opening'
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

  it('subscriber-driven re-entry does not stack-overflow (slice 3 regression)', async () => {
    // Reproduces the bug fixed by the isRunning guard: every createNode
    // inside the pass calls set() which fires every useScene subscriber. A
    // subscriber that calls runFramingPass would re-enter mid-loop, see the
    // framing still dirty, try to create the remaining members, recurse on
    // each, and blow the stack at member ~10–15.
    const { framingId } = await seedScene({ wallLength_m: 3.6, studSpacingOverride_mm: 600 })
    let recursionAttempts = 0
    const unsub = useScene.subscribe((state, prev) => {
      if (state.nodes !== prev.nodes) {
        recursionAttempts += 1
        runFramingPass()
      }
    })
    try {
      runFramingPass()
    } finally {
      unsub()
    }
    // 9 members + 1 framing aggregate-update -> ~10 createNode/updateNode calls.
    // Without the guard, this would never reach the assertion.
    expect(recursionAttempts).toBeGreaterThan(0)
    expect(membersOf(framingId).length).toBe(9)
  })
})

function makeOpening(opts: {
  id: string
  framingId: string
  type: 'door' | 'window'
  position_mm: number
  width_mm: number
  height_mm: number
  sillHeight_mm?: number
  headerTypeOverride?: 'box' | 'L-header' | 'back-to-back' | 'single-track' | 'proprietary' | null
}): CFSOpening {
  return CFSOpeningSchema.parse({
    type: 'cfs_opening',
    id: opts.id,
    parentId: opts.framingId,
    openingType: opts.type,
    positionAlongWall_mm: opts.position_mm,
    roughDimensions: { width_mm: opts.width_mm, height_mm: opts.height_mm },
    sillHeight_mm: opts.sillHeight_mm,
    headerTypeOverride: opts.headerTypeOverride ?? null,
    generatedMemberIds: [],
  }) as CFSOpening
}

function openingsOf(framingId: string): CFSOpening[] {
  const out: CFSOpening[] = []
  for (const n of Object.values(useScene.getState().nodes)) {
    if (
      (n as { type?: string }).type === 'cfs_opening' &&
      (n as { parentId?: string }).parentId === framingId
    ) {
      out.push(n as unknown as CFSOpening)
    }
  }
  return out
}

describe('runFramingPass — slice 4 (openings)', () => {
  beforeEach(() => {
    resetAll()
  })

  it('FRM-S4-01: canonical wall with one door produces king/jamb/header members and removes displaced field studs', async () => {
    const { framingId } = await seedScene({ wallLength_m: 3.6, studSpacingOverride_mm: 600 })
    runFramingPass()
    const opening = makeOpening({
      id: '00000000-0000-4000-8aaa-000000000001',
      framingId,
      type: 'door',
      position_mm: 600,
      width_mm: 900,
      height_mm: 2100,
    })
    useScene.getState().createNode(opening as unknown as never, framingId as never)
    useScene.getState().dirtyNodes.add(framingId as never)
    runFramingPass()

    const members = membersOf(framingId)
    const counts: Record<string, number> = {}
    for (const m of members) counts[m.role] = (counts[m.role] ?? 0) + 1
    expect(counts['king-stud']).toBe(2)
    expect(counts['jamb-stud']).toBe(2)
    expect(counts['header']).toBe(4) // default box header
    // Field studs at 600 and 1200 are displaced; 1800/2400/3000 remain (3).
    expect(counts['stud']).toBe(3)
    // Cripples above: only the 1200 candidate falls inside (jamb left, jamb right) → 1
    expect(counts['cripple']).toBe(1)
    expect(counts['chord-stud']).toBe(2)
  })

  it('FRM-S4-02: window adds sill, sill-track, and cripples below', async () => {
    const { framingId } = await seedScene({ wallLength_m: 3.6, studSpacingOverride_mm: 600 })
    runFramingPass()
    const win = makeOpening({
      id: '00000000-0000-4000-8aaa-000000000002',
      framingId,
      type: 'window',
      position_mm: 600,
      width_mm: 1200,
      height_mm: 1000,
      sillHeight_mm: 900,
    })
    useScene.getState().createNode(win as unknown as never, framingId as never)
    useScene.getState().dirtyNodes.add(framingId as never)
    runFramingPass()

    const members = membersOf(framingId)
    const counts: Record<string, number> = {}
    for (const m of members) counts[m.role] = (counts[m.role] ?? 0) + 1
    expect(counts['sill']).toBe(1)
    expect(counts['sill-track']).toBe(1)
    // 1200 mm wide window at x=600 — jamb range (~620, 1780). Field stud at 1200 is inside.
    // Cripples above and below at 1200 → 2 cripples.
    expect(counts['cripple']).toBe(2)
  })

  it('FRM-S4-03: opening at the wall edge promotes the start chord to king-stud', async () => {
    const { framingId } = await seedScene({ wallLength_m: 3.6, studSpacingOverride_mm: 600 })
    runFramingPass()
    const door = makeOpening({
      id: '00000000-0000-4000-8aaa-000000000003',
      framingId,
      type: 'door',
      position_mm: 0,
      width_mm: 900,
      height_mm: 2100,
    })
    useScene.getState().createNode(door as unknown as never, framingId as never)
    useScene.getState().dirtyNodes.add(framingId as never)
    runFramingPass()

    const members = membersOf(framingId)
    const counts: Record<string, number> = {}
    for (const m of members) counts[m.role] = (counts[m.role] ?? 0) + 1
    // Two chord positions, but the start chord is now a king-stud.
    expect(counts['chord-stud']).toBe(1)
    // king-stud count = 1 (right of opening) + 1 (promoted chord at x=0) = 2.
    expect(counts['king-stud']).toBe(2)
  })

  it('FRM-S4-04: editing opening width re-lays out within one pass and keeps the framing valid', async () => {
    const { framingId } = await seedScene({ wallLength_m: 3.6, studSpacingOverride_mm: 600 })
    runFramingPass()
    const door = makeOpening({
      id: '00000000-0000-4000-8aaa-000000000004',
      framingId,
      type: 'door',
      position_mm: 600,
      width_mm: 900,
      height_mm: 2100,
    })
    useScene.getState().createNode(door as unknown as never, framingId as never)
    useScene.getState().dirtyNodes.add(framingId as never)
    runFramingPass()
    const beforeJambs = membersOf(framingId)
      .filter((m) => m.role === 'jamb-stud')
      .map((m) => m.start.x_mm)
      .sort((a, b) => a - b)

    useScene.getState().updateNode(door.id as unknown as never, {
      roughDimensions: { width_mm: 1500, height_mm: 2100 },
    } as unknown as never)
    useScene.getState().dirtyNodes.add(framingId as never)
    runFramingPass()
    const afterJambs = membersOf(framingId)
      .filter((m) => m.role === 'jamb-stud')
      .map((m) => m.start.x_mm)
      .sort((a, b) => a - b)
    expect(afterJambs[1]! - afterJambs[0]!).toBeGreaterThan(beforeJambs[1]! - beforeJambs[0]!)
  })

  it('FRM-S4-05: deleting an opening returns the framing to plain-wall layout', async () => {
    const { framingId } = await seedScene({ wallLength_m: 3.6, studSpacingOverride_mm: 600 })
    runFramingPass()
    const door = makeOpening({
      id: '00000000-0000-4000-8aaa-000000000005',
      framingId,
      type: 'door',
      position_mm: 600,
      width_mm: 900,
      height_mm: 2100,
    })
    useScene.getState().createNode(door as unknown as never, framingId as never)
    useScene.getState().dirtyNodes.add(framingId as never)
    runFramingPass()
    expect(membersOf(framingId).some((m) => m.role === 'king-stud')).toBe(true)

    useScene.getState().deleteNode(door.id as unknown as never)
    useScene.getState().dirtyNodes.add(framingId as never)
    runFramingPass()
    const members = membersOf(framingId)
    expect(members.some((m) => m.role === 'king-stud')).toBe(false)
    expect(members.some((m) => m.role === 'jamb-stud')).toBe(false)
    expect(members.some((m) => m.role === 'header')).toBe(false)
    expect(members.filter((m) => m.role === 'stud').length).toBe(5)
  })

  it('FRM-S4-06: opening wider than the wall is reported as invalid; other openings still framed', async () => {
    const { framingId } = await seedScene({ wallLength_m: 3.6, studSpacingOverride_mm: 600 })
    runFramingPass()
    const big = makeOpening({
      id: '00000000-0000-4000-8aaa-000000000006',
      framingId,
      type: 'door',
      position_mm: 100,
      width_mm: 5000,
      height_mm: 2100,
    })
    const ok = makeOpening({
      id: '00000000-0000-4000-8aaa-000000000007',
      framingId,
      type: 'door',
      position_mm: 600,
      width_mm: 900,
      height_mm: 2100,
    })
    useScene.getState().createNode(big as unknown as never, framingId as never)
    useScene.getState().createNode(ok as unknown as never, framingId as never)
    useScene.getState().dirtyNodes.add(framingId as never)
    const results = runFramingPass()
    expect(results[0].invalidOpeningIds).toContain(big.id)
    // Valid opening still produced kings.
    expect(membersOf(framingId).some((m) => m.role === 'king-stud')).toBe(true)
  })

  it('FRM-S4-07: idempotent over a single opening — second pass produces no new ids', async () => {
    const { framingId } = await seedScene({ wallLength_m: 3.6, studSpacingOverride_mm: 600 })
    runFramingPass()
    const door = makeOpening({
      id: '00000000-0000-4000-8aaa-000000000008',
      framingId,
      type: 'door',
      position_mm: 600,
      width_mm: 900,
      height_mm: 2100,
    })
    useScene.getState().createNode(door as unknown as never, framingId as never)
    useScene.getState().dirtyNodes.add(framingId as never)
    runFramingPass()
    const idsBefore = new Set(membersOf(framingId).map((m) => m.id))

    useScene.getState().dirtyNodes.add(framingId as never)
    runFramingPass()
    const idsAfter = new Set(membersOf(framingId).map((m) => m.id))
    expect(idsAfter.size).toBe(idsBefore.size)
    for (const id of idsBefore) expect(idsAfter.has(id)).toBe(true)
  })

  it('FRM-S4-08: opening generatedMemberIds gets populated after framing pass', async () => {
    const { framingId } = await seedScene({ wallLength_m: 3.6, studSpacingOverride_mm: 600 })
    runFramingPass()
    const door = makeOpening({
      id: '00000000-0000-4000-8aaa-000000000009',
      framingId,
      type: 'door',
      position_mm: 600,
      width_mm: 900,
      height_mm: 2100,
    })
    useScene.getState().createNode(door as unknown as never, framingId as never)
    useScene.getState().dirtyNodes.add(framingId as never)
    runFramingPass()
    const opening = openingsOf(framingId)[0]!
    // Door generates: 2 kings + 2 jambs + 4 header pieces + 1 cripple above = 9 members.
    expect(opening.generatedMemberIds.length).toBe(9)
  })
})

// Slice 5.1 — cascade delete. Validates that deleting a Pascal wall
// removes the entire CFS subtree (framing + members + openings + their
// generated members). Pascal walks `parent.children` to cascade
// (`packages/core/src/store/actions/node-actions.ts:365`); the schema
// addition of `children: []` to CFSWallFraming and CFSMember is what
// turns those nodes from cascade dead-ends into proper containers.
describe('cascade-delete — slice 5.1', () => {
  beforeEach(() => {
    resetAll()
  })

  async function seedWallAndFraming(): Promise<{ wallId: string; framingId: string }> {
    await useCFS.getState().loadLibrary(ssmaLibraryJson)
    const library = Object.values(useCFS.getState().memberLibraries)[0]
    if (!library) throw new Error('seed: ssma library failed to register')
    const studSection = library.sections.find((s) => s.shape === 'C')!
    const trackSection = library.sections.find((s) => s.shape === 'U')!
    const settings = CFSProjectSettings.parse({
      defaultStudSection: studSection.id,
      defaultTrackSection: trackSection.id,
    })
    const project = CFSProject.parse({
      type: 'cfs_project',
      id: uuid(),
      parentId: SITE_ID,
      schemaVersion: '1.0.0',
      name: 'cascade test',
      settings,
      libraries: [library.id],
      activeLibraryId: library.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
    })

    // Use createNode so Pascal auto-populates wall.children with the framing
    // id — that's the chain the cascade walks.
    useScene.setState((s) => ({
      nodes: {
        ...s.nodes,
        [SITE_ID]: { type: 'site', id: SITE_ID, parentId: null, children: [] } as never,
        [project.id]: project as unknown as never,
      },
      rootNodeIds: [SITE_ID as never],
    }))
    const wallId = `${WALL_ID}_cascade`
    useScene.getState().createNode(
      {
        type: 'wall',
        id: wallId,
        parentId: SITE_ID,
        children: [],
        start: [0, 0],
        end: [3.6, 0],
        height: 2.7,
      } as never,
      SITE_ID as never,
    )
    const framingId = uuid()
    useScene.getState().createNode(
      {
        type: 'cfs_wall_framing',
        id: framingId,
        parentId: wallId,
        studSpacing_mm: 600,
        studSectionId: null,
        trackSectionId: null,
        defaultHeaderType: null,
        wallHeight_mm: null,
        children: [],
      } as unknown as never,
      wallId as never,
    )
    return { wallId, framingId }
  }

  it('createNode populates wall.children with the framing id (precondition)', async () => {
    const { wallId, framingId } = await seedWallAndFraming()
    const wall = useScene.getState().nodes[wallId as never] as { children: string[] }
    expect(wall.children).toContain(framingId)
  })

  it('framing pass populates framing.children with every generated member id (precondition)', async () => {
    const { framingId } = await seedWallAndFraming()
    useScene.getState().dirtyNodes.add(framingId as never)
    runFramingPass()
    const framing = useScene.getState().nodes[framingId as never] as { children: string[] }
    const members = membersOf(framingId)
    expect(members.length).toBeGreaterThan(0)
    for (const m of members) {
      expect(framing.children).toContain(m.id)
    }
  })

  it('FRM-S5.1-01: deleting a Pascal wall removes its framing and every member', async () => {
    const { wallId, framingId } = await seedWallAndFraming()
    useScene.getState().dirtyNodes.add(framingId as never)
    runFramingPass()
    expect(membersOf(framingId).length).toBeGreaterThan(0)
    const memberIds = membersOf(framingId).map((m) => m.id)

    useScene.getState().deleteNode(wallId as never)

    const nodes = useScene.getState().nodes
    expect(nodes[wallId as never]).toBeUndefined()
    expect(nodes[framingId as never]).toBeUndefined()
    for (const id of memberIds) {
      expect(nodes[id as never]).toBeUndefined()
    }
  })

  it('FRM-S5.1-02: deleting a wall with an opening cascades through opening + its generated members', async () => {
    const { wallId, framingId } = await seedWallAndFraming()
    useScene.getState().dirtyNodes.add(framingId as never)
    runFramingPass()
    const door = makeOpening({
      id: '00000000-0000-4000-8aaa-00000000c001',
      framingId,
      type: 'door',
      position_mm: 600,
      width_mm: 900,
      height_mm: 2100,
    })
    useScene.getState().createNode(door as unknown as never, framingId as never)
    useScene.getState().dirtyNodes.add(framingId as never)
    runFramingPass()
    const allMemberIds = membersOf(framingId).map((m) => m.id)
    expect(allMemberIds.length).toBeGreaterThan(9) // tracks + chords + studs + opening framing

    useScene.getState().deleteNode(wallId as never)

    const nodes = useScene.getState().nodes
    expect(nodes[wallId as never]).toBeUndefined()
    expect(nodes[framingId as never]).toBeUndefined()
    expect(nodes[door.id as never]).toBeUndefined()
    for (const id of allMemberIds) expect(nodes[id as never]).toBeUndefined()
  })
})
