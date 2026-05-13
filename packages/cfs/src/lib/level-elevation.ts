// World-space y-elevation (mm) of the level a given wall belongs to.
//
// Mirrors Pascal's stacking logic from
// `packages/viewer/src/systems/level/level-utils.ts` (function
// `snapLevelsToTruePositions`) without depending on the viewer package:
// levels under the same building are sorted by their `level` index,
// each level's height is the max of its children's `height` (ceilings +
// walls) or a 2.5 m default, and the target level's y is the cumulative
// sum of preceding levels' heights.
//
// Per-wall slab thickness participates in the level height the same
// way it does in Pascal: a wall that sits on a 150 mm slab contributes
// `slab + wallHeight` to its level's top, not just `wallHeight`. The
// optional `slabElevation` argument supplies the per-wall slab
// thickness; tests inject a stub (`() => 0`) to stay headless. At
// runtime `framing-pass.ts` passes `slabElevationFromManager` so the
// level-stacking math matches Pascal's wall placement exactly.
//
// Used by the framing pass so CFS members on upper-level walls receive
// the correct world y (otherwise they pile on top of the ground floor
// — the original Slice 9 release bug).

import type { SceneLike } from './scene-walk'
import { levelOf } from './scene-walk'
import type { SlabElevationForWallFn } from './slab-elevation'

/** Pascal's `DEFAULT_LEVEL_HEIGHT` from `level-utils.ts` (2.5 m, in mm). */
export const DEFAULT_LEVEL_HEIGHT_MM = 2500

const NO_SLAB: SlabElevationForWallFn = () => 0

/**
 * Returns the world-space y of the level that owns `wallId`, in mm.
 * 0 when the wall is on the ground level, or when the chain to a
 * building can't be resolved.
 */
export function wallLevelElevation_mm(
  scene: SceneLike,
  wallId: string,
  slabElevation: SlabElevationForWallFn = NO_SLAB,
): number {
  const levelId = levelOf(scene, wallId)
  if (!levelId) return 0
  return levelElevation_mm(scene, levelId, slabElevation)
}

/** Returns the world-space y of `levelId`, in mm. */
export function levelElevation_mm(
  scene: SceneLike,
  levelId: string,
  slabElevation: SlabElevationForWallFn = NO_SLAB,
): number {
  const level = scene.nodes[levelId] as
    | { parentId?: string | null; level?: number }
    | undefined
  if (!level || level.parentId == null) return 0
  const building = scene.nodes[level.parentId] as
    | { children?: string[] }
    | undefined
  if (!building?.children) return 0

  const targetIndex = level.level ?? 0

  let cumulative = 0
  // Collect every sibling level + its index, sort ascending.
  const siblings: Array<{ id: string; index: number }> = []
  for (const childId of building.children) {
    const sib = scene.nodes[childId] as
      | { type?: string; level?: number }
      | undefined
    if (sib?.type === 'level') {
      siblings.push({ id: childId, index: sib.level ?? 0 })
    }
  }
  siblings.sort((a, b) => a.index - b.index)

  for (const sib of siblings) {
    if (sib.id === levelId) break
    // Tie-break: if two levels share an index, fall back to id order so
    // the result is still deterministic. Pascal allows duplicate indices
    // in edge cases (`Add level above` reuses indices briefly).
    if (sib.index === targetIndex && sib.id !== levelId) continue
    cumulative += levelHeight_mm(scene, sib.id, slabElevation)
  }
  return cumulative
}

/** Returns the floor-to-floor height of a single level, in mm. */
export function levelHeight_mm(
  scene: SceneLike,
  levelId: string,
  slabElevation: SlabElevationForWallFn = NO_SLAB,
): number {
  const level = scene.nodes[levelId] as { children?: string[] } | undefined
  if (!level?.children) return DEFAULT_LEVEL_HEIGHT_MM

  let maxTopMm = 0
  for (const childId of level.children) {
    const child = scene.nodes[childId] as
      | { type?: string; height?: number }
      | undefined
    if (!child) continue
    if (child.type !== 'ceiling' && child.type !== 'wall') continue
    const h_mm = (child.height ?? 0) * 1000
    // Walls sit on top of any slab beneath them; the slab thickness adds
    // to the wall's contribution to this level's top. Pascal clamps a
    // negative meshY to 0 in `level-utils.ts`, so we do too — walls that
    // extend below the level base do not pull the level top down.
    const baseY_mm =
      child.type === 'wall' ? Math.max(0, slabElevation(childId)) : 0
    const top_mm = baseY_mm + h_mm
    if (top_mm > maxTopMm) maxTopMm = top_mm
  }
  return maxTopMm > 0 ? maxTopMm : DEFAULT_LEVEL_HEIGHT_MM
}
