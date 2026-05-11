// §6.2 — minimal RFC4180-ish CSV writer.
//
// Quotes fields that contain commas, double quotes, or line breaks; doubles
// embedded quotes. CRLF line endings (what Excel's CSV import expects).
// Callers prepend a UTF-8 BOM if they need Excel to detect UTF-8 reliably
// (see `writeCSVWithBOM`).
export function writeCSV(rows: readonly (readonly (string | number)[])[]): string {
  const escape = (v: string | number): string => {
    const s = String(v)
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  return rows.map((r) => r.map(escape).join(',')).join('\r\n') + '\r\n'
}

const UTF8_BOM = '﻿'

export function writeCSVWithBOM(
  rows: readonly (readonly (string | number)[])[],
): string {
  return UTF8_BOM + writeCSV(rows)
}
