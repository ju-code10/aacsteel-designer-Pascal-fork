import { beforeEach, describe, expect, it } from 'bun:test'
import { useScene } from '@pascal-app/core'
import type { AnyNodeId } from '@pascal-app/core'
import { ssmaLibraryJson } from '../../library/load-ssma'
import { CFSMember } from '../../schema/cfs-member'
import { CFSServiceHole } from '../../schema/cfs-service-hole'
import type {
  CFSMemberId,
  CFSServiceHoleId,
  CFSWallFramingId,
} from '../../schema/ids'
import { useCFS } from '../../store/use-cfs'
import { runServiceHolePass, verdictsEquivalent } from '../service-hole-pass'

const SITE_ID = 'site_test_root'
const FRAMING_ID = 'cccccccc-cccc-4ccc-acc0-000000000001'

let nextUuid = 0
function uuid<T extends string>(): T {
  nextUuid += 1
  const seg = nextUuid.toString(16).padStart(12, '0')
  return `00000000-0000-4000-8a01-${seg}` as unknown as T
}

const FIXED_NOW = '2026-05-08T12:34:56.000Z'

function resetAll(): void {
  useCFS.setState({
    isCFSMode: false,
    inspectorTab: 'wall',
    hoveredMemberId: null,
    selectedPanelId: null,
    selectedHoleId: null,
    activeTool: null,
    serviceHoleTool: {
      lastDiameter_mm: 38,
      shape: 'round',
      snapToGrid: false,
      oblongWidth_mm: 38,
    },
    memberLibraries: {},
    activeLibraryId: null,
    unitsDisplay: 'imperial',
    preferredHeaderType: 'box',
    isLibraryLoading: false,
    libraryLoadError: null,
  })
  useScene.setState({
    nodes: {},
    rootNodeIds: [],
    dirtyNodes: new Set(),
    collections: {},
  })
  useScene.temporal.getState().clear()
  nextUuid = 0
}

async function activateCFSMode(): Promise<void> {
  await useCFS.getState().loadLibrary(ssmaLibraryJson)
  useCFS.setState({ isCFSMode: true })
}

interface SeedHoleOpts {
  pos: number
  diameter?: number
  shape?: 'round' | 'oblong'
  oblongLength_mm?: number
  hasStiffener?: boolean
  /** Pre-existing compliance verdict (e.g., from a hydrated import). */
  preExistingCompliance?: {
    status: 'compliant' | 'non-compliant' | 'unchecked'
    reasons: string[]
    checkedAt?: string
  }
}

function seedMemberWithHoles(
  memberLength_mm: number,
  holeOpts: SeedHoleOpts[],
): { memberId: CFSMemberId; holeIds: CFSServiceHoleId[] } {
  const lib = Object.values(useCFS.getState().memberLibraries)[0]
  if (!lib) throw new Error('seed: library missing')
  const stud = lib.sections.find((s) => s.designation === '362S162-54')
  if (!stud) throw new Error('seed: 362S162-54 missing from library')

  const memberId = uuid<CFSMemberId>()
  const member = CFSMember.parse({
    type: 'cfs_member',
    id: memberId,
    parentId: FRAMING_ID,
    role: 'stud',
    sectionId: stud.id,
    start: { x_mm: 0, y_mm: 0, z_mm: 0 },
    end: { x_mm: 0, y_mm: memberLength_mm, z_mm: 0 },
    orientation_deg: 0,
    serviceHoleIds: [],
  })

  const holeIds: CFSServiceHoleId[] = []
  const holeNodes: Record<string, unknown> = {}
  for (const opts of holeOpts) {
    const id = uuid<CFSServiceHoleId>()
    holeIds.push(id)
    const hole = CFSServiceHole.parse({
      type: 'cfs_service_hole',
      id,
      parentId: memberId,
      positionAlongMember_mm: opts.pos,
      diameter_mm: opts.diameter ?? 38,
      shape: opts.shape ?? 'round',
      oblongLength_mm: opts.oblongLength_mm,
      hasStiffener: opts.hasStiffener ?? false,
      compliance: opts.preExistingCompliance ?? {
        status: 'unchecked',
        reasons: [],
      },
    })
    holeNodes[id] = hole
  }

  // Update the member's serviceHoleIds back-pointer (denormalized per §3.5).
  const memberWithHoles = { ...member, serviceHoleIds: holeIds }

  useScene.setState((s) => ({
    nodes: {
      ...s.nodes,
      [memberId]: memberWithHoles as unknown as never,
      ...(holeNodes as Record<string, never>),
    },
  }))
  return { memberId, holeIds }
}

describe('runServiceHolePass — §5.4 system pass', () => {
  beforeEach(() => {
    resetAll()
  })

  it('returns 0 writes when CFS mode is off', async () => {
    await useCFS.getState().loadLibrary(ssmaLibraryJson)
    useCFS.setState({ isCFSMode: false })
    seedMemberWithHoles(2743, [{ pos: 1372 }])
    expect(runServiceHolePass()).toBe(0)
  })

  it('compliant hole: writes verdict on first pass, skips on second pass', async () => {
    await activateCFSMode()
    // pos 610 sits midway between SSMA mill pre-punches at 305 and 915,
    // 305 mm from each (≥ 2× max(38,102)=204 mm required). All four R rules pass.
    const { holeIds } = seedMemberWithHoles(2743, [{ pos: 610 }])
    expect(runServiceHolePass({ nowIso: () => FIXED_NOW })).toBe(1)
    const stored = useScene.getState().nodes[holeIds[0]!] as unknown as {
      compliance: { status: string; reasons: string[]; checkedAt?: string }
    }
    expect(stored.compliance.status).toBe('compliant')
    expect(stored.compliance.checkedAt).toBe(FIXED_NOW)
    // Second pass with later clock should NOT write (verdict equivalent).
    expect(runServiceHolePass({ nowIso: () => '2026-05-08T13:00:00.000Z' })).toBe(0)
    const stored2 = useScene.getState().nodes[holeIds[0]!] as unknown as {
      compliance: { checkedAt?: string }
    }
    expect(stored2.compliance.checkedAt).toBe(FIXED_NOW)
  })

  it('non-compliant hole gets reasons populated and status set', async () => {
    await activateCFSMode()
    const { holeIds } = seedMemberWithHoles(2743, [{ pos: 200 }]) // R1
    runServiceHolePass({ nowIso: () => FIXED_NOW })
    const stored = useScene.getState().nodes[holeIds[0]!] as unknown as {
      compliance: { status: string; reasons: string[] }
    }
    expect(stored.compliance.status).toBe('non-compliant')
    expect(stored.compliance.reasons.length).toBeGreaterThan(0)
    expect(stored.compliance.reasons[0]).toContain('200 mm of member end')
  })

  it('HOL-09: shrinking the parent member re-validates child holes', async () => {
    await activateCFSMode()
    // Hole at 610 mm — sits between mill pre-punches 305/915 with safe
    // spacing on a 2743 mm member; on an 800 mm member the same position
    // is only 190 mm from the far end, violating R1.
    const { memberId, holeIds } = seedMemberWithHoles(2743, [{ pos: 610 }])
    runServiceHolePass({ nowIso: () => FIXED_NOW })
    let stored = useScene.getState().nodes[holeIds[0]!] as unknown as {
      compliance: { status: string }
    }
    expect(stored.compliance.status).toBe('compliant')
    // Shorten the member to 800 mm; hole now 190 mm from far end.
    useScene.setState((s) => {
      const member = s.nodes[memberId] as unknown as {
        end: { x_mm: number; y_mm: number; z_mm: number }
      }
      return {
        nodes: {
          ...s.nodes,
          [memberId]: {
            ...member,
            end: { ...member.end, y_mm: 800 },
          } as unknown as never,
        },
      }
    })
    runServiceHolePass({ nowIso: () => FIXED_NOW })
    stored = useScene.getState().nodes[holeIds[0]!] as unknown as {
      compliance: { status: string; reasons: string[] }
    }
    expect(stored.compliance.status).toBe('non-compliant')
    expect(stored.compliance.reasons[0]).toContain('190 mm of member end')
  })

  it('HOL-10: hydrated scene round-trip — pass preserves checkedAt when verdicts match', async () => {
    await activateCFSMode()
    const ORIGINAL_AT = '2026-04-01T08:00:00.000Z'
    // pos 1220 sits midway between mill pre-punches 915 and 1525 — genuinely
    // compliant. The recomputed verdict matches the persisted one and the
    // pass leaves the node alone.
    const { holeIds } = seedMemberWithHoles(2743, [
      {
        pos: 1220,
        preExistingCompliance: {
          status: 'compliant',
          reasons: [],
          checkedAt: ORIGINAL_AT,
        },
      },
    ])
    // Pass under a different clock — should detect equivalence and skip write.
    expect(runServiceHolePass({ nowIso: () => '2027-01-01T00:00:00.000Z' })).toBe(0)
    const stored = useScene.getState().nodes[holeIds[0]!] as unknown as {
      compliance: { checkedAt?: string }
    }
    expect(stored.compliance.checkedAt).toBe(ORIGINAL_AT)
  })

  it('HOL-11: stiffener flip is a hole-data change but does not move geometric signature', async () => {
    await activateCFSMode()
    // 60 mm hole on 92.1 mm web: fails R2 + R4 with no stiffener; only R2
    // with stiffener. The pass should write a new verdict; geometry pass
    // (separate test in apps/editor) confirms the parent member is NOT
    // dirtied for CSG purposes — relying on memberSignature ignoring the
    // hasStiffener field per geometry-pass.ts.
    const { holeIds } = seedMemberWithHoles(2743, [{ pos: 1372, diameter: 60 }])
    runServiceHolePass({ nowIso: () => FIXED_NOW })
    let stored = useScene.getState().nodes[holeIds[0]!] as unknown as {
      compliance: { reasons: string[] }
      hasStiffener: boolean
    }
    expect(stored.compliance.reasons.length).toBeGreaterThanOrEqual(2)
    // Toggle stiffener.
    useScene.getState().updateNode(holeIds[0]! as unknown as AnyNodeId, {
      hasStiffener: true,
    } as never)
    runServiceHolePass({ nowIso: () => FIXED_NOW })
    stored = useScene.getState().nodes[holeIds[0]!] as unknown as {
      compliance: { reasons: string[] }
      hasStiffener: boolean
    }
    // Stiffener cleared R4 reason; R2 remains.
    expect(stored.hasStiffener).toBe(true)
    expect(stored.compliance.reasons.every((r) => !r.includes('stiffener'))).toBe(true)
    expect(stored.compliance.reasons.some((r) => r.includes('exceeds 65%'))).toBe(true)
  })

  it('three holes too close — middle gets R3 reasons against both neighbors', async () => {
    await activateCFSMode()
    const { holeIds } = seedMemberWithHoles(2743, [
      { pos: 1250 },
      { pos: 1300 },
      { pos: 1350 },
    ])
    runServiceHolePass({ nowIso: () => FIXED_NOW })
    const middle = useScene.getState().nodes[holeIds[1]!] as unknown as {
      compliance: { status: string; reasons: string[] }
    }
    expect(middle.compliance.status).toBe('non-compliant')
    const r3reasons = middle.compliance.reasons.filter((r) => r.includes('spacing'))
    expect(r3reasons).toHaveLength(2)
  })

  it('orphan hole (parent member missing) is silently skipped', async () => {
    await activateCFSMode()
    // Build a hole with a parentId in valid UUID form that resolves to nothing.
    const orphanId = uuid<CFSServiceHoleId>()
    const orphan = CFSServiceHole.parse({
      type: 'cfs_service_hole',
      id: orphanId,
      parentId: 'deadbeef-dead-4bee-8eef-deadbeefdead' as unknown as CFSMemberId,
      positionAlongMember_mm: 1000,
      diameter_mm: 38,
      shape: 'round',
      hasStiffener: false,
    })
    useScene.setState((s) => ({
      nodes: { ...s.nodes, [orphanId]: orphan as unknown as never },
    }))
    expect(runServiceHolePass({ nowIso: () => FIXED_NOW })).toBe(0)
  })

  it('detects R3 against mill pre-punches from section.prePunchPattern', async () => {
    await activateCFSMode()
    // 362S162-54 has prePunchPattern {first=305, spacing=610}; on a 2743 mm
    // member that materializes at 305, 915, 1525, 2135. Place a detailer
    // hole 200 mm from the first mill punch (505 mm) → R3 fires.
    const { holeIds } = seedMemberWithHoles(2743, [{ pos: 505 }])
    runServiceHolePass({ nowIso: () => FIXED_NOW })
    const stored = useScene.getState().nodes[holeIds[0]!] as unknown as {
      compliance: { status: string; reasons: string[] }
    }
    expect(stored.compliance.status).toBe('non-compliant')
    expect(
      stored.compliance.reasons.some(
        (r) => r.includes('mill pre-punch') && r.includes('305'),
      ),
    ).toBe(true)
  })
})

describe('verdictsEquivalent', () => {
  it('matches on status + reasons regardless of checkedAt', () => {
    expect(
      verdictsEquivalent(
        { status: 'compliant', reasons: [], checkedAt: '2026-01-01T00:00:00Z' },
        { status: 'compliant', reasons: [], checkedAt: '2027-01-01T00:00:00Z' },
      ),
    ).toBe(true)
  })

  it('matches on reordered reasons (R1 before R2 vs R2 before R1)', () => {
    expect(
      verdictsEquivalent(
        { status: 'non-compliant', reasons: ['a', 'b'] },
        { status: 'non-compliant', reasons: ['b', 'a'] },
      ),
    ).toBe(true)
  })

  it('differs when status changes', () => {
    expect(
      verdictsEquivalent(
        { status: 'compliant', reasons: [] },
        { status: 'non-compliant', reasons: [] },
      ),
    ).toBe(false)
  })

  it('differs when reasons set changes', () => {
    expect(
      verdictsEquivalent(
        { status: 'non-compliant', reasons: ['a'] },
        { status: 'non-compliant', reasons: ['b'] },
      ),
    ).toBe(false)
  })
})
