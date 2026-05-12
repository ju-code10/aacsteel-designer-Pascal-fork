import { describe, expect, it } from 'bun:test'
import {
  FASTENER_SCHEDULE_DEFAULTS,
  dxfFastenerScheduleLines,
} from '../fastener-defaults'

describe('fastener-defaults', () => {
  it('ships three v1 default rows', () => {
    expect(FASTENER_SCHEDULE_DEFAULTS).toHaveLength(3)
    expect(FASTENER_SCHEDULE_DEFAULTS[0]?.joint).toBe('Stud-to-track')
    expect(FASTENER_SCHEDULE_DEFAULTS[1]?.joint).toBe('Header-to-king')
    expect(FASTENER_SCHEDULE_DEFAULTS[2]?.joint).toBe('Sheathing')
  })

  it('renders the pre-Slice-9 DXF schedule lines byte-identically', () => {
    // Frozen text from the original inlined block in dxf.ts. Any change to
    // padding, headings, or specs must update this test deliberately.
    expect(dxfFastenerScheduleLines()).toEqual([
      'FASTENER SCHEDULE (TYPICAL)',
      '----------------------------',
      'Stud-to-track:   #10 self-drilling, 2 per joint',
      'Header-to-king:  #10 self-drilling, 4 per joint',
      'Sheathing:       per project specifications',
    ])
  })

  it('accepts an override row set for v2 / project customization', () => {
    const out = dxfFastenerScheduleLines([
      { joint: 'Top', spec: 'note A' },
      { joint: 'Bottom', spec: 'note B' },
    ])
    expect(out).toEqual([
      'FASTENER SCHEDULE (TYPICAL)',
      '----------------------------',
      'Top:             note A',
      'Bottom:          note B',
    ])
  })
})
