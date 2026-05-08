'use client'

import {
  emitter,
  useScene,
  type AnyNode,
  type WallEvent,
} from '@pascal-app/core'
import { useCFS } from '@pascal-app/cfs'
import type { CFSServiceHoleId } from '@pascal-app/cfs'
import { useEffect } from 'react'
import { processServiceHoleClick } from './lib/service-hole-tool-base'

function generateUuid(): string {
  const c: { randomUUID?: () => string } =
    (globalThis as { crypto?: { randomUUID?: () => string } }).crypto ?? {}
  if (typeof c.randomUUID === 'function') return c.randomUUID()
  const hex = (n: number) =>
    Math.floor(Math.random() * 16 ** n)
      .toString(16)
      .padStart(n, '0')
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`
}

/**
 * Headless component that listens for `wall:click` events. When
 * `useCFS.activeTool === 'cfs-service-hole'`, projects the click to the
 * closest CFS member on the wall's framing and creates a `CFSServiceHole`
 * via Pascal's `createNode`. The Slice-6 service-hole pass picks up the
 * new hole on the next frame and writes its compliance verdict.
 *
 * Uses `wall:click` rather than a dedicated `cfs_member:click` because the
 * Slice-5 bridge attaches CFS meshes outside Pascal's R3F event system —
 * see `service-hole-tool-base.ts` for the architectural note.
 *
 * Selecting the freshly placed hole drives `ServiceHoleBody` in the
 * inspector. The hole's id is stored in `useCFS.selectedHoleId`.
 */
export function CFSServiceHoleTool(): null {
  useEffect(() => {
    const onWallClick = (event: WallEvent) => {
      const cfs = useCFS.getState()
      if (cfs.activeTool !== 'cfs-service-hole') return
      const scene = useScene.getState()
      const nodes = scene.nodes as unknown as Record<string, AnyNode | undefined>
      // Detect Shift / Alt modifiers from the underlying DOM event.
      const native = (event.nativeEvent ?? event) as unknown as {
        shiftKey?: boolean
        altKey?: boolean
      }
      const result = processServiceHoleClick({
        nodes,
        wall: {
          id: event.node.id,
          start: event.node.start,
          end: event.node.end,
          height: event.node.height ?? 2.7,
        },
        clickWallLocal_m: [
          event.localPosition[0],
          event.localPosition[1],
          event.localPosition[2] ?? 0,
        ],
        settings: {
          diameter_mm: cfs.serviceHoleTool.lastDiameter_mm,
          shape: cfs.serviceHoleTool.shape,
          oblongWidth_mm: cfs.serviceHoleTool.oblongWidth_mm,
          snapToGrid: cfs.serviceHoleTool.snapToGrid || Boolean(native.altKey),
          forceOblong: Boolean(native.shiftKey),
        },
        generateId: () => generateUuid() as unknown as CFSServiceHoleId,
      })
      if (!result.ok) return
      scene.createNode(
        result.payload as unknown as AnyNode,
        result.memberId as unknown as never,
      )
      // Select the new hole so the inspector swaps to ServiceHoleBody.
      useCFS.setState({ selectedHoleId: result.payload.id })
      event.stopPropagation()
    }

    emitter.on('wall:click', onWallClick)
    return () => {
      emitter.off('wall:click', onWallClick)
    }
  }, [])

  return null
}
