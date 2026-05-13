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
      const hits = _raycaster.intersectObject(cfsGroup, true)
      if (hits.length === 0) return

      // First CFS hit. Walk to its member id.
      let hit: MemberHit | null = null
      for (const h of hits) {
        const m = resolveMemberFromHit(h)
        if (m) {
          hit = m
          break
        }
      }
      if (!hit) return

      // member → framing → wall via scene state.
      const sceneState = useScene.getState()
      const member = sceneState.nodes[hit.memberId as unknown as AnyNodeId] as
        | { parentId: AnyNodeId }
        | undefined
      if (!member) return
      const framing = sceneState.nodes[member.parentId] as
        | { parentId: AnyNodeId }
        | undefined
      if (!framing) return
      const wallId = framing.parentId as unknown as string
      const wall = sceneState.nodes[wallId as unknown as AnyNodeId] as
        | WallNode
        | undefined
      if (!wall) return
      if (
        !Array.isArray((wall as unknown as WallShape).start) ||
        !Array.isArray((wall as unknown as WallShape).end)
      ) {
        return
      }

      const along_m = projectAlongWall_m(wall as unknown as WallShape, hit.point)
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
        position: [hit.point.x, hit.point.y, hit.point.z] as [number, number, number],
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
