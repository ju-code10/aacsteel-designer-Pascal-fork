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
  WINDOW_DEFAULTS,
  processToolClick,
} from './lib/opening-tool-base'

function generateUuid(): string {
  const c: { randomUUID?: () => string } = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto ?? {}
  if (typeof c.randomUUID === 'function') return c.randomUUID()
  const hex = (n: number) => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, '0')
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`
}

/** Mirror of `CFSDoorTool` for windows; defaults include a 900 mm sill height. */
export function CFSWindowTool(): null {
  useEffect(() => {
    const onWallClick = (event: WallEvent) => {
      if (useCFS.getState().activeTool !== 'cfs-window') return
      const scene = useScene.getState()
      const nodes = scene.nodes as unknown as Record<string, AnyNode | undefined>
      const result = processToolClick({
        nodes,
        wall: event.node,
        clickWallLocalX_m: event.localPosition[0],
        openingType: 'window',
        defaults: WINDOW_DEFAULTS,
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
