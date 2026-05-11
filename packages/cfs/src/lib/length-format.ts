// §6.0 — length formatting at the export display boundary.
//
// Stored data is floating-point millimetres. Rounding happens here, not in
// the schema. The three formatters cover the three columns the BOM/cut-list
// emit; the DXF exporter calls `lengthForUnits` directly and writes 4-dp
// inches or integer mm into the polyline coordinates.

const MM_PER_IN = 25.4

export function mmToIntegerMm(value_mm: number): number {
  return Math.round(value_mm)
}

export function mmToInches4dp(value_mm: number): number {
  return Math.round((value_mm / MM_PER_IN) * 10_000) / 10_000
}

/**
 * Format a length in mm as feet-inches-sixteenths, e.g. `9'-0 1/16"`. The
 * rule §6.0 prescribes: feet integer, inches integer, sixteenths reduced
 * to the smallest equivalent fraction (1/16, 1/8, 3/16, 1/4, …, 15/16).
 * `0/16` collapses to no fractional part; `16/16` rolls into the next inch.
 */
export function mmToFeetInchSixteenths(value_mm: number): string {
  const totalSixteenths = Math.round((value_mm / MM_PER_IN) * 16)
  const sign = totalSixteenths < 0 ? -1 : 1
  let s = Math.abs(totalSixteenths)
  const inchesTotal = Math.floor(s / 16)
  let sixteenths = s % 16
  const feet = Math.floor(inchesTotal / 12)
  let inches = inchesTotal % 12

  // No fractional part — `9'-0"`
  if (sixteenths === 0) {
    return `${sign < 0 ? '-' : ''}${feet}'-${inches}"`
  }

  // Reduce the sixteenths fraction.
  let num = sixteenths
  let den = 16
  while (num % 2 === 0 && den % 2 === 0) {
    num /= 2
    den /= 2
  }
  void s

  return `${sign < 0 ? '-' : ''}${feet}'-${inches} ${num}/${den}"`
}

/** Round to 2 decimal places — used for weights in kg and lb. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Round to 4 decimal places — used for inches columns and DXF coords. */
export function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

/** kg → lb (NIST avoirdupois conversion). */
export function kgToLb(kg: number): number {
  return kg * 2.20462
}

/** Convenience: format a length to the project's units. */
export function lengthForUnits(
  value_mm: number,
  units: 'metric' | 'imperial',
): number {
  return units === 'imperial' ? mmToInches4dp(value_mm) : mmToIntegerMm(value_mm)
}

export function unitsSuffix(units: 'metric' | 'imperial'): 'mm' | 'in' {
  return units === 'imperial' ? 'in' : 'mm'
}
