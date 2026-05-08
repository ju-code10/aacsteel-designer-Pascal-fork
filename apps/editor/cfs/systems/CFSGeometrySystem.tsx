'use client'

import { useScene } from '@pascal-app/core'
import { useCFS } from '@pascal-app/cfs'
import { useEffect } from 'react'
import {
  createGeometryPassContext,
  runGeometryPass,
  teardownGeometryPassContext,
} from './geometry-pass'

/**
 * §5.3 `CFSGeometrySystem` — headless React component that owns every CFS
 * member's mesh in Pascal's scene. Mounts once at the editor root via
 * `<CFSRoot>`. Runs as a Zustand subscriber rather than the spec-suggested
 * `useFrame` callback because Pascal's `<Editor>` exposes no Canvas-children
 * slot (verified in [`packages/editor/src/components/editor/index.tsx`](../../../../packages/editor/src/components/editor/index.tsx);
 * `<Viewer>` is rendered with a hardcoded `<ViewerSceneContent>` child).
 *
 * The actual geometry-pass logic lives in
 * [`geometry-pass.ts`](./geometry-pass.ts) so it can be unit-tested without
 * mounting React or R3F.
 *
 * Spec deviation noted in [`framing-system.tsx`](../../../packages/cfs/src/systems/framing-system.tsx)
 * applies here too: the dirty-node *contract* (process changed nodes only;
 * leave the scene unchanged when nothing relevant moved) is preserved via
 * per-member signature comparison in the pass; the dirty-set drain
 * mechanism is replaced by store subscriptions.
 */
export function CFSGeometrySystem(): null {
  useEffect(() => {
    const ctx = createGeometryPassContext()
    runGeometryPass(ctx)

    const unsubScene = useScene.subscribe((state, prev) => {
      if (state.nodes !== prev.nodes) runGeometryPass(ctx)
    })

    const unsubCfs = useCFS.subscribe((state, prev) => {
      if (
        state.activeLibraryId !== prev.activeLibraryId ||
        state.isCFSMode !== prev.isCFSMode ||
        state.memberLibraries !== prev.memberLibraries
      ) {
        runGeometryPass(ctx)
      }
    })

    return () => {
      unsubScene()
      unsubCfs()
      teardownGeometryPassContext(ctx)
    }
  }, [])

  return null
}
