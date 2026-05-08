import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import { cfsMemberLength_mm } from '../schema/cfs-member'
import type { CFSMember } from '../schema/cfs-member'
import type { CFSMemberLibrary, CFSSection } from '../schema/cfs-member-library'
import type { CFSServiceHole } from '../schema/cfs-service-hole'
import type { CFSComplianceVerdict } from '../schema/primitives'
import {
  expandPrePunches,
  validateServiceHole,
  type PrePunch,
} from '../lib/service-hole-validator'
import { getActiveLibrary } from '../store/selectors'
import { useCFS } from '../store/use-cfs'

/**
 * §5.4 — `CFSServiceHoleSystem` pass.
 *
 * For every `cfs_service_hole` node, look up the parent member + section,
 * gather siblings on the same member and mill pre-punches from the section
 * pattern, run the pure validator, and write the resulting
 * `CFSComplianceVerdict` to the hole via `updateNode`.
 *
 * Idempotency: if the recomputed verdict matches what's already on the hole
 * (status + reasons; we ignore `checkedAt`, which would otherwise loop), the
 * pass skips the write. This is the loop-avoidance contract — without it,
 * every `updateNode` re-fires the subscriber and re-runs the pass.
 *
 * Round-trip safety: a freshly imported scene already carries verdicts. The
 * pass recomputes them, finds equality, and writes nothing. `checkedAt` is
 * preserved exactly as imported, satisfying §3.8 / HOL-10.
 */

const MM_PER_METER = 1000
void MM_PER_METER // placeholder; not needed yet

function nowIso(): string {
  return new Date().toISOString()
}

interface ValidationContext {
  nodes: Record<string, AnyNode>
  membersById: Map<string, CFSMember>
  sectionsById: Map<string, CFSSection>
  holesByMember: Map<string, CFSServiceHole[]>
  prePunchesBySection: Map<string, PrePunch[]>
}

function buildValidationContext(
  nodes: Record<string, AnyNode>,
  library: CFSMemberLibrary | null,
): ValidationContext {
  const membersById = new Map<string, CFSMember>()
  const holesByMember = new Map<string, CFSServiceHole[]>()
  const sectionsById = new Map<string, CFSSection>()
  if (library) {
    for (const s of library.sections) sectionsById.set(s.id, s)
  }

  for (const node of Object.values(nodes)) {
    const t = (node as { type?: string }).type
    if (t === 'cfs_member') {
      const m = node as unknown as CFSMember
      membersById.set(m.id, m)
    } else if (t === 'cfs_service_hole') {
      const h = node as unknown as CFSServiceHole
      let bucket = holesByMember.get(h.parentId)
      if (!bucket) {
        bucket = []
        holesByMember.set(h.parentId, bucket)
      }
      bucket.push(h)
    }
  }

  // Pre-expand mill pre-punches per (sectionId, memberLength). We could cache
  // by (sectionId, length_mm) tuple; for v1 the size of the work is small
  // (one expansion per unique member length per section) and we accept the
  // recomputation. If profiling shows this hot, add a Map<string, PrePunch[]>.
  const prePunchesBySection = new Map<string, PrePunch[]>()
  void prePunchesBySection // populated lazily inside runPass per member

  return { nodes, membersById, sectionsById, holesByMember, prePunchesBySection }
}

/**
 * Two verdicts are equivalent (skip the write) iff their status and the
 * sorted set of reason strings match. `checkedAt` deliberately ignored.
 */
export function verdictsEquivalent(
  a: CFSComplianceVerdict,
  b: CFSComplianceVerdict,
): boolean {
  if (a.status !== b.status) return false
  if (a.reasons.length !== b.reasons.length) return false
  const sortedA = [...a.reasons].sort()
  const sortedB = [...b.reasons].sort()
  for (let i = 0; i < sortedA.length; i += 1) {
    if (sortedA[i] !== sortedB[i]) return false
  }
  return true
}

export interface ServiceHolePassDeps {
  /** Injected for tests; production passes wallclock `nowIso`. */
  nowIso?: () => string
}

/**
 * Run one full validation pass over every service hole in the scene. Returns
 * the number of holes whose verdict was written. Pure with respect to its
 * inputs — only side effect is calling `useScene.updateNode` for changed
 * verdicts.
 */
export function runServiceHolePass(deps: ServiceHolePassDeps = {}): number {
  const cfsState = useCFS.getState()
  if (!cfsState.isCFSMode) return 0
  const library = getActiveLibrary(cfsState)
  if (!library) return 0

  const sceneState = useScene.getState()
  const ctx = buildValidationContext(sceneState.nodes, library)
  const now = deps.nowIso ?? nowIso

  let writes = 0
  for (const [memberId, holes] of ctx.holesByMember) {
    const member = ctx.membersById.get(memberId)
    if (!member) continue // orphan hole; skipped (cascade-delete will sweep)
    const section = ctx.sectionsById.get(member.sectionId)
    if (!section) continue // section vanished from library mid-edit; skip

    const memberLength = cfsMemberLength_mm(member)
    const millPrePunches = expandPrePunches(section.prePunchPattern, memberLength)

    for (const hole of holes) {
      const siblings = holes.filter((h) => h.id !== hole.id)
      const verdict = validateServiceHole({
        hole,
        member,
        section,
        siblingHoles: siblings,
        millPrePunches,
        nowIso: now,
      })
      if (verdictsEquivalent(verdict, hole.compliance)) continue
      sceneState.updateNode(hole.id as unknown as AnyNodeId, {
        compliance: verdict,
      } as unknown as Partial<AnyNode>)
      writes += 1
    }
  }
  return writes
}
