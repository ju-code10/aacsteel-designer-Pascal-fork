/**
 * §5.4 / §1.5 — placement-rule thresholds and reason-string templates for the
 * service-hole compliance validator.
 *
 * The four rules R1–R4 are the v1 contract. The numeric thresholds below are
 * the placeholders specified in §5.4; the appendix A.4 routes confirmation of
 * the exact AISI clause numbers and any threshold corrections to this build
 * slice. Updating the citation is a single-file edit here — validator logic
 * never sees the strings.
 *
 * TODO(slice-6-followup): replace `clauseRef` strings with the exact clause
 * citations from the current edition of AISI S100 / S220 / S240 once the
 * standards are at hand. The validator's *shape* is final; only these
 * constants change.
 */

export interface AISIRule {
  readonly id: 'R1' | 'R2' | 'R3' | 'R4'
  readonly description: string
  readonly clauseRef: string
}

export const AISI_R1: AISIRule = {
  id: 'R1',
  description: 'minimum 305 mm from member end',
  clauseRef: 'AISI S220/S240, clause TBD',
}

export const AISI_R2: AISIRule = {
  id: 'R2',
  description: 'maximum hole width as fraction of web depth',
  clauseRef: 'AISI S100, clause TBD',
}

export const AISI_R3: AISIRule = {
  id: 'R3',
  description: 'minimum spacing between holes (and mill pre-punches)',
  clauseRef: 'AISI S220/S240, clause TBD',
}

export const AISI_R4: AISIRule = {
  id: 'R4',
  description: 'web stiffener required above threshold',
  clauseRef: 'AISI S100, clause TBD',
}

// ───── R1: minimum end distance ──────────────────────────────────────────────
export const R1_MIN_END_DISTANCE_MM = 305

// ───── R2: maximum hole width as fraction of web depth ───────────────────────
export const R2_MAX_WIDTH_FRACTION_OF_WEB = 0.65

// ───── R3: minimum center-to-center spacing as multiple of larger hole length ─
export const R3_SPACING_MULTIPLIER = 2

// ───── R4: width fraction above which a stiffener is required ────────────────
export const R4_STIFFENER_THRESHOLD_FRACTION = 0.5

// ───── Reason-string templates ───────────────────────────────────────────────
// All numbers are surfaced in the final string so the user sees actual values,
// not just rule names (matches §7.4.7 verdict block).

export function r1Reason(distFromEnd_mm: number): string {
  return `hole within ${Math.round(distFromEnd_mm)} mm of member end; required ≥ ${R1_MIN_END_DISTANCE_MM} mm (${AISI_R1.clauseRef})`
}

export function r2Reason(width_mm: number, webDepth_mm: number): string {
  const pct = Math.round(R2_MAX_WIDTH_FRACTION_OF_WEB * 100)
  return `hole width ${round1(width_mm)} mm exceeds ${pct}% of web depth ${round1(webDepth_mm)} mm (${AISI_R2.clauseRef})`
}

export function r3Reason(
  centerDist_mm: number,
  otherPos_mm: number,
  minSpacing_mm: number,
  source: 'detailer' | 'mill',
): string {
  const otherLabel = source === 'mill' ? 'mill pre-punch' : 'adjacent hole'
  return `spacing ${Math.round(centerDist_mm)} mm to ${otherLabel} at ${Math.round(otherPos_mm)} mm < required ${Math.round(minSpacing_mm)} mm (${AISI_R3.clauseRef})`
}

export function r4Reason(width_mm: number, webDepth_mm: number): string {
  const pct = Math.round(R4_STIFFENER_THRESHOLD_FRACTION * 100)
  return `hole width ${round1(width_mm)} mm > ${pct}% of web depth ${round1(webDepth_mm)} mm requires web stiffener (${AISI_R4.clauseRef})`
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
