/**
 * Pure helpers for `CFSServiceHoleTool`. Given a Pascal `wall:click` event
 * and the current scene, finds the CFS member closest to the click and
 * builds a `CFSServiceHole` payload ready for `useScene.createNode`.
 *
 * §7.3.2 prescribes click-on-CFS-member with a hover ghost. Our Slice-5
 * bridge attaches CFS meshes outside Pascal's R3F event system, so a true
 * mesh-level click handler isn't available without modifying upstream
 * Pascal (forbidden by §0.3). v1 substitution: re-use Pascal's existing
 * `wall:click` event, then project the 3D click world-position onto every
 * CFS member's axis on that wall's framing and pick the closest. The user
 * still clicks on the wall mesh; we figure out which stud / track / king
 * they hit. Tracks at the very top/bottom of the wall and studs along its
 * length are all reachable this way.
 *
 * Future: when a viewer slot for canvas-children opens up (or we ship a
 * native canvas-pointer raycaster), the upstream contract becomes a true
 * `cfs_member:click` event from a member-level renderer, and this module
 * becomes a thin wrapper around that.
 */

import {
  CFSServiceHole,
  cfsMemberLength_mm,
  type CFSMember,
  type CFSMemberId,
  type CFSServiceHoleId,
} from '@pascal-app/cfs'
import type { AnyNode } from '@pascal-app/core'

const M_TO_MM = 1000

/**
 * Maximum perpendicular distance from the click world-point to a member's
 * axis for the hit to count. 200 mm (~8 in) is generous enough that the
 * user can click anywhere on the wall and still hit a stud at typical
 * 600 mm spacing, but small enough that we won't accept clicks that miss
 * every member (e.g., empty bays in a partially-framed wall).
 */
export const MAX_MEMBER_HIT_DISTANCE_MM = 200

/** Round positions to nearest 50 mm when Alt is held — §7.3.2 modifier table. */
export const POSITION_SNAP_MM = 50

export interface PascalWallLike {
  id: string
  start: readonly [number, number]
  end: readonly [number, number]
  height: number
}

export interface ServiceHoleSettings {
  diameter_mm: number
  shape: 'round' | 'oblong'
  oblongWidth_mm: number
  snapToGrid: boolean
  /** Force the placed hole to oblong (Shift held in §7.3.2). */
  forceOblong?: boolean
}

export interface ServiceHoleClickInput {
  nodes: Record<string, AnyNode | undefined>
  wall: PascalWallLike
  /** Pascal `event.localPosition`: [x along wall length, y above ground, z across thickness], in metres. */
  clickWallLocal_m: readonly [number, number, number]
  settings: ServiceHoleSettings
  generateId: () => CFSServiceHoleId
}

export type ServiceHoleClickResult =
  | { ok: true; memberId: CFSMemberId; payload: ReturnType<typeof CFSServiceHole.parse> }
  | { ok: false; reason: 'no-framing' | 'no-member-near-click' | 'position-out-of-range' }

interface Vec3 {
  x: number
  y: number
  z: number
}

function vec(x: number, y: number, z: number): Vec3 {
  return { x, y, z }
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s }
}

function length(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
}

function normalize(a: Vec3): Vec3 {
  const l = length(a) || 1
  return scale(a, 1 / l)
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

/**
 * Convert a Pascal wall-local click (in metres) to a world-space point (in
 * metres). Pascal walls live on the XZ ground plane with start/end as 2D
 * `[x, z]`. The wall's local frame is:
 *   - X axis: along the wall direction (start → end)
 *   - Y axis: world up (height)
 *   - Z axis: across the wall thickness (X × Y, right-handed)
 */
export function wallLocalToWorld_m(
  wall: PascalWallLike,
  localX_m: number,
  localY_m: number,
  localZ_m: number,
): Vec3 {
  const startWorld = vec(wall.start[0], 0, wall.start[1])
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const wallDir = normalize(vec(dx, 0, dz))
  const up = vec(0, 1, 0)
  const thick = normalize(cross(wallDir, up))
  return add(
    add(startWorld, scale(wallDir, localX_m)),
    add(scale(up, localY_m), scale(thick, localZ_m)),
  )
}

/**
 * Project a world-space point onto the segment defined by a CFS member.
 * Returns the parameter `t` along the segment (clamped to [0, 1]) and the
 * perpendicular distance from the point to the segment. All distances in
 * millimetres to match the schema's units.
 */
export function projectPointOntoMember(
  member: Pick<CFSMember, 'start' | 'end'>,
  worldPoint_m: Vec3,
): { positionAlongMember_mm: number; perpDistance_mm: number } {
  const memberStart_m = vec(
    member.start.x_mm / M_TO_MM,
    member.start.y_mm / M_TO_MM,
    member.start.z_mm / M_TO_MM,
  )
  const memberEnd_m = vec(
    member.end.x_mm / M_TO_MM,
    member.end.y_mm / M_TO_MM,
    member.end.z_mm / M_TO_MM,
  )
  const axis = sub(memberEnd_m, memberStart_m)
  const axisLenSq = dot(axis, axis)
  if (axisLenSq === 0) {
    return {
      positionAlongMember_mm: 0,
      perpDistance_mm: length(sub(worldPoint_m, memberStart_m)) * M_TO_MM,
    }
  }
  const fromStart = sub(worldPoint_m, memberStart_m)
  let t = dot(fromStart, axis) / axisLenSq
  if (t < 0) t = 0
  if (t > 1) t = 1
  const projected = add(memberStart_m, scale(axis, t))
  const perpDist_m = length(sub(worldPoint_m, projected))
  const memberLen_mm = cfsMemberLength_mm({
    start: member.start,
    end: member.end,
  } as CFSMember)
  return {
    positionAlongMember_mm: t * memberLen_mm,
    perpDistance_mm: perpDist_m * M_TO_MM,
  }
}

/** Find every CFS member whose `parentId` is the given framing. */
export function membersForFraming(
  nodes: Record<string, AnyNode | undefined>,
  framingId: string,
): CFSMember[] {
  const out: CFSMember[] = []
  for (const n of Object.values(nodes)) {
    if (!n) continue
    if ((n as { type?: string }).type !== 'cfs_member') continue
    if ((n as { parentId?: string }).parentId !== framingId) continue
    out.push(n as unknown as CFSMember)
  }
  return out
}

/** Find the framing node attached to a Pascal wall. */
export function findFramingForWall(
  nodes: Record<string, AnyNode | undefined>,
  wallId: string,
): { id: string } | undefined {
  for (const n of Object.values(nodes)) {
    if (!n) continue
    if ((n as { type?: string }).type !== 'cfs_wall_framing') continue
    if ((n as { parentId?: string }).parentId !== wallId) continue
    return { id: (n as { id: string }).id }
  }
  return undefined
}

/**
 * Pick the CFS member with the smallest perpendicular distance from the
 * click world-point. Returns `null` if no member is within
 * `MAX_MEMBER_HIT_DISTANCE_MM`.
 */
export function pickClosestMember(
  members: readonly CFSMember[],
  worldPoint_m: Vec3,
):
  | { member: CFSMember; positionAlongMember_mm: number; perpDistance_mm: number }
  | null {
  let best:
    | { member: CFSMember; positionAlongMember_mm: number; perpDistance_mm: number }
    | null = null
  for (const m of members) {
    const proj = projectPointOntoMember(m, worldPoint_m)
    if (proj.perpDistance_mm > MAX_MEMBER_HIT_DISTANCE_MM) continue
    if (!best || proj.perpDistance_mm < best.perpDistance_mm) {
      best = { member: m, ...proj }
    }
  }
  return best
}

function maybeSnap(pos_mm: number, snap: boolean): number {
  if (!snap) return pos_mm
  return Math.round(pos_mm / POSITION_SNAP_MM) * POSITION_SNAP_MM
}

/**
 * End-to-end click handler. Given a Pascal wall click, finds the CFS member
 * the user most likely meant and builds a `CFSServiceHole` payload. Pure;
 * the caller (`CFSServiceHoleTool`) is responsible for `createNode`.
 */
export function processServiceHoleClick(
  input: ServiceHoleClickInput,
): ServiceHoleClickResult {
  const { nodes, wall, clickWallLocal_m, settings, generateId } = input
  const framing = findFramingForWall(nodes, wall.id)
  if (!framing) return { ok: false, reason: 'no-framing' }

  const worldClick_m = wallLocalToWorld_m(
    wall,
    clickWallLocal_m[0],
    clickWallLocal_m[1],
    clickWallLocal_m[2] ?? 0,
  )

  const members = membersForFraming(nodes, framing.id)
  const hit = pickClosestMember(members, worldClick_m)
  if (!hit) return { ok: false, reason: 'no-member-near-click' }

  const memberLen = cfsMemberLength_mm(hit.member)
  const rawPos = hit.positionAlongMember_mm
  const snapped = maybeSnap(rawPos, settings.snapToGrid)
  // Clamp into the member; refuse if the clamp had to push the hole all
  // the way to an end (would always violate R1, and means the click was
  // too far from any safe position).
  const halfDiameter = settings.diameter_mm / 2
  const minPos = halfDiameter
  const maxPos = memberLen - halfDiameter
  if (maxPos < minPos) return { ok: false, reason: 'position-out-of-range' }
  const finalPos = Math.min(Math.max(snapped, minPos), maxPos)

  const shape = settings.forceOblong ? 'oblong' : settings.shape
  // For oblong holes (§3.8): `diameter_mm` is the dimension *across* the web
  // (fixed by SSMA convention at `oblongWidth_mm`), `oblongLength_mm` is the
  // long axis *along* the member. §3.12 invariant requires
  // `oblongLength_mm > diameter_mm`, so we clamp accordingly.
  let payloadDiameter = settings.diameter_mm
  let payloadOblongLength: number | undefined
  if (shape === 'oblong') {
    payloadDiameter = settings.oblongWidth_mm
    payloadOblongLength = Math.max(settings.diameter_mm, settings.oblongWidth_mm + 1)
  }

  const payload = CFSServiceHole.parse({
    type: 'cfs_service_hole',
    id: generateId(),
    parentId: hit.member.id,
    positionAlongMember_mm: finalPos,
    diameter_mm: payloadDiameter,
    shape,
    oblongLength_mm: payloadOblongLength,
    hasStiffener: false,
    compliance: { status: 'unchecked', reasons: [] },
  })

  return { ok: true, memberId: hit.member.id, payload }
}
