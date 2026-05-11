import { describe, expect, it } from 'bun:test'
import { CFSPanel, isRealPanel, panelWidth_mm } from '../cfs-panel'

const FRAMING = '22222222-2222-4222-a222-222222222222'
const PANEL_ID = '66666666-6666-4666-a666-666666666601'

describe('CFSPanel — real-panel invariants', () => {
  it('parses a valid real panel', () => {
    const p = CFSPanel.parse({
      type: 'cfs_panel',
      id: PANEL_ID,
      parentId: FRAMING,
      label: 'P-01',
      sequenceNumber: 1,
      startAlongWall_mm: 0,
      endAlongWall_mm: 3658,
    })
    expect(p.isManualBreak).toBe(false)
    expect(p.isPendingSentinel).toBe(false)
    expect(isRealPanel(p)).toBe(true)
    expect(panelWidth_mm(p)).toBe(3658)
  })

  it('rejects sequenceNumber < 1 on a real panel', () => {
    expect(() =>
      CFSPanel.parse({
        type: 'cfs_panel',
        id: PANEL_ID,
        parentId: FRAMING,
        label: 'P-01',
        sequenceNumber: 0,
        startAlongWall_mm: 0,
        endAlongWall_mm: 3658,
      }),
    ).toThrow()
  })

  it('rejects end ≤ start on a real panel', () => {
    expect(() =>
      CFSPanel.parse({
        type: 'cfs_panel',
        id: PANEL_ID,
        parentId: FRAMING,
        label: 'P-01',
        sequenceNumber: 1,
        startAlongWall_mm: 1000,
        endAlongWall_mm: 1000,
      }),
    ).toThrow()
  })
})

describe('CFSPanel — sentinel relaxations', () => {
  it('accepts a zero-width sentinel with non-positive sequenceNumber', () => {
    const sentinel = CFSPanel.parse({
      type: 'cfs_panel',
      id: PANEL_ID,
      parentId: FRAMING,
      label: '__pending-break__',
      sequenceNumber: -1,
      startAlongWall_mm: 5000,
      endAlongWall_mm: 5000,
      isManualBreak: true,
      isPendingSentinel: true,
    })
    expect(sentinel.isPendingSentinel).toBe(true)
    expect(isRealPanel(sentinel)).toBe(false)
    expect(panelWidth_mm(sentinel)).toBe(0)
  })

  it('still rejects end < start even on a sentinel', () => {
    expect(() =>
      CFSPanel.parse({
        type: 'cfs_panel',
        id: PANEL_ID,
        parentId: FRAMING,
        label: '__pending-break__',
        sequenceNumber: -1,
        startAlongWall_mm: 5000,
        endAlongWall_mm: 4999,
        isManualBreak: true,
        isPendingSentinel: true,
      }),
    ).toThrow()
  })
})
