/**
 * Pure helpers shared by `CFSDoorTool` and `CFSWindowTool`. Kept headless so
 * the logic is unit-testable without a Three.js scene.
 *
 * The tools subscribe to Pascal's wall events (`wall:click` from the global
 * `emitter`). For each click on a wall when the corresponding CFS tool is
 * active, the helpers here convert the wall-local meter coordinate into a
 * snapped wall-local millimetre coordinate, validate the resulting opening
 * fits the wall, and produce a `CFSOpening` payload ready to feed into
 * `useScene.createNode`.
 */

import { CFSOpening } from '@pascal-app/cfs'
import type {
  AnyNode,
  AnyNodeId,
} from '@pascal-app/core'
import type { CFSOpeningId, CFSWallFraming, CFSWallFramingId } from '@pascal-app/cfs'

const M_TO_MM = 1000
export const POSITION_SNAP_MM = 50

export interface OpeningDefaults {
  width_mm: number
  height_mm: number
  /** Required for windows, ignored for doors. */
  sillHeight_mm?: number
}

/** Pascal default rough-opening sizes from §1.2 (canonical wall) and common practice. */
export const DOOR_DEFAULTS: OpeningDefaults = {
  width_mm: 900,
  height_mm: 2100,
}

export const WINDOW_DEFAULTS: OpeningDefaults = {
  width_mm: 900,
  height_mm: 1200,
  sillHeight_mm: 900,
}

export interface ToolWallContext {
  /** Pascal wall length in metres (from `Math.hypot(end - start)`). */
  wallLength_m: number
  /** All existing openings on this wall's framing, in mm. */
  existingOpenings: ReadonlyArray<{
    positionAlongWall_mm: number
    width_mm: number
  }>
}

export interface PlacementInput {
  /** Wall-local x of the click in metres (Pascal `event.localPosition[0]`). */
  clickWallLocalX_m: number
  defaults: OpeningDefaults
  context: ToolWallContext
  snapDisabled?: boolean
}

export type PlacementResult =
  | { ok: true; positionAlongWall_mm: number }
  | { ok: false; reason: 'outside-wall' | 'overlaps-existing' }

/**
 * Convert a Pascal wall-click event into a snapped wall-local millimetre
 * position for the *left edge* of the rough opening. The click point becomes
 * the *centre* of the rough opening; the left edge is `clickX - width/2`.
 *
 * Returns ok=false when the resulting opening would extend past either end of
 * the wall or would overlap an existing opening.
 */
export function placeOpeningOnWall(input: PlacementInput): PlacementResult {
  const { clickWallLocalX_m, defaults, context, snapDisabled } = input
  const wallLength_mm = context.wallLength_m * M_TO_MM
  const clickX_mm = clickWallLocalX_m * M_TO_MM
  const width = defaults.width_mm

  // The click selects the rough-opening centre; left edge is centre - width/2.
  const idealLeftX_mm = clickX_mm - width / 2

  // Snap. We snap the *position* (left edge) so members don't end up on
  // sub-millimetre offsets when the user taps near a stud-spacing tick.
  const snapped = snapDisabled
    ? idealLeftX_mm
    : Math.round(idealLeftX_mm / POSITION_SNAP_MM) * POSITION_SNAP_MM

  // Clamp inside the wall: opening must be fully contained.
  if (snapped < 0) return { ok: false, reason: 'outside-wall' }
  if (snapped + width > wallLength_mm) return { ok: false, reason: 'outside-wall' }

  // Reject overlap with any existing opening.
  for (const o of context.existingOpenings) {
    const oLeft = o.positionAlongWall_mm
    const oRight = oLeft + o.width_mm
    const newRight = snapped + width
    if (snapped < oRight && newRight > oLeft) {
      return { ok: false, reason: 'overlaps-existing' }
    }
  }

  return { ok: true, positionAlongWall_mm: snapped }
}

export interface BuildOpeningInput {
  framingId: CFSWallFramingId
  openingType: 'door' | 'window'
  positionAlongWall_mm: number
  defaults: OpeningDefaults
  generateId: () => CFSOpeningId
}

/** Construct a fully-typed `CFSOpening` ready for `useScene.createNode`. */
export function buildOpeningPayload(input: BuildOpeningInput) {
  const { framingId, openingType, positionAlongWall_mm, defaults, generateId } = input
  return CFSOpening.parse({
    type: 'cfs_opening',
    id: generateId(),
    parentId: framingId,
    openingType,
    positionAlongWall_mm,
    roughDimensions: { width_mm: defaults.width_mm, height_mm: defaults.height_mm },
    sillHeight_mm: openingType === 'window' ? defaults.sillHeight_mm : undefined,
    headerTypeOverride: null,
    generatedMemberIds: [],
  })
}

/** Find a `cfs_wall_framing` child of a wall in the scene nodes map. */
export function findFramingForWall(
  nodes: Record<string, AnyNode | undefined>,
  wallId: string,
): CFSWallFraming | undefined {
  for (const n of Object.values(nodes)) {
    if (!n) continue
    if ((n as { type?: string }).type !== 'cfs_wall_framing') continue
    if ((n as { parentId?: string }).parentId === wallId) {
      return n as unknown as CFSWallFraming
    }
  }
  return undefined
}

/** Collect existing openings for a framing so the placement validator can check overlap. */
export function existingOpeningsForFraming(
  nodes: Record<string, AnyNode | undefined>,
  framingId: string,
): { positionAlongWall_mm: number; width_mm: number }[] {
  const out: { positionAlongWall_mm: number; width_mm: number }[] = []
  for (const n of Object.values(nodes)) {
    if (!n) continue
    if ((n as { type?: string }).type !== 'cfs_opening') continue
    if ((n as { parentId?: string }).parentId !== framingId) continue
    const o = n as unknown as {
      positionAlongWall_mm: number
      roughDimensions: { width_mm: number }
    }
    out.push({
      positionAlongWall_mm: o.positionAlongWall_mm,
      width_mm: o.roughDimensions.width_mm,
    })
  }
  return out
}

export interface ProcessClickInput {
  /** Current scene nodes (read-only access). */
  nodes: Record<string, AnyNode | undefined>
  /** Pascal wall the click hit. */
  wall: {
    id: string
    start: readonly [number, number]
    end: readonly [number, number]
  }
  /** Pascal wall-local x of the click in metres. */
  clickWallLocalX_m: number
  openingType: 'door' | 'window'
  defaults: OpeningDefaults
  snapDisabled?: boolean
  generateId: () => CFSOpeningId
}

export type ProcessClickResult =
  | { ok: true; framingId: AnyNodeId; payload: ReturnType<typeof buildOpeningPayload> }
  | { ok: false; reason: 'no-framing' | 'outside-wall' | 'overlaps-existing' }

/**
 * Pure end-to-end click handler. Given a click on a wall and the current
 * scene nodes, returns either a ready-to-create opening payload or a reason
 * we declined to create one. The component shells (`CFSDoorTool`,
 * `CFSWindowTool`) call this and forward the payload to
 * `useScene.createNode`.
 */
export function processToolClick(input: ProcessClickInput): ProcessClickResult {
  const { nodes, wall, clickWallLocalX_m, openingType, defaults, snapDisabled, generateId } =
    input
  const framing = findFramingForWall(nodes, wall.id)
  if (!framing) return { ok: false, reason: 'no-framing' }

  const wallLength_m = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  const placement = placeOpeningOnWall({
    clickWallLocalX_m,
    defaults,
    context: {
      wallLength_m,
      existingOpenings: existingOpeningsForFraming(
        nodes,
        framing.id as unknown as string,
      ),
    },
    snapDisabled,
  })
  if (!placement.ok) return { ok: false, reason: placement.reason }

  const payload = buildOpeningPayload({
    framingId: framing.id as unknown as CFSWallFramingId,
    openingType,
    positionAlongWall_mm: placement.positionAlongWall_mm,
    defaults,
    generateId,
  })
  return { ok: true, framingId: framing.id as unknown as AnyNodeId, payload }
}
