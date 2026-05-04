'use client'

import { useScene } from '@pascal-app/core'
import { useEffect } from 'react'
import { useCFS } from '../store/use-cfs'
import { processDirtyWalls, sweepWallsForFraming } from './wall-watcher-logic'

/**
 * Headless React component that bridges Pascal's wall lifecycle into CFS.
 *
 * Two trigger paths:
 * 1. `useCFS.isCFSMode` flips on → sweep every existing Pascal wall and
 *    create a framing for any wall that lacks one (per §7.1 first-toggle).
 * 2. `useScene.nodes` changes → process dirty walls only. New walls dirty
 *    themselves on creation; edits dirty themselves on update.
 *
 * Both paths are idempotent.
 */
export function CFSWallWatcher(): null {
  useEffect(() => {
    if (useCFS.getState().isCFSMode) sweepWallsForFraming()

    const unsubScene = useScene.subscribe((state, prev) => {
      if (state.nodes !== prev.nodes) processDirtyWalls()
    })

    const unsubCfs = useCFS.subscribe((state, prev) => {
      if (state.isCFSMode && !prev.isCFSMode) sweepWallsForFraming()
    })

    return () => {
      unsubScene()
      unsubCfs()
    }
  }, [])

  return null
}
