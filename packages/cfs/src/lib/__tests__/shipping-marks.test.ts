import { describe, expect, it } from 'bun:test'
import { planShippingMarks, roleCode } from '../shipping-marks'

interface AnyNode {
  type: string
  id: string
  parentId: string | null
  [k: string]: unknown
}

function makeScene(nodes: AnyNode[]): { nodes: Record<string, unknown> } {
  const map: Record<string, unknown> = {}
  for (const n of nodes) map[n.id] = n
  return { nodes: map }
}

function member(id: string, role: string, panelId: string | null, x_mm: number, y_mm = 0): AnyNode {
  return {
    type: 'cfs_member',
    id,
    parentId: 'framing',
    role,
    sectionId: 'sec',
    start: { x_mm, y_mm, z_mm: 0 },
    end: { x_mm, y_mm: y_mm + 2700, z_mm: 0 },
    panelId,
  }
}

function panel(id: string, label: string, seq: number): AnyNode {
  return {
    type: 'cfs_panel',
    id,
    parentId: 'framing',
    label,
    sequenceNumber: seq,
    startAlongWall_mm: 0,
    endAlongWall_mm: 1000,
    isManualBreak: false,
    isPendingSentinel: false,
  }
}

describe('shipping marks', () => {
  it('exposes the §6.0 role-code map', () => {
    expect(roleCode('stud')).toBe('S')
    expect(roleCode('top-track')).toBe('TT')
    expect(roleCode('bottom-track')).toBe('BT')
    expect(roleCode('king-stud')).toBe('K')
    expect(roleCode('jamb-stud')).toBe('J')
    expect(roleCode('chord-stud')).toBe('C')
    expect(roleCode('header')).toBe('H')
    expect(roleCode('sill')).toBe('SL')
    expect(roleCode('sill-track')).toBe('ST')
    expect(roleCode('cripple')).toBe('CR')
  })

  it('assigns per-role 1-based sequence in left-to-right order', () => {
    const scene = makeScene([
      panel('p1', 'P-01', 1),
      member('a', 'stud', 'p1', 1200),
      member('b', 'stud', 'p1', 600),
      member('c', 'stud', 'p1', 1800),
      member('d', 'king-stud', 'p1', 400),
    ])
    const marks = planShippingMarks(scene)
    expect(marks.get('b')).toBe('P-01-S1')
    expect(marks.get('a')).toBe('P-01-S2')
    expect(marks.get('c')).toBe('P-01-S3')
    expect(marks.get('d')).toBe('P-01-K1')
  })

  it('skips unpaneled members', () => {
    const scene = makeScene([
      panel('p1', 'P-01', 1),
      member('a', 'stud', null, 100),
      member('b', 'stud', 'p1', 600),
    ])
    const marks = planShippingMarks(scene)
    expect(marks.has('a')).toBe(false)
    expect(marks.get('b')).toBe('P-01-S1')
  })

  it('skips members assigned to a sentinel panel', () => {
    const scene = makeScene([
      {
        type: 'cfs_panel',
        id: 'sentinel',
        parentId: 'framing',
        label: 'P-?',
        sequenceNumber: 0,
        startAlongWall_mm: 500,
        endAlongWall_mm: 500,
        isManualBreak: true,
        isPendingSentinel: true,
      },
      panel('p1', 'P-01', 1),
      member('a', 'stud', 'sentinel', 100),
      member('b', 'stud', 'p1', 200),
    ])
    const marks = planShippingMarks(scene)
    expect(marks.has('a')).toBe(false)
    expect(marks.get('b')).toBe('P-01-S1')
  })

  it('is idempotent — same scene returns the same marks', () => {
    const scene = makeScene([
      panel('p1', 'P-01', 1),
      member('a', 'stud', 'p1', 600),
      member('b', 'stud', 'p1', 1200),
    ])
    const first = planShippingMarks(scene)
    const second = planShippingMarks(scene)
    for (const [k, v] of first.entries()) {
      expect(second.get(k)).toBe(v)
    }
  })

  it('numbers each role independently within a panel', () => {
    const scene = makeScene([
      panel('p1', 'P-01', 1),
      member('s1', 'stud', 'p1', 100),
      member('s2', 'stud', 'p1', 700),
      member('h1', 'header', 'p1', 400),
      member('h2', 'header', 'p1', 1000),
    ])
    const marks = planShippingMarks(scene)
    expect(marks.get('s1')).toBe('P-01-S1')
    expect(marks.get('s2')).toBe('P-01-S2')
    expect(marks.get('h1')).toBe('P-01-H1')
    expect(marks.get('h2')).toBe('P-01-H2')
  })
})
