'use client'

import type { AnyNode } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import { useMemo } from 'react'
import type { CFSMember } from '../../schema/cfs-member'
import type { CFSWallFraming } from '../../schema/cfs-wall-framing'

export interface WallFramingSelection {
  wall: AnyNode | null
  framing: CFSWallFraming | null
  members: CFSMember[]
}

const EMPTY_SELECTION: WallFramingSelection = {
  wall: null,
  framing: null,
  members: [],
}

function nodeById(nodes: Record<string, AnyNode>, id: string): AnyNode | undefined {
  return (nodes as unknown as Record<string, AnyNode | undefined>)[id]
}

/**
 * Resolve the inspector subject for a Pascal `wall` id or a
 * `cfs_wall_framing` id.
 *
 * Subscribe to `state.nodes` (a primitive ref that changes only on scene
 * mutations) and derive the shape via `useMemo`. Returning a fresh object
 * literal *inside* a `useScene(selector)` would create a new ref on every
 * tick, breaking Zustand's reference-equality short-circuit and triggering
 * an infinite re-render loop in React 19's strict-mode dev environment.
 */
export function useWallFramingSelection(selectedId: string | null): WallFramingSelection {
  const nodes = useScene((state) => state.nodes) as unknown as Record<string, AnyNode>
  return useMemo(() => {
    if (!selectedId) return EMPTY_SELECTION
    const node = nodeById(nodes, selectedId)
    if (!node) return EMPTY_SELECTION

    let wallId: string | null = null
    let framingId: string | null = null
    if ((node as { type?: string }).type === 'wall') {
      wallId = (node as { id: string }).id
      for (const n of Object.values(nodes)) {
        if (
          (n as { type?: string }).type === 'cfs_wall_framing' &&
          (n as { parentId?: string }).parentId === wallId
        ) {
          framingId = (n as { id: string }).id
          break
        }
      }
    } else if ((node as { type?: string }).type === 'cfs_wall_framing') {
      framingId = (node as { id: string }).id
      const framing = node as unknown as CFSWallFraming
      wallId = framing.parentId as unknown as string
    } else {
      return EMPTY_SELECTION
    }

    const wall = wallId ? (nodeById(nodes, wallId) ?? null) : null
    const framing = framingId
      ? ((nodeById(nodes, framingId) as unknown as CFSWallFraming | undefined) ?? null)
      : null
    const members: CFSMember[] = []
    if (framingId) {
      for (const n of Object.values(nodes)) {
        if (
          (n as { type?: string }).type === 'cfs_member' &&
          (n as { parentId?: string }).parentId === framingId
        ) {
          members.push(n as unknown as CFSMember)
        }
      }
    }
    return { wall, framing, members }
  }, [nodes, selectedId])
}

/**
 * Group members by role for the inspector list. Stable iteration order.
 */
export function useMembersByRole(members: CFSMember[]): Map<CFSMember['role'], CFSMember[]> {
  return useMemo(() => {
    const map = new Map<CFSMember['role'], CFSMember[]>()
    const order: CFSMember['role'][] = [
      'top-track',
      'bottom-track',
      'chord-stud',
      'king-stud',
      'jamb-stud',
      'stud',
      'header',
      'sill',
      'sill-track',
      'cripple',
    ]
    for (const role of order) map.set(role, [])
    for (const m of members) {
      const list = map.get(m.role) ?? []
      list.push(m)
      map.set(m.role, list)
    }
    for (const role of order) {
      if (map.get(role)?.length === 0) map.delete(role)
    }
    return map
  }, [members])
}
