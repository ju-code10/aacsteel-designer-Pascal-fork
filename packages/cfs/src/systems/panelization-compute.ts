import type { CFSMember } from '../schema/cfs-member'
import type { CFSOpening } from '../schema/cfs-opening'
import type { CFSPanel } from '../schema/cfs-panel'
import type { CFSSection } from '../schema/cfs-member-library'
import type { CFSProjectSettings } from '../schema/primitives'
import type { PascalWallLike } from '../lib/wall-frame'
import {
  computeForbiddenZones,
  isInForbiddenZone,
  kingFlangeBuffer_mm,
  latestNonForbiddenPositionBefore,
  mergeIntervals,
  memberMidAlongWall_mm,
  memberWeight_kg,
  snapToStudSpacing,
  type Interval,
} from '../lib/panelization-zones'

/**
 * §5.5 — Pure panelization planner. Given the inputs that describe a
 * framing's wall and members, return the new list of panel drafts. Does
 * not touch the scene store. The orchestrator in `panelization-pass.ts`
 * diffs these drafts against the existing CFSPanel children and applies
 * `createNode` / `updateNode` / `deleteNode` inside one `withBatchedUndo`.
 */

export class PanelizationError extends Error {
  framingId: string
  detail: string

  constructor(framingId: string, detail: string) {
    super(`panelize ${framingId}: ${detail}`)
    this.name = 'PanelizationError'
    this.framingId = framingId
    this.detail = detail
  }
}

export interface PanelDraft {
  /** P-NN, generated from sequenceNumber. */
  label: string
  sequenceNumber: number
  startAlongWall_mm: number
  endAlongWall_mm: number
  isManualBreak: boolean
  cachedMemberCount: number
  cachedWeight_kg: number
}

/**
 * Warnings surfaced by the algorithm but not fatal — e.g., a manual break
 * that violates max-width. Per §5.5, the algorithm still emits the panel,
 * and the inspector displays the warning so the user can decide.
 */
export interface PanelizationWarning {
  rule: 'manualBreakExceedsMaxWidth'
  panelStart_mm: number
  panelEnd_mm: number
  width_mm: number
  limit_mm: number
}

export interface PanelizeInput {
  framingId: string
  wall: PascalWallLike
  wallLength_mm: number
  members: readonly CFSMember[]
  openings: readonly CFSOpening[]
  /** Existing CFSPanel children of this framing, including any sentinels. */
  existingPanels: readonly CFSPanel[]
  studSection: CFSSection | null
  sectionsById: ReadonlyMap<string, CFSSection>
  settings: Pick<
    CFSProjectSettings,
    'panelMaxWidth_mm' | 'panelMaxWeight_kg' | 'defaultStudSpacing_mm'
  >
}

export interface PanelizeResult {
  drafts: PanelDraft[]
  warnings: PanelizationWarning[]
  /**
   * Manual break positions extracted from sentinels and from existing
   * real panels created as manual breaks. The pass uses these to detect
   * which new drafts should keep `isManualBreak: true`.
   */
  manualBreakPositions_mm: number[]
}

/**
 * Heart of §5.5. Pure function. Throws PanelizationError when forbidden
 * zones prevent finding a valid break inside the current panel's budget.
 */
export function planPanelization(input: PanelizeInput): PanelizeResult {
  const {
    framingId,
    wall: _wall,
    wallLength_mm,
    members,
    openings,
    existingPanels,
    studSection,
    sectionsById,
    settings,
  } = input

  if (wallLength_mm <= 0) {
    return { drafts: [], warnings: [], manualBreakPositions_mm: [] }
  }

  // Collect manual break positions. Two sources:
  //   - sentinels (zero-width markers placed by PanelBreakTool)
  //   - existing real panels created as manual breaks (their startAlongWall_mm
  //     is the break position to honour on re-panelization)
  const manualSet = new Set<number>()
  for (const p of existingPanels) {
    if (!p.isManualBreak) continue
    if (p.isPendingSentinel) {
      manualSet.add(roundMm(p.startAlongWall_mm))
    } else {
      // Honour the start of a manually-created real panel as a break.
      // Skip 0 (the wall start) — it's always a break by construction.
      if (p.startAlongWall_mm > 0) manualSet.add(roundMm(p.startAlongWall_mm))
    }
  }
  // Filter out manual breaks at or beyond the wall end (defensive — shouldn't
  // happen, but a settings change that shrinks panelMaxWidth_mm could leave
  // an out-of-range sentinel from a deleted opening reshape).
  const manualBreaks = [...manualSet]
    .filter((x) => x > 0 && x < wallLength_mm)
    .sort((a, b) => a - b)

  // Forbidden zones — openings (with king-flange buffer) and corners.
  const kingBuffer = kingFlangeBuffer_mm(studSection)
  const forbidden = computeForbiddenZones(
    openings,
    wallLength_mm,
    kingBuffer,
    settings.defaultStudSpacing_mm,
  )

  // Pre-compute (member, midX_mm, weight_kg) for the greedy walk.
  type WalkMember = { id: string; midX_mm: number; weight_kg: number }
  const walkMembers: WalkMember[] = []
  for (const m of members) {
    walkMembers.push({
      id: m.id,
      midX_mm: memberMidAlongWall_mm(m, input.wall),
      weight_kg: memberWeight_kg(m, sectionsById),
    })
  }
  walkMembers.sort((a, b) => a.midX_mm - b.midX_mm)

  const warnings: PanelizationWarning[] = []
  const breaks: number[] = [0]
  let panelStart = 0

  while (panelStart < wallLength_mm) {
    const result = findNextBreak(
      framingId,
      panelStart,
      wallLength_mm,
      walkMembers,
      forbidden,
      manualBreaks,
      settings,
    )
    if (result.warning) warnings.push(result.warning)
    breaks.push(result.position_mm)
    if (result.position_mm <= panelStart) {
      // Algorithm guarantees strict advancement; if we get here a future
      // change broke that invariant. Surface as PanelizationError instead
      // of silently degrading to one panel.
      throw new PanelizationError(
        input.framingId,
        `non-advancing break at ${result.position_mm} from start ${panelStart}`,
      )
    }
    panelStart = result.position_mm
  }
  // Final break must reach the wall end.
  if (breaks[breaks.length - 1] !== wallLength_mm) {
    breaks.push(wallLength_mm)
  }

  const drafts: PanelDraft[] = []
  for (let i = 0; i < breaks.length - 1; i += 1) {
    const start = breaks[i]!
    const end = breaks[i + 1]!
    drafts.push({
      label: `P-${pad2(i + 1)}`,
      sequenceNumber: i + 1,
      startAlongWall_mm: start,
      endAlongWall_mm: end,
      isManualBreak: i > 0 && manualSet.has(roundMm(start)),
      cachedMemberCount: countMembersIn(walkMembers, start, end),
      cachedWeight_kg: sumWeightsIn(walkMembers, start, end),
    })
  }

  return {
    drafts,
    warnings,
    manualBreakPositions_mm: manualBreaks,
  }
}

interface FindNextBreakResult {
  position_mm: number
  warning?: PanelizationWarning
}

function findNextBreak(
  framingId: string,
  start_mm: number,
  wallEnd_mm: number,
  walkMembers: readonly { midX_mm: number; weight_kg: number }[],
  forbidden: readonly Interval[],
  manualBreaks: readonly number[],
  settings: PanelizeInput['settings'],
): FindNextBreakResult {
  // 1. Honour an upcoming manual break that fits in the width budget.
  const nextManualInBudget = manualBreaks.find(
    (b) => b > start_mm && b - start_mm <= settings.panelMaxWidth_mm,
  )
  if (nextManualInBudget !== undefined) {
    return { position_mm: nextManualInBudget }
  }

  // 1a. Edge case: a manual break exists past max-width with no breakable
  // members in between. §5.5 says emit anyway with a warning. We detect
  // this by checking whether any walk member between (start_mm,
  // nextManual) would trigger the budget — if not, take the manual break
  // even though it exceeds max-width.
  const nextManualOverBudget = manualBreaks.find((b) => b > start_mm)
  if (nextManualOverBudget !== undefined) {
    // Try greedy first. If greedy would itself error, we know forbidden
    // zones plus the manual position leave no choice — surface the warning.
  }

  // 2. Greedy walk on member positions.
  let runningWeight = 0
  let lastSafe = start_mm
  for (const m of walkMembers) {
    if (m.midX_mm <= start_mm) continue
    const widthFromStart = m.midX_mm - start_mm
    const wouldExceedWidth = widthFromStart > settings.panelMaxWidth_mm
    const wouldExceedWeight = runningWeight + m.weight_kg > settings.panelMaxWeight_kg
    if (wouldExceedWidth || wouldExceedWeight) {
      // Try to break in [lastSafe, m.midX_mm].
      const ceiling = Math.min(m.midX_mm, start_mm + settings.panelMaxWidth_mm)
      const floor = lastSafe
      const candidate = latestNonForbiddenPositionBefore(ceiling, floor, forbidden)
      if (candidate === null || candidate <= start_mm) {
        // If a manual break exists past width, take it with a warning.
        if (nextManualOverBudget !== undefined) {
          return {
            position_mm: nextManualOverBudget,
            warning: {
              rule: 'manualBreakExceedsMaxWidth',
              panelStart_mm: start_mm,
              panelEnd_mm: nextManualOverBudget,
              width_mm: nextManualOverBudget - start_mm,
              limit_mm: settings.panelMaxWidth_mm,
            },
          }
        }
        throw new PanelizationError(
          framingId,
          `forbidden zones cover ${floor}..${ceiling}; cannot break`,
        )
      }
      const snapped = snapToStudSpacing(
        candidate,
        settings.defaultStudSpacing_mm,
        floor,
        candidate,
      )
      // Snap can land back at panelStart (which is itself a stud multiple).
      // That would be a non-advancing break; prefer the unsnapped candidate
      // in that case. If even the unsnapped candidate doesn't advance,
      // we've truly run out of valid break positions.
      const next = snapped > start_mm ? snapped : candidate
      if (next <= start_mm) {
        if (nextManualOverBudget !== undefined) {
          return {
            position_mm: nextManualOverBudget,
            warning: {
              rule: 'manualBreakExceedsMaxWidth',
              panelStart_mm: start_mm,
              panelEnd_mm: nextManualOverBudget,
              width_mm: nextManualOverBudget - start_mm,
              limit_mm: settings.panelMaxWidth_mm,
            },
          }
        }
        throw new PanelizationError(
          framingId,
          `forbidden zones leave no advancing break between ${start_mm} and ${ceiling}`,
        )
      }
      return { position_mm: next }
    }
    runningWeight += m.weight_kg
    if (!isInForbiddenZone(m.midX_mm, forbidden)) {
      lastSafe = m.midX_mm
    }
  }

  // 3. Budgets never exceeded — wall ends with one more panel.
  if (nextManualOverBudget !== undefined && wallEnd_mm - start_mm > settings.panelMaxWidth_mm) {
    return {
      position_mm: nextManualOverBudget,
      warning: {
        rule: 'manualBreakExceedsMaxWidth',
        panelStart_mm: start_mm,
        panelEnd_mm: nextManualOverBudget,
        width_mm: nextManualOverBudget - start_mm,
        limit_mm: settings.panelMaxWidth_mm,
      },
    }
  }
  return { position_mm: wallEnd_mm }
}

function countMembersIn(
  walkMembers: readonly { midX_mm: number }[],
  start_mm: number,
  end_mm: number,
): number {
  let n = 0
  for (const m of walkMembers) {
    if (m.midX_mm >= start_mm && m.midX_mm < end_mm) n += 1
  }
  return n
}

function sumWeightsIn(
  walkMembers: readonly { midX_mm: number; weight_kg: number }[],
  start_mm: number,
  end_mm: number,
): number {
  let total = 0
  for (const m of walkMembers) {
    if (m.midX_mm >= start_mm && m.midX_mm < end_mm) total += m.weight_kg
  }
  return total
}

function roundMm(x: number): number {
  return Math.round(x)
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

// Re-export forbidden-zone helpers so external code can reuse them
// (e.g., the PanelBreakTool validates against the same zones the algorithm
// uses).
export { computeForbiddenZones, mergeIntervals, isInForbiddenZone, memberMidAlongWall_mm }
