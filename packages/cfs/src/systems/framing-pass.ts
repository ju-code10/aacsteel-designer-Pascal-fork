import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import { CFSMember } from '../schema/cfs-member'
import type { CFSMemberId, CFSSectionId, CFSWallFramingId } from '../schema/ids'
import type { CFSPoint3D, CFSProjectSettings } from '../schema/primitives'
import type { CFSWallFraming } from '../schema/cfs-wall-framing'
import type { CFSMemberLibrary, CFSSection } from '../schema/cfs-member-library'
import { getActiveLibrary, getProjectSettings } from '../store/selectors'
import { useCFS } from '../store/use-cfs'
import { withBatchedUndo } from '../store/with-batched-undo'
import { chordPositionFromWorld, isCornerOwned } from '../lib/corner-detect'
import { diffMembers } from '../lib/diff-members'
import { sumWeights } from '../lib/sum-weights'
import {
  type PascalWallLike,
  localToWorld,
  wallHeightFromPascalWall,
  wallLengthFromPascalWall,
} from '../lib/wall-frame'

interface DesiredMember {
  role: CFSMember['role']
  sectionId: CFSSectionId
  start: CFSPoint3D
  end: CFSPoint3D
}

function generateUuid(): string {
  const c: { randomUUID?: () => string } = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto ?? {}
  if (typeof c.randomUUID === 'function') return c.randomUUID()
  const hex = (n: number) => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, '0')
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`
}

function findStudCandidatesAlongWall(spacing_mm: number, length_mm: number): number[] {
  const candidates: number[] = []
  for (let x = spacing_mm; x < length_mm; x += spacing_mm) candidates.push(x)
  if (candidates.length === 0) return candidates
  const half = spacing_mm / 2
  const last = candidates[candidates.length - 1] as number
  // §1.4: omit last field stud when its distance to the wall end is at or
  // below half the spacing — the chord stud at the wall end already covers
  // that load. (Per FRM-04: distance == half spacing is also omitted.)
  if (length_mm - last <= half) candidates.pop()
  return candidates
}

function buildDesiredMembers(
  wall: PascalWallLike,
  framing: CFSWallFraming,
  settings: CFSProjectSettings,
  studSection: CFSSection,
  trackSection: CFSSection,
  ownsStartChord: boolean,
  ownsEndChord: boolean,
): DesiredMember[] {
  const length_mm = wallLengthFromPascalWall(wall)
  const height_mm =
    framing.wallHeight_mm ?? wallHeightFromPascalWall(wall) ?? settings.wallHeight_mm
  const spacing_mm = framing.studSpacing_mm ?? settings.defaultStudSpacing_mm
  const desired: DesiredMember[] = []

  // Step 2 — tracks.
  desired.push({
    role: 'top-track',
    sectionId: trackSection.id,
    start: localToWorld(wall, { x_mm: 0, y_mm: height_mm, z_mm: 0 }),
    end: localToWorld(wall, { x_mm: length_mm, y_mm: height_mm, z_mm: 0 }),
  })
  desired.push({
    role: 'bottom-track',
    sectionId: trackSection.id,
    start: localToWorld(wall, { x_mm: 0, y_mm: 0, z_mm: 0 }),
    end: localToWorld(wall, { x_mm: length_mm, y_mm: 0, z_mm: 0 }),
  })

  // Step 3 — chord studs at each end (subject to corner-ownership).
  for (const [x, owns] of [
    [0, ownsStartChord] as const,
    [length_mm, ownsEndChord] as const,
  ]) {
    if (!owns) continue
    desired.push({
      role: 'chord-stud',
      sectionId: studSection.id,
      start: localToWorld(wall, { x_mm: x, y_mm: 0, z_mm: 0 }),
      end: localToWorld(wall, { x_mm: x, y_mm: height_mm, z_mm: 0 }),
    })
  }

  // Step 4 — field studs.
  for (const x of findStudCandidatesAlongWall(spacing_mm, length_mm)) {
    desired.push({
      role: 'stud',
      sectionId: studSection.id,
      start: localToWorld(wall, { x_mm: x, y_mm: 0, z_mm: 0 }),
      end: localToWorld(wall, { x_mm: x, y_mm: height_mm, z_mm: 0 }),
    })
  }

  return desired
}

function materialiseDesired(framing: CFSWallFraming, desired: DesiredMember[]): CFSMember[] {
  return desired.map((d) =>
    CFSMember.parse({
      type: 'cfs_member',
      id: generateUuid(),
      parentId: framing.id,
      role: d.role,
      sectionId: d.sectionId,
      start: d.start,
      end: d.end,
    }),
  )
}

function childrenOfType<T>(
  nodes: Record<string, AnyNode>,
  parentId: string,
  type: string,
): T[] {
  const out: T[] = []
  for (const n of Object.values(nodes)) {
    if ((n as { parentId?: string }).parentId === parentId && (n as { type?: string }).type === type) {
      out.push(n as unknown as T)
    }
  }
  return out
}

function collectPeerChordPositions(
  nodes: Record<string, AnyNode>,
  excludeFramingId: string,
): { framingId: string; position: { x_mm: number; z_mm: number } }[] {
  const peers: { framingId: string; position: { x_mm: number; z_mm: number } }[] = []
  for (const n of Object.values(nodes)) {
    const t = (n as { type?: string }).type
    if (t !== 'cfs_wall_framing') continue
    const framing = n as unknown as CFSWallFraming
    if (framing.id === excludeFramingId) continue
    const wall = nodes[framing.parentId] as unknown as PascalWallLike | undefined
    if (!wall || !wall.start || !wall.end) continue
    const length_mm = wallLengthFromPascalWall(wall)
    peers.push({
      framingId: framing.id,
      position: chordPositionFromWorld(localToWorld(wall, { x_mm: 0, y_mm: 0, z_mm: 0 })),
    })
    peers.push({
      framingId: framing.id,
      position: chordPositionFromWorld(localToWorld(wall, { x_mm: length_mm, y_mm: 0, z_mm: 0 })),
    })
  }
  return peers
}

interface FramingProcessResult {
  framingId: CFSWallFramingId
  status: 'ok' | 'no-library' | 'no-wall' | 'unresolved-section' | 'zero-length-wall'
  totalWeight_kg?: number
  memberCount?: number
}

/**
 * Process every dirty `cfs_wall_framing` id. Pure orchestrator: takes the
 * stores it needs as references, returns a per-framing status array. Idempotent.
 */
export function runFramingPass(): FramingProcessResult[] {
  const sceneState = useScene.getState()
  const cfsState = useCFS.getState()
  const settings = getProjectSettings(sceneState)
  const library = getActiveLibrary(cfsState)

  const results: FramingProcessResult[] = []

  // Snapshot dirty ids that match our type. We process whether or not we have
  // a library so that the status return value can drive inspector messaging.
  const dirty = Array.from(sceneState.dirtyNodes)
  const framingIds: CFSWallFramingId[] = []
  for (const id of dirty) {
    const node = sceneState.nodes[id]
    if (!node) continue
    if ((node as { type?: string }).type === 'cfs_wall_framing') {
      framingIds.push((node as unknown as CFSWallFraming).id)
    }
  }

  for (const framingId of framingIds) {
    const framing = sceneState.nodes[framingId as unknown as AnyNodeId] as unknown as
      | CFSWallFraming
      | undefined
    if (!framing) {
      sceneState.clearDirty(framingId as unknown as AnyNodeId)
      continue
    }

    const wall = sceneState.nodes[framing.parentId as unknown as AnyNodeId] as unknown as
      | PascalWallLike
      | undefined
    if (!wall || !Array.isArray(wall.start) || !Array.isArray(wall.end)) {
      results.push({ framingId, status: 'no-wall' })
      sceneState.clearDirty(framingId as unknown as AnyNodeId)
      continue
    }

    if (wallLengthFromPascalWall(wall) === 0) {
      results.push({ framingId, status: 'zero-length-wall' })
      sceneState.clearDirty(framingId as unknown as AnyNodeId)
      continue
    }

    if (!settings || !library) {
      // Per §5.1 step 1: abort the pass when prerequisites are missing.
      // Leave the framing dirty so a later pass picks it up after settings/library hydrate.
      results.push({ framingId, status: 'no-library' })
      continue
    }

    const studId = framing.studSectionId ?? settings.defaultStudSection
    const trackId = framing.trackSectionId ?? settings.defaultTrackSection
    const studSection = library.sections.find((s) => s.id === studId)
    const trackSection = library.sections.find((s) => s.id === trackId)
    if (!studSection || !trackSection) {
      results.push({ framingId, status: 'unresolved-section' })
      sceneState.clearDirty(framingId as unknown as AnyNodeId)
      continue
    }

    const peers = collectPeerChordPositions(sceneState.nodes, framingId)
    const startWorld = chordPositionFromWorld(
      localToWorld(wall, { x_mm: 0, y_mm: 0, z_mm: 0 }),
    )
    const endWorld = chordPositionFromWorld(
      localToWorld(wall, { x_mm: wallLengthFromPascalWall(wall), y_mm: 0, z_mm: 0 }),
    )
    const ownsStart = isCornerOwned(framingId, startWorld, peers)
    const ownsEnd = isCornerOwned(framingId, endWorld, peers)

    const desiredRaw = buildDesiredMembers(
      wall,
      framing,
      settings,
      studSection,
      trackSection,
      ownsStart,
      ownsEnd,
    )
    const desired = materialiseDesired(framing, desiredRaw)
    const existing = childrenOfType<CFSMember>(sceneState.nodes, framingId, 'cfs_member')
    const diff = diffMembers(existing, desired)

    withBatchedUndo('cfs:framing-pass', () => {
      const liveScene = useScene.getState()
      for (const m of diff.toCreate) {
        liveScene.createNode(m as unknown as AnyNode, framingId as unknown as AnyNodeId)
      }
      for (const u of diff.toUpdate) {
        liveScene.updateNode(
          u.id as unknown as AnyNodeId,
          u.changes as unknown as Partial<AnyNode>,
        )
      }
      for (const id of diff.toDelete) {
        liveScene.deleteNode(id as unknown as AnyNodeId)
      }

      const finalMembers: CFSMember[] = [
        ...existing.filter(
          (m) => !diff.toDelete.includes(m.id as unknown as CFSMemberId),
        ),
        ...diff.toCreate,
      ]
      const totalWeight_kg = sumWeights(finalMembers, library)
      const cachedMemberCount = finalMembers.length
      liveScene.updateNode(framingId as unknown as AnyNodeId, {
        cachedTotalWeight_kg: totalWeight_kg,
        cachedMemberCount,
      } as unknown as Partial<AnyNode>)

      results.push({
        framingId,
        status: 'ok',
        totalWeight_kg,
        memberCount: cachedMemberCount,
      })
    })

    sceneState.clearDirty(framingId as unknown as AnyNodeId)
  }

  return results
}
