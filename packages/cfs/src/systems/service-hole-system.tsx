'use client'

import { useScene } from '@pascal-app/core'
import { useEffect } from 'react'
import { useCFS } from '../store/use-cfs'
import { runServiceHolePass } from './service-hole-pass'

/**
 * §5.4 `CFSServiceHoleSystem` — headless component that owns
 * `CFSServiceHole.compliance` for every service hole in the scene.
 *
 * Runs once on mount, then on every `useScene.nodes` change and on the
 * cross-store triggers that affect validation (active library, mode toggle,
 * library map). Mirrors `CFSFramingSystem` and `CFSGeometrySystem` so the
 * three behave identically with respect to dirty propagation under Pascal's
 * extension constraints.
 *
 * The pass itself is idempotent: if a hole's recomputed verdict matches the
 * stored one, no write happens, so the subscriber does not re-fire.
 * Round-trip safety (HOL-10) follows from the same equivalence check.
 */
export function CFSServiceHoleSystem(): null {
  useEffect(() => {
    runServiceHolePass()

    const unsubScene = useScene.subscribe((state, prev) => {
      if (state.nodes !== prev.nodes) runServiceHolePass()
    })

    const unsubCfs = useCFS.subscribe((state, prev) => {
      if (
        state.activeLibraryId !== prev.activeLibraryId ||
        state.isCFSMode !== prev.isCFSMode ||
        state.memberLibraries !== prev.memberLibraries
      ) {
        runServiceHolePass()
      }
    })

    return () => {
      unsubScene()
      unsubCfs()
    }
  }, [])

  return null
}
