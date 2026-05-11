// §6.0 — shipping marks (pure planner).
//
// Format:  `{panelLabel}-{roleCode}{sequence}`
//
// Sequence is 1-based per (panel, roleCode), assigned in left-to-right
// (mid-x along the member's wall) order. The planner is pure and
// deterministic — re-running on an unchanged scene reproduces every
// member's mark exactly.
//
// `applyShippingMarks` lives in `shipping-marks-apply.ts` because it
// touches `useScene` and pulls in `@pascal-app/core`; keeping the planner
// import-clean lets `bun:test` exercise it without bringing three.js into
// the test runtime.

import type { CFSMember } from '../schema/cfs-member'
import type { CFSPanel } from '../schema/cfs-panel'
import type { CFSMemberRole } from '../schema/primitives'
import { isRealPanel } from '../schema/cfs-panel'
import type { SceneLike } from './scene-walk'

const ROLE_CODE: Record<CFSMemberRole, string> = {
  'top-track': 'TT',
  'bottom-track': 'BT',
  stud: 'S',
  'chord-stud': 'C',
  'king-stud': 'K',
  'jamb-stud': 'J',
  header: 'H',
  sill: 'SL',
  'sill-track': 'ST',
  cripple: 'CR',
}

export function roleCode(role: CFSMemberRole): string {
  return ROLE_CODE[role]
}

interface NodeBase {
  type?: string
  id: string
  parentId?: string | null
}

function midpointForSort(m: CFSMember): number {
  const x = (m.start.x_mm + m.end.x_mm) / 2
  const y = (m.start.y_mm + m.end.y_mm) / 2
  return x + y / 1_000_000
}

/**
 * Pure planner — returns the mark each member should carry.
 */
export function planShippingMarks(scene: SceneLike): Map<string, string> {
  const out = new Map<string, string>()

  const byPanel = new Map<string, CFSMember[]>()
  for (const node of Object.values(scene.nodes)) {
    if ((node as NodeBase).type !== 'cfs_member') continue
    const m = node as CFSMember
    if (!m.panelId) continue
    let arr = byPanel.get(m.panelId)
    if (!arr) {
      arr = []
      byPanel.set(m.panelId, arr)
    }
    arr.push(m)
  }

  for (const [panelId, members] of byPanel.entries()) {
    const panel = scene.nodes[panelId] as CFSPanel | undefined
    if (!panel || !isRealPanel(panel)) continue
    const label = panel.label

    const byRole = new Map<CFSMemberRole, CFSMember[]>()
    for (const m of members) {
      let arr = byRole.get(m.role)
      if (!arr) {
        arr = []
        byRole.set(m.role, arr)
      }
      arr.push(m)
    }
    for (const [role, arr] of byRole.entries()) {
      arr.sort((a, b) => midpointForSort(a) - midpointForSort(b))
      const code = ROLE_CODE[role]
      arr.forEach((m, i) => {
        out.set(m.id, `${label}-${code}${i + 1}`)
      })
    }
  }
  return out
}
