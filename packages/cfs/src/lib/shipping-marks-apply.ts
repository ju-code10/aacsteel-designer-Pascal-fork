// §6.0 — scene-touching side of the shipping-marks pass. Lives in its own
// file so the pure planner (`shipping-marks.ts`) stays importable from
// unit tests without dragging `@pascal-app/core` into the runtime.

import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import type { CFSMember } from '../schema/cfs-member'
import { withBatchedUndo } from '../store/with-batched-undo'
import { planShippingMarks } from './shipping-marks'
import type { SceneLike } from './scene-walk'

/**
 * Apply the planned marks to the scene. Diff-only: members whose computed
 * mark already matches their stored value are not touched. Re-running on
 * an unchanged scene therefore writes nothing.
 *
 * Returns the number of members whose mark was rewritten. Useful for
 * tests and the cross-export invariant suite.
 */
export function applyShippingMarks(): { written: number } {
  const scene = useScene.getState() as unknown as SceneLike
  const planned = planShippingMarks(scene)
  let written = 0

  withBatchedUndo('compute shipping marks', () => {
    const live = useScene.getState()
    for (const [memberId, mark] of planned) {
      const node = scene.nodes[memberId] as CFSMember | undefined
      if (!node) continue
      if (node.shippingMark === mark) continue
      live.updateNode(
        memberId as unknown as AnyNodeId,
        { shippingMark: mark } as unknown as Partial<AnyNode>,
      )
      written++
    }
  })
  return { written }
}
