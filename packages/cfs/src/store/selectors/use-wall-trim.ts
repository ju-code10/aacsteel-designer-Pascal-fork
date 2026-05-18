'use client'

import type { AnyNode } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import { useMemo } from 'react'
import {
  chordPositionFromWorld,
  wallDirection,
} from '../../lib/corner-detect'
import {
  computeWallTrim,
  type JunctionPeer,
  type WallTrim,
} from '../../lib/corner-trim'
import {
  type PascalWallLike,
  localToWorld,
  wallLengthFromPascalWall,
} from '../../lib/wall-frame'
import { wallLevelElevation_mm } from '../../lib/level-elevation'
import { makeSlabElevationFn } from '../../lib/slab-elevation'
import type { SceneLike } from '../../lib/scene-walk'
import type { CFSWallFraming } from '../../schema/cfs-wall-framing'
import { getActiveLibrary, getProjectSettings } from '../selectors'
import { useCFS } from '../use-cfs'

/**
 * Live junction classification for one framing — for the inspector readout.
 * Computed from scene state directly; not persisted on the node.
 *
 * Returns `null` if the framing or its wall cannot be resolved, or when no
 * library/settings are loaded (the trim depends on the through wall's stud
 * web depth, which we cannot resolve without a library).
 */
export function useWallTrim(framingId: string | null): WallTrim | null {
  const nodes = useScene((state) => state.nodes) as unknown as Record<string, AnyNode>
  const memberLibraries = useCFS((state) => state.memberLibraries)
  const activeLibraryId = useCFS((state) => state.activeLibraryId)
  void memberLibraries
  void activeLibraryId
  return useMemo(() => {
    if (!framingId) return null
    const cfsState = useCFS.getState()
    const library = getActiveLibrary(cfsState)
    if (!library) return null

    const framing = nodes[framingId] as unknown as CFSWallFraming | undefined
    if (!framing || (framing as { type?: string }).type !== 'cfs_wall_framing') return null
    const wall = nodes[framing.parentId as unknown as string] as unknown as
      | PascalWallLike
      | undefined
    if (!wall || !wall.start || !wall.end) return null

    const sceneLike = { nodes } as unknown as SceneLike
    const settings = getProjectSettings(
      useScene.getState() as unknown as Parameters<typeof getProjectSettings>[0],
    )
    if (!settings) return null
    const slabFn = makeSlabElevationFn(sceneLike)

    const elevation_mm =
      wallLevelElevation_mm(sceneLike, wall.id, slabFn) +
      Math.max(0, slabFn(wall.id))

    const length_mm = wallLengthFromPascalWall(wall)
    const ownStart = chordPositionFromWorld(
      localToWorld(wall, { x_mm: 0, y_mm: 0, z_mm: 0 }, elevation_mm),
    )
    const ownEnd = chordPositionFromWorld(
      localToWorld(wall, { x_mm: length_mm, y_mm: 0, z_mm: 0 }, elevation_mm),
    )
    const ownDirection = wallDirection(wall)

    // Walk the scene once to find peers; track our own insertion index in
    // the same pass so the "first-placed runs through" tie-break stays
    // consistent with the framing pass.
    const peers: JunctionPeer[] = []
    let ownSceneIndex = -1
    let index = -1
    for (const n of Object.values(nodes)) {
      if ((n as { type?: string }).type !== 'cfs_wall_framing') continue
      index += 1
      const peerFraming = n as unknown as CFSWallFraming
      if (peerFraming.id === framingId) {
        ownSceneIndex = index
        continue
      }
      const peerWall = nodes[peerFraming.parentId as unknown as string] as unknown as
        | PascalWallLike
        | undefined
      if (!peerWall || !peerWall.start || !peerWall.end) continue
      const peerLength_mm = wallLengthFromPascalWall(peerWall)
      if (peerLength_mm === 0) continue
      const sectionId = peerFraming.studSectionId ?? settings.defaultStudSection
      const section = library.sections.find((s) => s.id === sectionId)
      const defaultSection = library.sections.find(
        (s) => s.id === settings.defaultStudSection,
      )
      const webDepth_mm =
        section?.properties.webDepth_mm ??
        defaultSection?.properties.webDepth_mm ??
        0
      const peerElevation_mm =
        wallLevelElevation_mm(sceneLike, peerWall.id, slabFn) +
        Math.max(0, slabFn(peerWall.id))
      peers.push({
        framingId: peerFraming.id,
        sceneIndex: index,
        start: chordPositionFromWorld(
          localToWorld(peerWall, { x_mm: 0, y_mm: 0, z_mm: 0 }, peerElevation_mm),
        ),
        end: chordPositionFromWorld(
          localToWorld(
            peerWall,
            { x_mm: peerLength_mm, y_mm: 0, z_mm: 0 },
            peerElevation_mm,
          ),
        ),
        direction: wallDirection(peerWall),
        studWebDepth_mm: webDepth_mm,
      })
    }

    return computeWallTrim({
      ownFramingId: framingId,
      ownSceneIndex,
      ownStart,
      ownEnd,
      ownDirection,
      peers,
    })
  }, [nodes, framingId])
}
