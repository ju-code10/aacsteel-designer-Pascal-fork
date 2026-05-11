'use client'

import {
  emitter,
  useScene,
  type AnyNode,
  type AnyNodeId,
  type WallEvent,
} from '@pascal-app/core'
import {
  CFSPanel,
  computeForbiddenZones,
  isInForbiddenZone,
  kingFlangeBuffer_mm,
  useCFS,
  withBatchedUndo,
  getActiveLibrary,
  getProjectSettings,
  type CFSOpening,
  type CFSPanelId,
  type CFSWallFraming,
} from '@pascal-app/cfs'
import { useEffect } from 'react'

const M_TO_MM = 1000

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

/**
 * §7.3.3 — `CFSPanelBreakTool`. Listens for `wall:click` when
 * `useCFS.activeTool === 'cfs-panel-break'` and places a manual panel
 * break sentinel at the clicked along-wall position.
 *
 * Validation order (clicks are rejected silently if):
 *   1. No `CFSWallFraming` exists for the clicked wall.
 *   2. The clicked position falls inside a forbidden zone (opening +
 *      king-flange buffer, or corner clearance).
 *
 * On success: a zero-width `CFSPanel` sentinel is created via
 * `withBatchedUndo('place panel break')` and `requestPanelize` is called
 * so `CFSPanelizationSystem` runs on the next tick and replaces the
 * sentinel with proper panels.
 */
export function CFSPanelBreakTool(): null {
  useEffect(() => {
    const onWallClick = (event: WallEvent) => {
      if (useCFS.getState().activeTool !== 'cfs-panel-break') return
      const scene = useScene.getState()
      const cfsState = useCFS.getState()
      const settings = getProjectSettings(scene)
      const library = getActiveLibrary(cfsState)
      if (!settings || !library) return

      // Find the framing whose parentId points at this wall.
      const wallId = event.node.id
      const framing = Object.values(scene.nodes).find(
        (n) =>
          (n as { type?: string }).type === 'cfs_wall_framing' &&
          (n as { parentId?: string }).parentId === wallId,
      ) as unknown as CFSWallFraming | undefined
      if (!framing) return

      const wall = event.node as unknown as {
        start: readonly [number, number]
        end: readonly [number, number]
      }
      const wallLength_mm =
        Math.hypot(
          wall.end[0] - wall.start[0],
          wall.end[1] - wall.start[1],
        ) * M_TO_MM
      if (wallLength_mm <= 0) return

      const clickX_mm = event.localPosition[0] * M_TO_MM

      // Validate against forbidden zones using the SAME helper the algorithm
      // uses. If this passes, the panelization algorithm will accept the
      // break (and refuse to put a forbidden break in the layout).
      const studSectionId = framing.studSectionId ?? settings.defaultStudSection
      const studSection = library.sections.find((s) => s.id === studSectionId) ?? null
      const openings = Object.values(scene.nodes).filter(
        (n) =>
          (n as { type?: string }).type === 'cfs_opening' &&
          (n as { parentId?: string }).parentId === framing.id,
      ) as unknown as CFSOpening[]
      const forbidden = computeForbiddenZones(
        openings,
        wallLength_mm,
        kingFlangeBuffer_mm(studSection),
        settings.defaultStudSpacing_mm,
      )
      if (isInForbiddenZone(clickX_mm, forbidden)) {
        // Silent rejection for v1. Slice 9 polish could surface a toast.
        event.stopPropagation()
        return
      }

      withBatchedUndo('place panel break', () => {
        const sentinel = CFSPanel.parse({
          type: 'cfs_panel',
          id: generateUuid() as unknown as CFSPanelId,
          parentId: framing.id,
          label: '__pending-break__',
          sequenceNumber: -1,
          startAlongWall_mm: clickX_mm,
          endAlongWall_mm: clickX_mm,
          isManualBreak: true,
          isPendingSentinel: true,
        })
        scene.createNode(
          sentinel as unknown as AnyNode,
          framing.id as unknown as AnyNodeId,
        )
        useCFS.getState().requestPanelize(framing.id)
      })

      event.stopPropagation()
    }

    emitter.on('wall:click', onWallClick)
    return () => {
      emitter.off('wall:click', onWallClick)
    }
  }, [])

  return null
}
