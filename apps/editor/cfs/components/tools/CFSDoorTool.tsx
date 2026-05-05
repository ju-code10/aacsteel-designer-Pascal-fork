'use client'

import {
  emitter,
  useScene,
  type AnyNode,
  type WallEvent,
} from '@pascal-app/core'
import { useCFS } from '@pascal-app/cfs'
import type { CFSOpeningId } from '@pascal-app/cfs'
import { useEffect } from 'react'
import {
  DOOR_DEFAULTS,
  processToolClick,
} from './lib/opening-tool-base'

function generateUuid(): string {
  const c: { randomUUID?: () => string } = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto ?? {}
  if (typeof c.randomUUID === 'function') return c.randomUUID()
  const hex = (n: number) => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, '0')
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`
}

/**
 * Headless component that listens for `wall:click` events and creates a CFS
 * door opening when `useCFS.activeTool === 'cfs-door'`. The framing pass
 * re-runs after the createNode mutation and produces the king/jamb/header
 * members. This tool itself never touches geometry.
 */
export function CFSDoorTool(): null {
  useEffect(() => {
    const onWallClick = (event: WallEvent) => {
      if (useCFS.getState().activeTool !== 'cfs-door') return
      const scene = useScene.getState()
      const nodes = scene.nodes as unknown as Record<string, AnyNode | undefined>
      const result = processToolClick({
        nodes,
        wall: event.node,
        clickWallLocalX_m: event.localPosition[0],
        openingType: 'door',
        defaults: DOOR_DEFAULTS,
        generateId: () => generateUuid() as unknown as CFSOpeningId,
      })
      if (!result.ok) return
      scene.createNode(result.payload as unknown as AnyNode, result.framingId)
      event.stopPropagation()
    }

    emitter.on('wall:click', onWallClick)
    return () => {
      emitter.off('wall:click', onWallClick)
    }
  }, [])

  return null
}
