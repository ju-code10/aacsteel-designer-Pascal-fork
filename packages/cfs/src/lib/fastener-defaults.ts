// v1 fastener-schedule defaults shared by the DXF (§6.3) and PDF (§6.4)
// shop-drawing exporters.
//
// A.4 row 2 (slice 9 polish): the placeholder values below are correct
// enough for v1 review but still need a reconciliation pass against
// AISI S240 and fastener-manufacturer guidelines. That pass is v2 work;
// any v2 change touches only this file.
//
// Both exporters render the same three data rows. Only the heading style
// differs — DXF prefaces the block with "FASTENER SCHEDULE (TYPICAL)"
// and a separator; PDF uses "FASTENERS" in 8-pt bold. Keep data here,
// formatting in the exporters.

export interface FastenerScheduleRow {
  /** Joint name as it appears in shop conventions. */
  joint: string
  /** Specification text (fastener type, count, notes). */
  spec: string
}

export const FASTENER_SCHEDULE_DEFAULTS: readonly FastenerScheduleRow[] = [
  { joint: 'Stud-to-track', spec: '#10 self-drilling, 2 per joint' },
  { joint: 'Header-to-king', spec: '#10 self-drilling, 4 per joint' },
  { joint: 'Sheathing', spec: 'per project specifications' },
]

// Column where the spec begins on every DXF schedule line. Picked so that
// the longest joint name ("Header-to-king" — 14 chars + ":") still leaves
// at least one space before the spec. 17 keeps the existing pre-Slice 9
// alignment byte-identical.
const DXF_JOINT_COL_WIDTH = 17

/**
 * The DXF schedule's TEXT-line block, including its heading + separator.
 * The DXF exporter emits one TEXT entity per element of this array.
 */
export function dxfFastenerScheduleLines(
  rows: readonly FastenerScheduleRow[] = FASTENER_SCHEDULE_DEFAULTS,
): readonly string[] {
  const data = rows.map(
    (r) => `${`${r.joint}:`.padEnd(DXF_JOINT_COL_WIDTH)}${r.spec}`,
  )
  return ['FASTENER SCHEDULE (TYPICAL)', '----------------------------', ...data]
}
