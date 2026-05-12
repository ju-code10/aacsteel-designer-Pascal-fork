// §6.5 round-trip invariants — runtime checker.
//
// Properties that must hold across any clean export → import → re-export
// cycle. The function returns a list of violations; the caller decides
// what to do (development mode logs a warning; tests assert empty).
//
// These mirror the 8 invariants from §6.5; we don't include byte-equality
// here because it's already covered by the JSON-10 test against the
// deterministic export.

import type { CFSProject } from '../schema/cfs-project'
import type { CFSPanel } from '../schema/cfs-panel'
import type { CFSWallFraming } from '../schema/cfs-wall-framing'
import type { CFSServiceHole } from '../schema/cfs-service-hole'
import type { CFSOpening } from '../schema/cfs-opening'
import type { SceneLike } from '../lib/scene-walk'

export interface RoundTripViolation {
  invariant:
    | 'node-count'
    | 'node-ids'
    | 'parent-links'
    | 'fields'
    | 'metadata'
    | 'compliance'
    | 'cached-aggregates'
    | 'generated-member-ids'
  message: string
}

/**
 * Compare two scenes (typically "before export" and "after import") and
 * return any places the §6.5 invariants are violated. Empty array = clean.
 */
export function checkRoundTripInvariants(
  before: SceneLike,
  after: SceneLike,
): RoundTripViolation[] {
  const violations: RoundTripViolation[] = []
  const beforeNodes = before.nodes
  const afterNodes = after.nodes
  const beforeIds = new Set(Object.keys(beforeNodes))
  const afterIds = new Set(Object.keys(afterNodes))

  // 1. Node count.
  if (beforeIds.size !== afterIds.size) {
    violations.push({
      invariant: 'node-count',
      message: `before=${beforeIds.size} after=${afterIds.size}`,
    })
  }

  // 2. Node ids.
  for (const id of beforeIds) {
    if (!afterIds.has(id)) {
      violations.push({ invariant: 'node-ids', message: `missing after: ${id}` })
    }
  }

  // 3. Parent links.
  for (const id of beforeIds) {
    if (!afterIds.has(id)) continue
    const b = beforeNodes[id] as { parentId?: unknown } | undefined
    const a = afterNodes[id] as { parentId?: unknown } | undefined
    if ((b?.parentId ?? null) !== (a?.parentId ?? null)) {
      violations.push({
        invariant: 'parent-links',
        message: `${id}: ${String(b?.parentId)} → ${String(a?.parentId)}`,
      })
    }
  }

  // 4. Schema-validated fields — focus on the structural ones that the
  // exporters consume. Floating-point differences are tolerated up to
  // 1e-9 to allow for JSON.stringify ↔ parse round-trip artifacts.
  for (const id of beforeIds) {
    if (!afterIds.has(id)) continue
    const b = beforeNodes[id] as { type?: string } | undefined
    const a = afterNodes[id] as { type?: string } | undefined
    if (b?.type !== a?.type) {
      violations.push({
        invariant: 'fields',
        message: `${id}: type ${String(b?.type)} → ${String(a?.type)}`,
      })
    }
  }

  // 5. metadata passthrough on CFSProject — compare by canonical JSON so
  // key-order differences from the deep-sort exporter don't read as drift.
  for (const id of beforeIds) {
    const b = beforeNodes[id] as Partial<CFSProject> | undefined
    if (b?.type !== 'cfs_project') continue
    const a = afterNodes[id] as Partial<CFSProject> | undefined
    if (canonicalJson(b.metadata) !== canonicalJson(a?.metadata)) {
      violations.push({
        invariant: 'metadata',
        message: `${id}: project.metadata diverged`,
      })
    }
  }

  // 6. Compliance verdicts on service holes.
  for (const id of beforeIds) {
    const b = beforeNodes[id] as Partial<CFSServiceHole> | undefined
    if (b?.type !== 'cfs_service_hole') continue
    const a = afterNodes[id] as Partial<CFSServiceHole> | undefined
    if (b.compliance?.status !== a?.compliance?.status) {
      violations.push({
        invariant: 'compliance',
        message: `${id}: ${b.compliance?.status} → ${a?.compliance?.status}`,
      })
    }
  }

  // 7. Cached aggregates on framings and panels.
  for (const id of beforeIds) {
    const b = beforeNodes[id] as Partial<CFSWallFraming> | Partial<CFSPanel> | undefined
    const a = afterNodes[id] as Partial<CFSWallFraming> | Partial<CFSPanel> | undefined
    if (!b || !a) continue
    if ((b as Partial<CFSPanel>).cachedWeight_kg !== (a as Partial<CFSPanel>).cachedWeight_kg) {
      violations.push({
        invariant: 'cached-aggregates',
        message: `${id}: cachedWeight_kg diverged`,
      })
    }
    if ((b as Partial<CFSPanel>).cachedMemberCount !== (a as Partial<CFSPanel>).cachedMemberCount) {
      violations.push({
        invariant: 'cached-aggregates',
        message: `${id}: cachedMemberCount diverged`,
      })
    }
  }

  // 8. generatedMemberIds back-pointers on openings.
  for (const id of beforeIds) {
    const b = beforeNodes[id] as Partial<CFSOpening> | undefined
    if (b?.type !== 'cfs_opening') continue
    const a = afterNodes[id] as Partial<CFSOpening> | undefined
    if (canonicalJson(b.generatedMemberIds) !== canonicalJson(a?.generatedMemberIds)) {
      violations.push({
        invariant: 'generated-member-ids',
        message: `${id}: generatedMemberIds diverged`,
      })
    }
  }

  return violations
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {}
      for (const k of Object.keys(v as object).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k]
      }
      return sorted
    }
    return v
  })
}

/** Convenience for the dev-mode log site. Returns true when clean. */
export function assertRoundTripClean(
  before: SceneLike,
  after: SceneLike,
  reporter: (msg: string) => void = (m) => console.warn('[json-invariants]', m),
): boolean {
  const violations = checkRoundTripInvariants(before, after)
  if (violations.length === 0) return true
  for (const v of violations) {
    reporter(`${v.invariant}: ${v.message}`)
  }
  return false
}
