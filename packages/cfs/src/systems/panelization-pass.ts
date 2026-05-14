import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import { CFSPanel } from '../schema/cfs-panel'
import type { CFSPanelId, CFSWallFramingId } from '../schema/ids'
import type { CFSMember } from '../schema/cfs-member'
import { CFSMember as CFSMemberSchema } from '../schema/cfs-member'
import type { CFSOpening } from '../schema/cfs-opening'
import type { CFSWallFraming } from '../schema/cfs-wall-framing'
import type { CFSPoint3D } from '../schema/primitives'
import { getActiveLibrary, getProjectSettings } from '../store/selectors'
import { useCFS } from '../store/use-cfs'
import { withBatchedUndo } from '../store/with-batched-undo'
import {
  localToWorld,
  wallLengthFromPascalWall,
  type PascalWallLike,
} from '../lib/wall-frame'
import { worldPointToWallLocalX_mm } from '../lib/panelization-zones'
import {
  PanelizationError,
  planPanelization,
  memberMidAlongWall_mm,
  type PanelDraft,
  type PanelizationWarning,
} from './panelization-compute'

/**
 * §5.5 — Orchestrator for the panelization pass. Pure with respect to its
 * inputs: it reads the scene + cfs stores, computes the desired panel
 * layout via `planPanelization`, then applies the diff via
 * createNode/updateNode/deleteNode inside one `withBatchedUndo` so undo
 * reverts the entire pass as a single Zundo step.
 *
 * Trigger contract (§5.5):
 *   - Caller decides whether to call. The two valid trigger conditions are
 *     (a) user-initiated panelize and (b) settings cascade onto a framing
 *     that already has panels. The React shell (CFSPanelizationSystem)
 *     enforces this; the pass itself just runs.
 */

const MM_PER_METER = 1000
void MM_PER_METER

let isRunning = false

/**
 * Cross-pass signal so `runFramingPass` can skip work while we are in the
 * middle of mutating panels and member.panelId. Without this, the framing
 * pass fires on every createNode/deleteNode inside panelization (each
 * synchronously markDirties the parent framing), sees the framing dirty,
 * recomputes desired members from scratch — and on tracks specifically
 * reverts the panel-aware splits to a single full-wall member, dropping
 * the panel assignments the planner just wrote.
 */
export function isPanelizationRunning(): boolean {
  return isRunning
}

export interface PanelizationPassResult {
  framingId: CFSWallFramingId
  status: 'ok' | 'no-wall' | 'no-settings' | 'no-library' | 'zero-length'
  panelsCreated?: number
  panelsUpdated?: number
  panelsDeleted?: number
  tracksSplit?: number
  warnings?: PanelizationWarning[]
  error?: string
}

/**
 * Run the panelization pass for one framing. Idempotent — calling twice
 * with no scene change is a no-op.
 */
export function runPanelizationPass(framingId: CFSWallFramingId): PanelizationPassResult {
  if (isRunning) return { framingId, status: 'ok' }
  isRunning = true
  try {
    return runInner(framingId)
  } finally {
    isRunning = false
  }
}

function runInner(framingId: CFSWallFramingId): PanelizationPassResult {
  const sceneState = useScene.getState()
  const cfsState = useCFS.getState()
  const settings = getProjectSettings(sceneState)
  const library = getActiveLibrary(cfsState)

  if (!settings) return { framingId, status: 'no-settings' }
  if (!library) return { framingId, status: 'no-library' }

  const framing = sceneState.nodes[framingId as unknown as AnyNodeId] as unknown as
    | CFSWallFraming
    | undefined
  if (!framing) return { framingId, status: 'no-wall' }

  const wall = sceneState.nodes[framing.parentId as unknown as AnyNodeId] as unknown as
    | PascalWallLike
    | undefined
  if (!wall || !Array.isArray(wall.start) || !Array.isArray(wall.end)) {
    return { framingId, status: 'no-wall' }
  }
  const wallLength_mm = wallLengthFromPascalWall(wall)
  if (wallLength_mm <= 0) return { framingId, status: 'zero-length' }

  const studSectionId = framing.studSectionId ?? settings.defaultStudSection
  const studSection = library.sections.find((s) => s.id === studSectionId) ?? null
  const sectionsById = new Map(library.sections.map((s) => [s.id, s]))

  const members: CFSMember[] = []
  const openings: CFSOpening[] = []
  const existingPanels: CFSPanel[] = []
  for (const node of Object.values(sceneState.nodes)) {
    const t = (node as { type?: string }).type
    const parentId = (node as { parentId?: string }).parentId
    if (parentId !== framingId) continue
    if (t === 'cfs_member') members.push(node as unknown as CFSMember)
    else if (t === 'cfs_opening') openings.push(node as unknown as CFSOpening)
    else if (t === 'cfs_panel') existingPanels.push(node as unknown as CFSPanel)
  }

  let plan: ReturnType<typeof planPanelization>
  try {
    plan = planPanelization({
      framingId,
      wall,
      wallLength_mm,
      members,
      openings,
      existingPanels,
      studSection,
      sectionsById,
      settings,
    })
  } catch (e) {
    if (e instanceof PanelizationError) {
      return { framingId, status: 'ok', error: e.detail }
    }
    throw e
  }

  // Apply the plan in one batched-undo step.
  const result: PanelizationPassResult = {
    framingId,
    status: 'ok',
    panelsCreated: 0,
    panelsUpdated: 0,
    panelsDeleted: 0,
    tracksSplit: 0,
    warnings: plan.warnings,
  }

  withBatchedUndo('cfs:panelize', () => {
    const live = useScene.getState()

    // Diff existing panels against drafts. Sentinels are always deleted
    // (they were consumed by the planner) — they have isPendingSentinel:true.
    // For non-sentinel existing panels, match by startAlongWall_mm (rounded
    // to mm tolerance) and update if endAlongWall_mm or aggregates differ.
    const draftByStart = new Map<number, PanelDraft>()
    for (const d of plan.drafts) {
      draftByStart.set(Math.round(d.startAlongWall_mm), d)
    }
    const matchedDraftStarts = new Set<number>()
    const newPanelIdByStart = new Map<number, CFSPanelId>()

    for (const existing of existingPanels) {
      if (existing.isPendingSentinel) {
        live.deleteNode(existing.id as unknown as AnyNodeId)
        result.panelsDeleted! += 1
        continue
      }
      const key = Math.round(existing.startAlongWall_mm)
      const draft = draftByStart.get(key)
      if (!draft) {
        live.deleteNode(existing.id as unknown as AnyNodeId)
        result.panelsDeleted! += 1
        continue
      }
      matchedDraftStarts.add(key)
      newPanelIdByStart.set(key, existing.id as unknown as CFSPanelId)

      const changes: Partial<typeof existing> = {}
      if (Math.abs(existing.endAlongWall_mm - draft.endAlongWall_mm) > 0.5) {
        changes.endAlongWall_mm = draft.endAlongWall_mm
      }
      if (existing.label !== draft.label) changes.label = draft.label
      if (existing.sequenceNumber !== draft.sequenceNumber) {
        changes.sequenceNumber = draft.sequenceNumber
      }
      if (existing.isManualBreak !== draft.isManualBreak) {
        changes.isManualBreak = draft.isManualBreak
      }
      if (existing.cachedMemberCount !== draft.cachedMemberCount) {
        changes.cachedMemberCount = draft.cachedMemberCount
      }
      if (
        existing.cachedWeight_kg === undefined ||
        Math.abs(existing.cachedWeight_kg - draft.cachedWeight_kg) > 0.05
      ) {
        changes.cachedWeight_kg = draft.cachedWeight_kg
      }
      if (Object.keys(changes).length > 0) {
        live.updateNode(
          existing.id as unknown as AnyNodeId,
          changes as unknown as Partial<AnyNode>,
        )
        result.panelsUpdated! += 1
      }
    }

    for (const draft of plan.drafts) {
      const key = Math.round(draft.startAlongWall_mm)
      if (matchedDraftStarts.has(key)) continue
      const panel = CFSPanel.parse({
        type: 'cfs_panel',
        id: generateUuid(),
        parentId: framingId,
        label: draft.label,
        sequenceNumber: draft.sequenceNumber,
        startAlongWall_mm: draft.startAlongWall_mm,
        endAlongWall_mm: draft.endAlongWall_mm,
        cachedMemberCount: draft.cachedMemberCount,
        cachedWeight_kg: draft.cachedWeight_kg,
        isManualBreak: draft.isManualBreak,
      })
      live.createNode(panel as unknown as AnyNode, framingId as unknown as AnyNodeId)
      newPanelIdByStart.set(key, panel.id)
      result.panelsCreated! += 1
    }

    // ── Reassign member.panelId based on midpoint position ─────────────
    // §4.8: this updates the member only; it must NOT dirty the framing
    // or the panel. useScene.updateNode marks the touched node dirty; the
    // member-watcher already filters on member type so this is fine.
    const liveScene = useScene.getState()
    const refreshedMembers: CFSMember[] = []
    for (const node of Object.values(liveScene.nodes)) {
      if ((node as { type?: string }).type !== 'cfs_member') continue
      if ((node as { parentId?: string }).parentId !== framingId) continue
      refreshedMembers.push(node as unknown as CFSMember)
    }
    for (const m of refreshedMembers) {
      const x = memberMidAlongWall_mm(m, wall)
      const desiredPanelId = pickPanelIdFor(x, plan.drafts, newPanelIdByStart)
      if ((m.panelId ?? null) === (desiredPanelId ?? null)) continue
      live.updateNode(
        m.id as unknown as AnyNodeId,
        { panelId: desiredPanelId } as unknown as Partial<AnyNode>,
      )
    }

    // ── Member splitting at panel breaks ───────────────────────────────
    // Tracks (top-track, bottom-track, sill-track) crossing a break are
    // replaced with N+1 pieces, one per panel. Headers, sills, and studs
    // are never split.
    const trackRoles = new Set<CFSMember['role']>([
      'top-track',
      'bottom-track',
      'sill-track',
    ])
    const breaksAlongWall = plan.drafts
      .slice(0, -1)
      .map((d) => d.endAlongWall_mm)
    if (breaksAlongWall.length > 0) {
      // Group adjacent same-role/same-section tracks under the framing first
      // (merge-then-split — §5.5). For v1 we approximate: tracks whose
      // endpoints touch end-to-end with the same role and section are
      // candidates for merging. The split then produces fresh pieces
      // covering the full wall length.
      const tracks = refreshedMembers.filter((m) => trackRoles.has(m.role))
      result.tracksSplit! += rebuildTracks(framingId, wall, tracks, plan.drafts, newPanelIdByStart)
    }
  })

  return result
}

/** Pick the panelId for a member whose midpoint sits at `x_mm` along wall. */
function pickPanelIdFor(
  x_mm: number,
  drafts: readonly PanelDraft[],
  panelIdByStart: ReadonlyMap<number, CFSPanelId>,
): CFSPanelId | null {
  for (const d of drafts) {
    if (x_mm >= d.startAlongWall_mm && x_mm < d.endAlongWall_mm) {
      return panelIdByStart.get(Math.round(d.startAlongWall_mm)) ?? null
    }
  }
  // x_mm exactly at the wall end falls into the last panel.
  if (drafts.length > 0) {
    const last = drafts[drafts.length - 1]!
    if (Math.abs(x_mm - last.endAlongWall_mm) < 0.5) {
      return panelIdByStart.get(Math.round(last.startAlongWall_mm)) ?? null
    }
  }
  return null
}

/**
 * Rebuild tracks per panel. For each track-role bucket grouped by sectionId,
 * compute the wall-local range it currently spans (merging colinear pieces),
 * delete the existing pieces, and create one fresh piece per panel that
 * intersects the original span.
 */
function rebuildTracks(
  framingId: CFSWallFramingId,
  wall: PascalWallLike,
  tracks: readonly CFSMember[],
  drafts: readonly PanelDraft[],
  panelIdByStart: ReadonlyMap<number, CFSPanelId>,
): number {
  if (tracks.length === 0) return 0
  // Bucket by (role, sectionId, y_mm) — the y-coordinate distinguishes top,
  // bottom, and sill tracks at different heights.
  type Bucket = {
    role: CFSMember['role']
    sectionId: string
    y_mm: number
    z_mm: number
    orientation_deg: number
    pieces: CFSMember[]
  }
  const buckets = new Map<string, Bucket>()
  for (const m of tracks) {
    const yKey = Math.round(m.start.y_mm)
    const zKey = Math.round((m.start.z_mm + m.end.z_mm) / 2)
    const key = `${m.role}|${m.sectionId}|${yKey}|${zKey}`
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = {
        role: m.role,
        sectionId: m.sectionId,
        y_mm: m.start.y_mm,
        z_mm: zKey,
        orientation_deg: m.orientation_deg,
        pieces: [],
      }
      buckets.set(key, bucket)
    }
    bucket.pieces.push(m)
  }

  const liveScene = useScene.getState()
  let splitCount = 0

  for (const bucket of buckets.values()) {
    // Determine the along-wall span this bucket covers (merged).
    const spans = bucket.pieces.map((p) => ({
      start_mm: Math.min(endpointAlongWall_mm(p.start, wall),
                         endpointAlongWall_mm(p.end, wall)),
      end_mm: Math.max(endpointAlongWall_mm(p.start, wall),
                       endpointAlongWall_mm(p.end, wall)),
    }))
    const spanStart = Math.min(...spans.map((s) => s.start_mm))
    const spanEnd = Math.max(...spans.map((s) => s.end_mm))

    // Delete every existing piece in this bucket.
    for (const p of bucket.pieces) {
      liveScene.deleteNode(p.id as unknown as AnyNodeId)
    }

    // Create one new piece per panel that intersects [spanStart, spanEnd].
    let bucketSplits = 0
    for (const d of drafts) {
      const overlapStart = Math.max(spanStart, d.startAlongWall_mm)
      const overlapEnd = Math.min(spanEnd, d.endAlongWall_mm)
      if (overlapEnd <= overlapStart) continue
      const startPoint: CFSPoint3D = localToWorld(wall, {
        x_mm: overlapStart,
        y_mm: bucket.y_mm,
        z_mm: bucket.z_mm,
      })
      const endPoint: CFSPoint3D = localToWorld(wall, {
        x_mm: overlapEnd,
        y_mm: bucket.y_mm,
        z_mm: bucket.z_mm,
      })
      const newPanelId =
        panelIdByStart.get(Math.round(d.startAlongWall_mm)) ?? null
      const member = CFSMemberSchema.parse({
        type: 'cfs_member',
        id: generateUuid(),
        parentId: framingId,
        role: bucket.role,
        sectionId: bucket.sectionId,
        start: startPoint,
        end: endPoint,
        orientation_deg: bucket.orientation_deg,
        panelId: newPanelId,
      })
      liveScene.createNode(member as unknown as AnyNode, framingId as unknown as AnyNodeId)
      bucketSplits += 1
    }
    if (bucketSplits > 1) splitCount += bucketSplits
  }

  return splitCount
}

/** Endpoint projection — wraps `worldPointToWallLocalX_mm` for either end of a member. */
function endpointAlongWall_mm(point: CFSPoint3D, wall: PascalWallLike): number {
  return worldPointToWallLocalX_mm({ x_mm: point.x_mm, z_mm: point.z_mm }, wall)
}

function generateUuid(): string {
  const c: { randomUUID?: () => string } = (globalThis as {
    crypto?: { randomUUID?: () => string }
  }).crypto ?? {}
  if (typeof c.randomUUID === 'function') return c.randomUUID()
  const hex = (n: number) =>
    Math.floor(Math.random() * 16 ** n)
      .toString(16)
      .padStart(n, '0')
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`
}

// Re-export for editor-side consumers (PanelBreakTool validates against the
// same compute primitives the pass uses).
export { PanelizationError, planPanelization, memberMidAlongWall_mm } from './panelization-compute'
