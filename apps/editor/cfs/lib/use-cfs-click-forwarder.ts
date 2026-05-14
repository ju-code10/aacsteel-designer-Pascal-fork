'use client'

// Synthesize Pascal `wall:click` events from clicks on CFS framing meshes.
//
// Why this exists: when CFS mode is on, `wall-visibility.ts` sets every
// Pascal wall's THREE.Object3D `.visible = false`. R3F's event system
// filters invisible objects out of pointer-event dispatch, so no
// `wall:click` ever fires on a wall in 3D CFS mode. Every CFS tool that
// listens for `wall:click` (Panel Break, Door, Window, Service Hole) then
// silently does nothing.
//
// Fix: raycast the CFS framing group on every canvas pointer-up. When
// the click hits a CFS member mesh, walk up to its framing → its parent
// wall, project the hit point onto the wall's along-wall axis, and emit
// a synthetic `wall:click` matching the shape Pascal's emitter produces.
// Pascal's own tools never run inside CFS mode (architectural tools are
// not active) so there's no risk of double-firing.

import {
  emitter,
  sceneRegistry,
  useScene,
  type AnyNodeId,
  type WallEvent,
  type WallNode,
} from '@pascal-app/core'
import { useCFS } from '@pascal-app/cfs'
import { useEffect } from 'react'
import * as THREE from 'three'
import { getPascalScene } from './pascal-scene-bridge'

const _raycaster = new THREE.Raycaster()
const _ndc = new THREE.Vector2()

function findCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  // Pascal mounts a single R3F canvas inside the viewer; if the editor
  // grows another one, pick the largest visible canvas as the active
  // viewport.
  const canvases = Array.from(document.querySelectorAll('canvas'))
  if (canvases.length === 0) return null
  if (canvases.length === 1) return canvases[0]!
  let best = canvases[0]!
  let bestArea = best.clientWidth * best.clientHeight
  for (const c of canvases) {
    const a = c.clientWidth * c.clientHeight
    if (a > bestArea) {
      best = c
      bestArea = a
    }
  }
  return best
}

function findCamera(scene: THREE.Scene): THREE.Camera | null {
  let camera: THREE.Camera | null = null
  scene.traverse((obj) => {
    if (camera) return
    const c = obj as THREE.Camera
    if (c.isCamera) camera = c
  })
  return camera
}

interface MemberHit {
  memberId: string
  point: THREE.Vector3
}

interface WallMeshHit {
  wallId: string
  point: THREE.Vector3
  distance: number
}

function resolveMemberFromHit(hit: THREE.Intersection): MemberHit | null {
  // Non-instanced meshes carry `userData.cfsMemberId` directly.
  let cur: THREE.Object3D | null = hit.object
  while (cur) {
    const u = cur.userData as Record<string, unknown> | undefined
    const memberId = u?.['cfsMemberId']
    if (typeof memberId === 'string') {
      return { memberId, point: hit.point.clone() }
    }
    // Instanced field-stud group: instanceIdToMemberId[instanceId] maps
    // back to the source member.
    if (u?.['cfsKind'] === 'field-studs' && typeof hit.instanceId === 'number') {
      const table = u['instanceIdToMemberId'] as readonly string[] | undefined
      const id = table?.[hit.instanceId]
      if (typeof id === 'string') return { memberId: id, point: hit.point.clone() }
    }
    cur = cur.parent
  }
  return null
}

/**
 * Fallback raycast against Pascal's invisible wall meshes. CFS mode hides
 * every wall via `wall-visibility.ts` so `intersectObject` skips them; we
 * need to catch clicks that land between studs/tracks (e.g., panel-break
 * placement mid-bay). For each registered wall, temporarily flip
 * `obj.visible = true`, raycast through its subtree, restore visibility,
 * and tag the resulting hits with their wall id. Returns the nearest hit.
 */
function raycastPascalWalls(
  raycaster: THREE.Raycaster,
): WallMeshHit | null {
  let best: WallMeshHit | null = null
  for (const wallId of sceneRegistry.byType.wall) {
    const obj = sceneRegistry.nodes.get(wallId) as THREE.Object3D | undefined
    if (!obj) continue
    const wasVisible = obj.visible
    obj.visible = true
    const hits: THREE.Intersection[] = []
    try {
      raycaster.intersectObject(obj, true, hits)
    } finally {
      obj.visible = wasVisible
    }
    for (const h of hits) {
      if (!best || h.distance < best.distance) {
        best = { wallId, point: h.point.clone(), distance: h.distance }
      }
    }
  }
  return best
}

interface WallShape {
  id: string
  start: readonly [number, number]
  end: readonly [number, number]
}

function projectAlongWall_m(
  wall: WallShape,
  point: THREE.Vector3,
): number | null {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const len = Math.hypot(dx, dz)
  if (len === 0) return null
  const ux = dx / len
  const uz = dz / len
  const proj = (point.x - wall.start[0]) * ux + (point.z - wall.start[1]) * uz
  return Math.max(0, Math.min(len, proj))
}

/**
 * Mount once, from CFSRoot, only while CFS mode is on. The hook adds a
 * canvas pointer-up listener that raycasts the CFS framing group and
 * synthesizes `wall:click` events. No-op when CFS mode is off, when the
 * Pascal scene hasn't initialised yet, or when no CFS members are in the
 * scene.
 */
export function useCFSWallClickForwarder(isCFSMode: boolean): void {
  useEffect(() => {
    if (!isCFSMode) return
    const canvas = findCanvas()
    if (!canvas) return

    let pointerDownAt: { x: number; y: number } | null = null
    const CLICK_DRIFT_TOLERANCE_PX = 4 // ignore drags

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      pointerDownAt = { x: e.clientX, y: e.clientY }
    }

    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return
      const start = pointerDownAt
      pointerDownAt = null
      if (!start) return
      if (
        Math.abs(e.clientX - start.x) > CLICK_DRIFT_TOLERANCE_PX ||
        Math.abs(e.clientY - start.y) > CLICK_DRIFT_TOLERANCE_PX
      ) {
        return // user dragged (camera orbit / pan), not a click
      }

      if (!useCFS.getState().isCFSMode) return

      const scene = getPascalScene()
      if (!scene) return
      const camera = findCamera(scene)
      if (!camera) return

      const cfsGroup = scene.getObjectByName('cfs-root-group')
      if (!cfsGroup) return

      const rect = canvas.getBoundingClientRect()
      _ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      _raycaster.setFromCamera(_ndc, camera)
      const cfsHits = _raycaster.intersectObject(cfsGroup, true)

      // Resolve the click to a (wallId, hit point) pair. Prefer CFS member
      // hits (precise, picks the topmost member); fall back to Pascal walls
      // for clicks that land between studs/tracks. Without the fallback,
      // tools like Panel Break appear to misfire whenever the cursor lands
      // in an empty bay — the user sees the click but no wall:click fires.
      let resolvedWallId: string | null = null
      let resolvedPoint: THREE.Vector3 | null = null

      for (const h of cfsHits) {
        const m = resolveMemberFromHit(h)
        if (!m) continue
        const sceneNow = useScene.getState()
        const member = sceneNow.nodes[m.memberId as unknown as AnyNodeId] as
          | { parentId: AnyNodeId }
          | undefined
        const framing = member
          ? (sceneNow.nodes[member.parentId] as
              | { parentId: AnyNodeId }
              | undefined)
          : undefined
        if (!framing) continue
        resolvedWallId = framing.parentId as unknown as string
        resolvedPoint = m.point
        break
      }

      if (!resolvedWallId || !resolvedPoint) {
        const wallHit = raycastPascalWalls(_raycaster)
        if (!wallHit) return
        resolvedWallId = wallHit.wallId
        resolvedPoint = wallHit.point
      }

      const sceneState = useScene.getState()
      const wall = sceneState.nodes[resolvedWallId as unknown as AnyNodeId] as
        | WallNode
        | undefined
      if (!wall) return
      if (
        !Array.isArray((wall as unknown as WallShape).start) ||
        !Array.isArray((wall as unknown as WallShape).end)
      ) {
        return
      }
      const wallId = resolvedWallId

      const along_m = projectAlongWall_m(
        wall as unknown as WallShape,
        resolvedPoint,
      )
      if (along_m === null) return

      // Force the Pascal wall registry entry to be "found" — the tool
      // doesn't read this directly but Pascal's emitter type requires
      // an `object` so we look it up best-effort.
      const wallObject = (sceneRegistry.nodes.get(wallId as unknown as never) ??
        null) as THREE.Object3D | null

      // Synthesize a wall:click event matching Pascal's shape (only the
      // fields the CFS tools read: node, localPosition, normal,
      // stopPropagation). Other fields are filled in with safe defaults.
      const event: WallEvent = {
        node: wall,
        position: [resolvedPoint.x, resolvedPoint.y, resolvedPoint.z] as [number, number, number],
        localPosition: [along_m, 0, 0] as [number, number, number],
        normal: undefined,
        faceIndex: undefined,
        object: wallObject ?? (cfsGroup as unknown as THREE.Object3D),
        stopPropagation: () => {
          e.stopPropagation()
        },
        nativeEvent: e as unknown as WallEvent['nativeEvent'],
      }

      emitter.emit('wall:click', event)
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
    }
  }, [isCFSMode])
}
