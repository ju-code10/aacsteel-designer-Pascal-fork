'use client'

import { useScene } from '@pascal-app/core'
import {
  isRealPanel,
  localToWorld,
  useCFS,
  type CFSPanel,
  type CFSWallFraming,
} from '@pascal-app/cfs'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { attachToPascalScene, detachFromPascalScene } from '../lib/pascal-scene-bridge'

const PANEL_PALETTE = [
  '#60a5fa', '#a78bfa', '#f472b6', '#fb923c', '#facc15',
  '#34d399', '#22d3ee', '#818cf8', '#f87171', '#94a3b8',
]
const MM_PER_M = 1000
const OVERLAY_Y_M = 0.02 // 20 mm above floor, prevents Z-fighting
const OVERLAY_THICKNESS_M = 0.1 // 100 mm strip perpendicular to wall

interface PanelOverlay {
  mesh: THREE.Mesh
  signature: string
}

/**
 * §7.3.4 / Slice 7 visual — renders a coloured strip on the floor under each
 * real `CFSPanel`, plus thin vertical bars at each panel boundary. The
 * strip's colour matches the inspector's panel swatch
 * (`panelColor(sequenceNumber)`).
 *
 * Lives entirely in the editor app, attached to Pascal's `THREE.Scene` via
 * the same `attachToPascalScene` bridge `CFSGeometrySystem` uses. Does NOT
 * touch the geometry pass, the InstancedMesh group, or any member
 * material — purely additive. Slice 9 polish can fold this into the
 * geometry tint with per-instance colors.
 *
 * Sentinels (`isPendingSentinel === true`) are skipped — they're transient
 * and the panelization pass replaces them before the next tick.
 */
export function CFSPanelOverlay(): null {
  const rootRef = useRef<THREE.Group | null>(null)
  const overlaysRef = useRef<Map<string, PanelOverlay>>(new Map())

  useEffect(() => {
    const root = new THREE.Group()
    root.name = 'cfs-panel-overlays'
    rootRef.current = root

    const sync = () => {
      const cfsState = useCFS.getState()
      if (!cfsState.isCFSMode) {
        root.visible = false
        return
      }
      root.visible = true
      const sceneState = useScene.getState()
      const overlays = overlaysRef.current

      const desiredIds = new Set<string>()
      for (const node of Object.values(sceneState.nodes)) {
        if ((node as { type?: string }).type !== 'cfs_panel') continue
        const panel = node as unknown as CFSPanel
        if (!isRealPanel(panel)) continue
        const framing = sceneState.nodes[panel.parentId] as unknown as
          | CFSWallFraming
          | undefined
        if (!framing) continue
        const wall = sceneState.nodes[framing.parentId] as unknown as
          | { start: readonly [number, number]; end: readonly [number, number] }
          | undefined
        if (!wall || !Array.isArray(wall.start) || !Array.isArray(wall.end)) continue

        desiredIds.add(panel.id)
        const signature = panelSignature(panel, wall)
        const existing = overlays.get(panel.id)
        if (existing && existing.signature === signature) continue

        const newMesh = buildOverlayMesh(panel, wall)
        if (existing) {
          if (existing.mesh.parent) existing.mesh.parent.remove(existing.mesh)
          ;(existing.mesh.material as THREE.Material).dispose()
          existing.mesh.geometry.dispose()
        }
        root.add(newMesh)
        overlays.set(panel.id, { mesh: newMesh, signature })
      }

      // Remove overlays whose panel has been deleted.
      for (const [id, ov] of overlays) {
        if (desiredIds.has(id)) continue
        if (ov.mesh.parent) ov.mesh.parent.remove(ov.mesh)
        ov.mesh.geometry.dispose()
        ;(ov.mesh.material as THREE.Material).dispose()
        overlays.delete(id)
      }

      if (!root.parent) attachToPascalScene(root)
    }

    sync()
    const unsubScene = useScene.subscribe((s, prev) => {
      if (s.nodes !== prev.nodes) sync()
    })
    const unsubCfs = useCFS.subscribe((s, prev) => {
      if (s.isCFSMode !== prev.isCFSMode) sync()
    })

    return () => {
      unsubScene()
      unsubCfs()
      for (const ov of overlaysRef.current.values()) {
        if (ov.mesh.parent) ov.mesh.parent.remove(ov.mesh)
        ov.mesh.geometry.dispose()
        ;(ov.mesh.material as THREE.Material).dispose()
      }
      overlaysRef.current.clear()
      detachFromPascalScene(root)
    }
  }, [])

  return null
}

function panelColorHex(p: CFSPanel): string {
  const idx = (p.sequenceNumber - 1) % PANEL_PALETTE.length
  return PANEL_PALETTE[idx < 0 ? 0 : idx]!
}

function panelSignature(
  p: CFSPanel,
  wall: { start: readonly [number, number]; end: readonly [number, number] },
): string {
  return [
    p.id,
    p.startAlongWall_mm,
    p.endAlongWall_mm,
    p.sequenceNumber,
    p.isManualBreak,
    wall.start[0],
    wall.start[1],
    wall.end[0],
    wall.end[1],
  ].join('|')
}

function buildOverlayMesh(
  p: CFSPanel,
  wall: { start: readonly [number, number]; end: readonly [number, number] },
): THREE.Mesh {
  // Build a thin box centered along the wall, length = panel width.
  const length_mm = p.endAlongWall_mm - p.startAlongWall_mm
  const length_m = length_mm / MM_PER_M
  const geometry = new THREE.BoxGeometry(length_m, 0.01, OVERLAY_THICKNESS_M)
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(panelColorHex(p)),
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = `cfs-panel-overlay:${p.id}`

  // Center position = wall.start + (panel.start + length/2) along wall axis,
  // offset OVERLAY_THICKNESS_M/2 perpendicular so it's centered on the wall line.
  const midX_mm = p.startAlongWall_mm + length_mm / 2
  const center = localToWorld(
    {
      id: 'wall',
      start: wall.start,
      end: wall.end,
    },
    { x_mm: midX_mm, y_mm: OVERLAY_Y_M * MM_PER_M, z_mm: 0 },
  )
  mesh.position.set(center.x_mm / MM_PER_M, center.y_mm / MM_PER_M, center.z_mm / MM_PER_M)

  // Rotate so the box's long axis aligns with the wall direction.
  const angle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
  mesh.rotation.y = -angle

  return mesh
}
