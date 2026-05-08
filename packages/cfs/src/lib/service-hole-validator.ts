import type { CFSMember } from '../schema/cfs-member'
import { cfsMemberLength_mm } from '../schema/cfs-member'
import type { CFSSection } from '../schema/cfs-member-library'
import type { CFSServiceHole } from '../schema/cfs-service-hole'
import type {
  CFSComplianceVerdict,
  CFSPrePunchPattern,
} from '../schema/primitives'
import {
  R1_MIN_END_DISTANCE_MM,
  R2_MAX_WIDTH_FRACTION_OF_WEB,
  R3_SPACING_MULTIPLIER,
  R4_STIFFENER_THRESHOLD_FRACTION,
  r1Reason,
  r2Reason,
  r3Reason,
  r4Reason,
} from './aisi-thresholds'

/**
 * §5.4 — pure validator for `CFSServiceHole` placement against AISI rules.
 *
 * The function takes everything it needs by value (no store reads, no scene
 * graph traversal) so it can be reused by:
 *   - `CFSServiceHoleSystem` to compute the persisted verdict
 *   - `ServiceHoleTool` ghost preview to color the cursor live
 *   - Unit tests, with no Three.js or React in the way.
 *
 * The four rules R1–R4 each return either a reason string (failure) or null
 * (pass). The composite `validateServiceHole` runs them all and assembles a
 * `CFSComplianceVerdict` whose `reasons` array carries every failure in
 * stable order R1, R2, R3, R4. A hole that fails multiple rules surfaces all
 * violations to the user in one render, so they fix in one pass.
 */

export interface PrePunch {
  positionAlongMember_mm: number
  /** Length along the member axis. SSMA stock: 102 mm. */
  length_mm: number
  /** Width across the web. SSMA stock: 38 mm. */
  width_mm: number
}

export interface ServiceHoleValidatorInput {
  hole: CFSServiceHole
  member: CFSMember
  section: CFSSection
  /** Other detailer holes on the same member, excluding `hole` itself. */
  siblingHoles: readonly CFSServiceHole[]
  /** Mill pre-punches expanded from `section.prePunchPattern`. */
  millPrePunches: readonly PrePunch[]
  /** Injected for deterministic tests. Production passes `() => new Date().toISOString()`. */
  nowIso: () => string
}

/**
 * Run all four placement rules on `hole` and return the assembled verdict.
 *
 * Pure: identical inputs ⇒ identical outputs (modulo `nowIso`, which is
 * injected). No mutation of any argument.
 */
export function validateServiceHole(
  input: ServiceHoleValidatorInput,
): CFSComplianceVerdict {
  const reasons: string[] = []
  const r1 = checkR1End(input.hole, input.member)
  if (r1) reasons.push(r1)
  const r2 = checkR2Width(input.hole, input.section)
  if (r2) reasons.push(r2)
  const r3List = checkR3Spacing(
    input.hole,
    input.siblingHoles,
    input.millPrePunches,
  )
  for (const r of r3List) reasons.push(r)
  const r4 = checkR4Stiffener(input.hole, input.section)
  if (r4) reasons.push(r4)
  return {
    status: reasons.length === 0 ? 'compliant' : 'non-compliant',
    reasons,
    checkedAt: input.nowIso(),
  }
}

/** R1 — distance from either end of the member must be ≥ 305 mm. */
export function checkR1End(hole: CFSServiceHole, member: CFSMember): string | null {
  const memberLength = cfsMemberLength_mm(member)
  const distFromStart = hole.positionAlongMember_mm
  const distFromEnd = memberLength - hole.positionAlongMember_mm
  const closer = Math.min(distFromStart, distFromEnd)
  if (closer < R1_MIN_END_DISTANCE_MM) {
    return r1Reason(closer)
  }
  return null
}

/** R2 — effective width must not exceed 65% of web depth. */
export function checkR2Width(hole: CFSServiceHole, section: CFSSection): string | null {
  const width = effectiveWidth(hole)
  const webDepth = section.properties.webDepth_mm
  if (width > R2_MAX_WIDTH_FRACTION_OF_WEB * webDepth) {
    return r2Reason(width, webDepth)
  }
  return null
}

/**
 * R3 — center-to-center spacing must be ≥ 2 × max(this.length, other.length)
 * for every other hole, including mill pre-punches. May produce multiple
 * reasons if the hole conflicts with multiple neighbors; we surface them all
 * so the user sees the full picture.
 */
export function checkR3Spacing(
  hole: CFSServiceHole,
  siblingHoles: readonly CFSServiceHole[],
  millPrePunches: readonly PrePunch[],
): string[] {
  const reasons: string[] = []
  const myLen = holeLengthAlongMember(hole)
  const myPos = hole.positionAlongMember_mm

  for (const other of siblingHoles) {
    if (other.id === hole.id) continue
    const otherLen = holeLengthAlongMember(other)
    const otherPos = other.positionAlongMember_mm
    const centerDist = Math.abs(myPos - otherPos)
    const minSpacing = R3_SPACING_MULTIPLIER * Math.max(myLen, otherLen)
    if (centerDist > 0 && centerDist < minSpacing) {
      reasons.push(r3Reason(centerDist, otherPos, minSpacing, 'detailer'))
    }
  }

  for (const pp of millPrePunches) {
    const centerDist = Math.abs(myPos - pp.positionAlongMember_mm)
    const minSpacing = R3_SPACING_MULTIPLIER * Math.max(myLen, pp.length_mm)
    if (centerDist > 0 && centerDist < minSpacing) {
      reasons.push(
        r3Reason(centerDist, pp.positionAlongMember_mm, minSpacing, 'mill'),
      )
    }
  }
  return reasons
}

/** R4 — holes wider than 50% of web depth require an explicit stiffener. */
export function checkR4Stiffener(
  hole: CFSServiceHole,
  section: CFSSection,
): string | null {
  if (hole.hasStiffener) return null
  const width = effectiveWidth(hole)
  const webDepth = section.properties.webDepth_mm
  if (width > R4_STIFFENER_THRESHOLD_FRACTION * webDepth) {
    return r4Reason(width, webDepth)
  }
  return null
}

/**
 * The width that R2 / R4 measure: the dimension *across the web*. For a round
 * hole that is the diameter; for an oblong hole the diameter (oblongLength is
 * along the member axis, not across the web).
 *
 * Note on shape semantics: §3.8 oblong holes have `oblongLength_mm` along the
 * member axis and `diameter_mm` across the web. So R2 still keys off
 * `diameter_mm` for both shapes — the long axis of an oblong does not weaken
 * the web because it runs *along* the member.
 */
function effectiveWidth(hole: CFSServiceHole): number {
  return hole.diameter_mm
}

/**
 * The length the hole occupies *along the member axis*. R3 spacing is
 * measured center-to-center, with a minimum that scales with this length.
 *
 *   round  → diameter
 *   oblong → oblongLength_mm (validated > diameter by §3.12)
 */
export function holeLengthAlongMember(
  hole: Pick<CFSServiceHole, 'shape' | 'diameter_mm' | 'oblongLength_mm'>,
): number {
  if (hole.shape === 'oblong' && hole.oblongLength_mm !== undefined) {
    return hole.oblongLength_mm
  }
  return hole.diameter_mm
}

/**
 * Materialize a `prePunchPattern` (§3.3) into discrete `PrePunch` records,
 * one per actual factory hole on the member of the given length. The
 * validator's R3 check iterates over the resulting list.
 *
 * The pattern is symmetric about the member centerline: holes are placed
 * starting at `firstPosition_mm` from the start, every `spacing_mm` thereafter,
 * up to (but not including) `memberLength - firstPosition_mm`. This matches
 * the SSMA convention where the first and last factory holes are inset by
 * the same end distance from each end.
 *
 * Returns an empty array when the member is too short to fit any pre-punch
 * (member length ≤ 2 × firstPosition_mm).
 */
export function expandPrePunches(
  pattern: CFSPrePunchPattern | undefined,
  memberLength_mm: number,
): PrePunch[] {
  if (!pattern) return []
  if (memberLength_mm <= 0) return []
  const punches: PrePunch[] = []
  const limit = memberLength_mm - pattern.firstPosition_mm
  for (
    let pos = pattern.firstPosition_mm;
    pos <= limit;
    pos += pattern.spacing_mm
  ) {
    punches.push({
      positionAlongMember_mm: pos,
      length_mm: pattern.length_mm,
      width_mm: pattern.width_mm,
    })
  }
  return punches
}
