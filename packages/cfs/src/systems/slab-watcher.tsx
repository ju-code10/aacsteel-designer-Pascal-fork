'use client'

import { useScene } from '@pascal-app/core'
import { useEffect } from 'react'
import { processSlabChanges } from './slab-watcher-logic'

/**
 * Headless React component that re-dirties CFS wall framings when Pascal
 * slabs change. Must be mounted **before** `CFSFramingSystem` so its
 * subscriber fires first on the same scene-store notification — the
 * framing-system subscriber then reads the dirty framings we just marked.
 *
 * See `slab-watcher-logic.ts` for the rationale.
 */
export function CFSSlabWatcher(): null {
  useEffect(() => {
    const unsub = useScene.subscribe((state, prev) => {
      if (state.nodes === prev.nodes) return
      processSlabChanges(
        state.nodes as never,
        prev.nodes as never,
      )
    })
    return unsub
  }, [])
  return null
}
