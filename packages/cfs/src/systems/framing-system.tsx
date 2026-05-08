'use client'

import { useScene } from '@pascal-app/core'
import { useEffect } from 'react'
import { useCFS } from '../store/use-cfs'
import { runFramingPass } from './framing-pass'

/**
 * §5.1 CFSFramingSystem — headless component that owns the layout of every
 * `cfs_member` on every `cfs_wall_framing`.
 *
 * Architectural deviation from §5.1's "useFrame inside the systems group":
 * Pascal's Canvas-children group lives in `@pascal-app/viewer` and is not
 * extensible from outside (per §0.3 we may not modify upstream packages, and
 * `<Editor>` exposes no Canvas-children slot). We satisfy the dirty-node
 * contract by subscribing to `useScene` instead. Every Pascal mutation calls
 * `set()` on `nodes`, which fires the subscriber; we then drain dirty ids of
 * our types. Cross-store triggers (`useCFS.activeLibraryId`,
 * `useCFS.isCFSMode`) need their own subscription because Pascal's
 * `markDirty` mutates the dirty Set in place without `set()` and would not
 * otherwise wake us.
 *
 * Slice G note: §5.1's "useFrame" wording is implementation-specific and was
 * written before the Pascal extension constraint was understood. The dirty-
 * node *contract* (process dirty when it changes; clear after processing) is
 * preserved.
 */
export function CFSFramingSystem(): null {
  useEffect(() => {
    runFramingPass()

    const unsubScene = useScene.subscribe((state, prev) => {
      if (state.nodes !== prev.nodes) runFramingPass()
    })

    const unsubCfs = useCFS.subscribe((state, prev) => {
      if (
        state.activeLibraryId !== prev.activeLibraryId ||
        state.isCFSMode !== prev.isCFSMode ||
        state.memberLibraries !== prev.memberLibraries
      ) {
        runFramingPass()
      }
    })

    return () => {
      unsubScene()
      unsubCfs()
    }
  }, [])

  return null
}
