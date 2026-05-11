// §6.0 — stable iteration order shared by every exporter.
//
// Sort key (highest priority first):
//   1. Building creation order (Pascal node createdAt; fallback: insertion order)
//   2. Level elevation low-to-high (numeric y_m / elevation_m field)
//   3. Wall creation order
//   4. Panel sequenceNumber ascending
//   5. Member shipping mark, lexicographic
//
// This file has no React, no zustand, no @pascal-app/core import — every
// caller passes the scene-state in, so the helpers are unit-testable from
// `bun:test` against a plain record of nodes.

import type { CFSMember } from '../schema/cfs-member'
import type { CFSPanel } from '../schema/cfs-panel'
import type { CFSWallFraming } from '../schema/cfs-wall-framing'
import { isRealPanel } from '../schema/cfs-panel'

export interface SceneLike {
  nodes: Record<string, unknown>
}

interface NodeBase {
  id: string
  type?: string
  parentId?: string | null
  createdAt?: string
}

interface PascalWallLike {
  id: string
  type: 'wall'
  parentId: string
}

interface PascalLevelLike {
  id: string
  type: 'level'
  parentId: string
  elevation_m?: number
  y_m?: number
}

interface PascalBuildingLike {
  id: string
  type: 'building'
  parentId: string
}

function isNode(n: unknown): n is NodeBase {
  return typeof n === 'object' && n !== null && 'id' in n
}

function getType(n: unknown): string | undefined {
  return isNode(n) ? n.type : undefined
}

function buildIndexMap(scene: SceneLike): Map<string, number> {
  const map = new Map<string, number>()
  let i = 0
  for (const id of Object.keys(scene.nodes)) {
    map.set(id, i++)
  }
  return map
}

/** Compare two ids by (createdAt asc, then insertion order asc). */
function compareByCreatedAt(
  scene: SceneLike,
  indexMap: ReadonlyMap<string, number>,
  aId: string,
  bId: string,
): number {
  const a = scene.nodes[aId] as NodeBase | undefined
  const b = scene.nodes[bId] as NodeBase | undefined
  const ta = a?.createdAt
  const tb = b?.createdAt
  if (ta && tb && ta !== tb) return ta < tb ? -1 : 1
  return (indexMap.get(aId) ?? 0) - (indexMap.get(bId) ?? 0)
}

/** Compare two level ids: elevation ascending, then createdAt, then insertion. */
function compareLevels(
  scene: SceneLike,
  indexMap: ReadonlyMap<string, number>,
  aId: string,
  bId: string,
): number {
  const a = scene.nodes[aId] as PascalLevelLike | undefined
  const b = scene.nodes[bId] as PascalLevelLike | undefined
  const ea = a?.elevation_m ?? a?.y_m
  const eb = b?.elevation_m ?? b?.y_m
  if (typeof ea === 'number' && typeof eb === 'number' && ea !== eb) {
    return ea - eb
  }
  return compareByCreatedAt(scene, indexMap, aId, bId)
}

// ── Ancestry helpers ─────────────────────────────────────────────────────────

/** Walk parents until a node whose `type` matches `target`. Returns null if none. */
export function ancestorOfType(
  scene: SceneLike,
  startId: string,
  target: string,
): string | null {
  let cur: string | null | undefined = startId
  // Guard against pathological cycles.
  for (let hop = 0; hop < 32 && cur; hop++) {
    const node = scene.nodes[cur] as NodeBase | undefined
    if (!node) return null
    if (node.type === target) return node.id
    cur = node.parentId ?? null
  }
  return null
}

export function buildingOf(scene: SceneLike, startId: string): string | null {
  return ancestorOfType(scene, startId, 'building')
}

export function levelOf(scene: SceneLike, startId: string): string | null {
  return ancestorOfType(scene, startId, 'level')
}

export function wallOf(scene: SceneLike, framingId: string): string | null {
  const framing = scene.nodes[framingId] as CFSWallFraming | undefined
  if (!framing) return null
  return framing.parentId
}

/** Last 8 chars of an id — used in cut list to keep rows short. */
export function shortId(id: string): string {
  if (id.length <= 8) return id
  return id.slice(-8)
}

// ── Stable-order enumerators ─────────────────────────────────────────────────

function nodesOfType<T extends NodeBase>(scene: SceneLike, type: string): T[] {
  const out: T[] = []
  for (const node of Object.values(scene.nodes)) {
    if (getType(node) === type) out.push(node as T)
  }
  return out
}

/** Walls, ordered by (building createdAt, level elevation, wall createdAt). */
export function sortedWalls(scene: SceneLike): PascalWallLike[] {
  const indexMap = buildIndexMap(scene)
  const walls = nodesOfType<PascalWallLike>(scene, 'wall')
  walls.sort((a, b) => {
    const ab = buildingOf(scene, a.id)
    const bb = buildingOf(scene, b.id)
    if (ab && bb && ab !== bb) return compareByCreatedAt(scene, indexMap, ab, bb)
    const al = levelOf(scene, a.id)
    const bl = levelOf(scene, b.id)
    if (al && bl && al !== bl) return compareLevels(scene, indexMap, al, bl)
    return compareByCreatedAt(scene, indexMap, a.id, b.id)
  })
  return walls
}

/** Wall framings, in stable wall order. One framing per wall. */
export function sortedFramings(scene: SceneLike): CFSWallFraming[] {
  const framings = nodesOfType<CFSWallFraming & NodeBase>(scene, 'cfs_wall_framing')
  const wallOrder = new Map<string, number>()
  sortedWalls(scene).forEach((w, i) => wallOrder.set(w.id, i))
  framings.sort((a, b) => {
    const ai = wallOrder.get(a.parentId) ?? Number.MAX_SAFE_INTEGER
    const bi = wallOrder.get(b.parentId) ?? Number.MAX_SAFE_INTEGER
    return ai - bi
  })
  return framings
}

/** Real panels (sentinels filtered) in stable order, scene-wide. */
export function sortedPanelsScene(scene: SceneLike): CFSPanel[] {
  const framings = sortedFramings(scene)
  const framingOrder = new Map<string, number>()
  framings.forEach((f, i) => framingOrder.set(f.id, i))

  const panels = nodesOfType<CFSPanel & NodeBase>(scene, 'cfs_panel').filter(isRealPanel)
  panels.sort((a, b) => {
    const ai = framingOrder.get(a.parentId) ?? Number.MAX_SAFE_INTEGER
    const bi = framingOrder.get(b.parentId) ?? Number.MAX_SAFE_INTEGER
    if (ai !== bi) return ai - bi
    return a.sequenceNumber - b.sequenceNumber
  })
  return panels
}

/** Members in a single panel, ordered by shipping mark (or id if unmarked). */
export function membersInPanel(scene: SceneLike, panelId: string): CFSMember[] {
  const out: CFSMember[] = []
  for (const node of Object.values(scene.nodes)) {
    if (getType(node) !== 'cfs_member') continue
    const m = node as CFSMember
    if (m.panelId === panelId) out.push(m)
  }
  out.sort((a, b) => {
    const ma = a.shippingMark ?? `~${a.id}`
    const mb = b.shippingMark ?? `~${b.id}`
    return ma < mb ? -1 : ma > mb ? 1 : 0
  })
  return out
}

/** All members in a framing, regardless of panel assignment. */
export function membersInFraming(scene: SceneLike, framingId: string): CFSMember[] {
  const out: CFSMember[] = []
  for (const node of Object.values(scene.nodes)) {
    if (getType(node) !== 'cfs_member') continue
    const m = node as CFSMember
    if (m.parentId === framingId) out.push(m)
  }
  return out
}

/** Members scene-wide in §6.0 stable order, used by the cut list. */
export function sortedMembersScene(scene: SceneLike): CFSMember[] {
  // For cut list ordering we walk framings in stable order, then within
  // a framing we group by panel (in sequenceNumber order), and within a
  // panel by shipping mark. Unpaneled members come last within their
  // framing, ordered by id.
  const out: CFSMember[] = []
  const framings = sortedFramings(scene)
  for (const framing of framings) {
    const framingMembers = membersInFraming(scene, framing.id)
    const panels = nodesOfType<CFSPanel & NodeBase>(scene, 'cfs_panel')
      .filter((p) => p.parentId === framing.id && isRealPanel(p))
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    for (const panel of panels) {
      out.push(...membersInPanel(scene, panel.id))
    }
    const orphans = framingMembers.filter((m) => m.panelId === null)
    orphans.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    out.push(...orphans)
  }
  return out
}
