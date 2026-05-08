'use client'

import type { AnyNode } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import { useMemo } from 'react'
import type { CFSOpening } from '../../schema/cfs-opening'

const EMPTY: ReadonlyArray<CFSOpening> = Object.freeze([])

/**
 * Returns the child openings of a `cfs_wall_framing` sorted by
 * `positionAlongWall_mm`. Subscribes only to `state.nodes` and memoizes by
 * (nodes ref, framingId) so consumers in a render tree do not re-run on
 * unrelated scene changes.
 */
export function useOpeningsForFraming(framingId: string | null): readonly CFSOpening[] {
  const nodes = useScene((s) => s.nodes) as unknown as Record<string, AnyNode>
  return useMemo(() => {
    if (!framingId) return EMPTY
    const out: CFSOpening[] = []
    for (const n of Object.values(nodes)) {
      if (
        (n as { type?: string }).type === 'cfs_opening' &&
        (n as { parentId?: string }).parentId === framingId
      ) {
        out.push(n as unknown as CFSOpening)
      }
    }
    if (out.length === 0) return EMPTY
    out.sort((a, b) => a.positionAlongWall_mm - b.positionAlongWall_mm)
    return out
  }, [nodes, framingId])
}

/**
 * Imperative variant for systems that already have a scene state in hand
 * (no React subscription). Used by tests and the framing pass.
 */
export function getOpeningsForFraming(
  nodes: Record<string, AnyNode>,
  framingId: string,
): CFSOpening[] {
  const out: CFSOpening[] = []
  for (const n of Object.values(nodes)) {
    if (
      (n as { type?: string }).type === 'cfs_opening' &&
      (n as { parentId?: string }).parentId === framingId
    ) {
      out.push(n as unknown as CFSOpening)
    }
  }
  out.sort((a, b) => a.positionAlongWall_mm - b.positionAlongWall_mm)
  return out
}
