import { describe, expect, it } from 'bun:test'
import { ssmaLibraryJson, parseLibrary } from '../../library/load-ssma'
import { CFSMember } from '../../schema/cfs-member'
import { CFSServiceHole } from '../../schema/cfs-service-hole'
import type {
  CFSMemberId,
  CFSServiceHoleId,
  CFSWallFramingId,
} from '../../schema/ids'
import {
  R1_MIN_END_DISTANCE_MM,
  R2_MAX_WIDTH_FRACTION_OF_WEB,
} from '../aisi-thresholds'
import {
  expandPrePunches,
  holeLengthAlongMember,
  validateServiceHole,
  type ServiceHoleValidatorInput,
} from '../service-hole-validator'

const FRAMING_ID = '11111111-1111-4111-8111-111111111111' as unknown as CFSWallFramingId

let _nextUuid = 0
function uuid<T extends string>(): T {
  _nextUuid += 1
  const seg = _nextUuid.toString(16).padStart(12, '0')
  return `00000000-0000-4000-8000-${seg}` as unknown as T
}

const FIXED_NOW = '2026-05-08T12:00:00.000Z'
const fixedNow = () => FIXED_NOW

const lib = parseLibrary(ssmaLibraryJson)
const stud362 = lib.sections.find((s) => s.designation === '362S162-54')
if (!stud362) throw new Error('expected 362S162-54 in SSMA seed')

// Standard test stud: 2743 mm tall (9 ft), 362-series (web 92.1 mm).
function makeStud(length_mm = 2743, holeIds: CFSServiceHoleId[] = []) {
  return CFSMember.parse({
    type: 'cfs_member',
    id: uuid<CFSMemberId>(),
    parentId: FRAMING_ID,
    role: 'stud',
    sectionId: stud362!.id,
    start: { x_mm: 0, y_mm: 0, z_mm: 0 },
    end: { x_mm: 0, y_mm: length_mm, z_mm: 0 },
    orientation_deg: 0,
    serviceHoleIds: holeIds,
  })
}

function makeHole(
  pos: number,
  diameter = 38,
  opts: {
    shape?: 'round' | 'oblong'
    oblongLength_mm?: number
    hasStiffener?: boolean
    parentId?: CFSMemberId
  } = {},
) {
  return CFSServiceHole.parse({
    type: 'cfs_service_hole',
    id: uuid<CFSServiceHoleId>(),
    parentId: opts.parentId ?? (uuid<CFSMemberId>()),
    positionAlongMember_mm: pos,
    diameter_mm: diameter,
    shape: opts.shape ?? 'round',
    oblongLength_mm: opts.oblongLength_mm,
    hasStiffener: opts.hasStiffener ?? false,
  })
}

function input(
  partial: Partial<ServiceHoleValidatorInput> & Pick<ServiceHoleValidatorInput, 'hole'>,
): ServiceHoleValidatorInput {
  const member = partial.member ?? makeStud()
  return {
    section: stud362!,
    siblingHoles: [],
    millPrePunches: [],
    nowIso: fixedNow,
    ...partial,
    member,
  }
}

describe('validateServiceHole — §5.4 R1 end-distance', () => {
  it('HOL-01: hole at center of 2743 mm stud is compliant', () => {
    const member = makeStud(2743)
    const hole = makeHole(2743 / 2, 38, { parentId: member.id })
    const verdict = validateServiceHole(input({ hole, member }))
    expect(verdict.status).toBe('compliant')
    expect(verdict.reasons).toEqual([])
  })

  it('HOL-02: hole 200 mm from start fails R1 with actual values in reason', () => {
    const member = makeStud(2743)
    const hole = makeHole(200, 38, { parentId: member.id })
    const verdict = validateServiceHole(input({ hole, member }))
    expect(verdict.status).toBe('non-compliant')
    expect(verdict.reasons).toHaveLength(1)
    expect(verdict.reasons[0]).toContain('200 mm of member end')
    expect(verdict.reasons[0]).toContain(`≥ ${R1_MIN_END_DISTANCE_MM} mm`)
  })

  it('HOL-03: boundary — hole exactly at 305 mm is compliant (rule is `<`)', () => {
    const member = makeStud(2743)
    const hole = makeHole(R1_MIN_END_DISTANCE_MM, 38, { parentId: member.id })
    const verdict = validateServiceHole(input({ hole, member }))
    expect(verdict.status).toBe('compliant')
  })

  it('R1 also fires when hole is too close to the FAR end', () => {
    const member = makeStud(2743)
    // 2543 mm from start = 200 mm from end
    const hole = makeHole(2543, 38, { parentId: member.id })
    const verdict = validateServiceHole(input({ hole, member }))
    expect(verdict.status).toBe('non-compliant')
    expect(verdict.reasons[0]).toContain('200 mm')
  })
})

describe('validateServiceHole — §5.4 R2 width vs web', () => {
  it('HOL-04: 100 mm round on 92.1 mm web fails R2', () => {
    const member = makeStud(2743)
    const hole = makeHole(1372, 100, { parentId: member.id })
    const verdict = validateServiceHole(input({ hole, member }))
    expect(verdict.status).toBe('non-compliant')
    const r2reason = verdict.reasons.find((r) => r.includes('exceeds 65%'))
    expect(r2reason).toBeDefined()
    expect(r2reason).toContain('100')
    expect(r2reason).toContain('92.1')
  })

  it('R2 boundary: width exactly 65% of web depth is compliant', () => {
    const member = makeStud(2743)
    const exactly = R2_MAX_WIDTH_FRACTION_OF_WEB * stud362!.properties.webDepth_mm
    // Stiffen so R4 (50% threshold) doesn't fire — this test isolates R2.
    const hole = makeHole(1372, exactly, {
      parentId: member.id,
      hasStiffener: true,
    })
    const verdict = validateServiceHole(input({ hole, member }))
    // Width = 0.65 × web should be allowed (rule is strict `>`).
    expect(verdict.status).toBe('compliant')
  })
})

describe('validateServiceHole — §5.4 R3 inter-hole spacing', () => {
  it('HOL-05: three 38 mm holes spaced 50 mm apart — middle conflicts with both neighbors', () => {
    const member = makeStud(2743)
    // Center the cluster at 1300 mm to avoid R1 contamination.
    const left = makeHole(1250, 38, { parentId: member.id })
    const middle = makeHole(1300, 38, { parentId: member.id })
    const right = makeHole(1350, 38, { parentId: member.id })
    const verdict = validateServiceHole(
      input({ hole: middle, member, siblingHoles: [left, right] }),
    )
    expect(verdict.status).toBe('non-compliant')
    // 2 R3 reasons (one per neighbor) — both 50 mm < 76 mm required.
    const r3reasons = verdict.reasons.filter((r) => r.includes('spacing'))
    expect(r3reasons).toHaveLength(2)
  })

  it('HOL-08: hole 200 mm from a mill pre-punch fails R3 against the mill hole', () => {
    const member = makeStud(2743)
    // Place a hole 200 mm beyond the first SSMA pre-punch (305 mm).
    const hole = makeHole(505, 38, { parentId: member.id })
    const millPunches = expandPrePunches(stud362!.prePunchPattern, 2743)
    const verdict = validateServiceHole(input({ hole, member, millPrePunches: millPunches }))
    expect(verdict.status).toBe('non-compliant')
    const millReason = verdict.reasons.find((r) => r.includes('mill pre-punch'))
    expect(millReason).toBeDefined()
    expect(millReason).toContain('305')
  })

  it('R3 ignores hole compared to itself in siblings list', () => {
    const member = makeStud(2743)
    const hole = makeHole(1300, 38, { parentId: member.id })
    const verdict = validateServiceHole(
      input({ hole, member, siblingHoles: [hole] }),
    )
    expect(verdict.status).toBe('compliant')
  })
})

describe('validateServiceHole — §5.4 R4 stiffener', () => {
  it('HOL-06: 60 mm hole on 92.1 mm web fires both R2 and R4', () => {
    const member = makeStud(2743)
    const hole = makeHole(1372, 60, { parentId: member.id })
    const verdict = validateServiceHole(input({ hole, member }))
    expect(verdict.status).toBe('non-compliant')
    expect(verdict.reasons.some((r) => r.includes('exceeds 65%'))).toBe(true)
    expect(verdict.reasons.some((r) => r.includes('requires web stiffener'))).toBe(true)
  })

  it('HOL-07: stiffener flag clears R4 but not R2', () => {
    const member = makeStud(2743)
    const hole = makeHole(1372, 60, { parentId: member.id, hasStiffener: true })
    const verdict = validateServiceHole(input({ hole, member }))
    expect(verdict.status).toBe('non-compliant')
    expect(verdict.reasons.every((r) => !r.includes('stiffener'))).toBe(true)
    expect(verdict.reasons.some((r) => r.includes('exceeds 65%'))).toBe(true)
  })
})

describe('validateServiceHole — verdict shape', () => {
  it('checkedAt is taken from the injected nowIso', () => {
    const member = makeStud(2743)
    const hole = makeHole(1372, 38, { parentId: member.id })
    const verdict = validateServiceHole(input({ hole, member }))
    expect(verdict.checkedAt).toBe(FIXED_NOW)
  })

  it('returns compliant with empty reasons when all rules pass', () => {
    const member = makeStud(2743)
    const hole = makeHole(1372, 38, { parentId: member.id })
    const verdict = validateServiceHole(input({ hole, member }))
    expect(verdict).toEqual({
      status: 'compliant',
      reasons: [],
      checkedAt: FIXED_NOW,
    })
  })
})

describe('validateServiceHole — oblong holes', () => {
  it('R2 keys off diameter (across web) for oblong, not oblongLength', () => {
    // An oblong with long axis 80 mm but web-cross diameter 38 mm should
    // pass R2 — the long axis runs along the member, which doesn't reduce
    // the web's flat width.
    const member = makeStud(2743)
    const hole = makeHole(1372, 38, {
      parentId: member.id,
      shape: 'oblong',
      oblongLength_mm: 80,
    })
    const verdict = validateServiceHole(input({ hole, member }))
    expect(verdict.status).toBe('compliant')
  })

  it('R3 keys off oblongLength for spacing (length along member axis)', () => {
    // Two oblong holes 80 × 38 spaced 100 mm apart — spacing must be
    // ≥ 2 × 80 = 160 mm. So 100 mm fails.
    const member = makeStud(2743)
    const left = makeHole(1250, 38, {
      parentId: member.id,
      shape: 'oblong',
      oblongLength_mm: 80,
    })
    const right = makeHole(1350, 38, {
      parentId: member.id,
      shape: 'oblong',
      oblongLength_mm: 80,
    })
    const verdict = validateServiceHole(
      input({ hole: left, member, siblingHoles: [right] }),
    )
    expect(verdict.status).toBe('non-compliant')
    expect(verdict.reasons[0]).toContain('100 mm')
    expect(verdict.reasons[0]).toContain('160 mm')
  })

  it('holeLengthAlongMember falls back to diameter when oblongLength missing', () => {
    expect(holeLengthAlongMember({ shape: 'round', diameter_mm: 50 })).toBe(50)
    expect(
      holeLengthAlongMember({
        shape: 'oblong',
        diameter_mm: 38,
        oblongLength_mm: 80,
      }),
    ).toBe(80)
  })
})

describe('expandPrePunches', () => {
  it('returns empty for sections without a pattern', () => {
    expect(expandPrePunches(undefined, 2743)).toEqual([])
  })

  it('returns empty for members shorter than 2 × firstPosition', () => {
    expect(
      expandPrePunches(
        { firstPosition_mm: 305, spacing_mm: 610, length_mm: 102, width_mm: 38 },
        500,
      ),
    ).toEqual([])
  })

  it('SSMA standard pattern on a 2743 mm stud yields 4 holes (305, 915, 1525, 2135)', () => {
    const punches = expandPrePunches(
      { firstPosition_mm: 305, spacing_mm: 610, length_mm: 102, width_mm: 38 },
      2743,
    )
    expect(punches.map((p) => p.positionAlongMember_mm)).toEqual([
      305, 915, 1525, 2135,
    ])
    for (const p of punches) {
      expect(p.length_mm).toBe(102)
      expect(p.width_mm).toBe(38)
    }
  })

  it('drops trailing punch that would land within firstPosition of the far end', () => {
    // Member 2745 mm: 305 + 610*4 = 2745 exactly. Limit is 2745 - 305 = 2440.
    // 305, 915, 1525, 2135 are all ≤ 2440 → 4 holes. 2745 itself is dropped.
    const punches = expandPrePunches(
      { firstPosition_mm: 305, spacing_mm: 610, length_mm: 102, width_mm: 38 },
      2745,
    )
    expect(punches.map((p) => p.positionAlongMember_mm)).toEqual([
      305, 915, 1525, 2135,
    ])
  })
})
