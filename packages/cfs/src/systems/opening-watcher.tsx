'use client'

import { useScene } from '@pascal-app/core'
import { useEffect, useRef } from 'react'
import {
  propagateDeletedOpenings,
  propagateDirtyOpenings,
} from './opening-watcher-logic'

/**
 * Headless React component that converts opening lifecycle events into
 * framing dirty markers. Three trigger paths:
 *
 * 1. `cfs_opening` is created/updated → dirty set contains the opening id;
 *    we mark its parent `cfs_wall_framing` dirty. The framing pass picks it
 *    up next tick.
 * 2. `cfs_opening` is deleted → the opening is already gone from `nodes`,
 *    but `prev.nodes` still has it. We diff prev↔current to find removed
 *    opening ids and dirty the (still-present) parent framings.
 * 3. CFS mode flips on → existing openings are processed via path 1 if
 *    they are dirty; otherwise no-op (the wall watcher ensures every wall
 *    has a framing on first toggle and the framing pass runs from there).
 */
export function CFSOpeningWatcher(): null {
  const prevNodesRef = useRef(useScene.getState().nodes)

  useEffect(() => {
    const unsub = useScene.subscribe((state, prev) => {
      if (state.nodes !== prev.nodes) {
        propagateDeletedOpenings(state.nodes, prev.nodes)
      }
      // Also process dirty markers any time the dirty set or nodes change.
      // Pascal mutations always set both; updates change `nodes` reference.
      propagateDirtyOpenings()
      prevNodesRef.current = state.nodes
    })
    // Initial sweep — covers the case where openings are present at mount.
    propagateDirtyOpenings()
    return unsub
  }, [])

  return null
}
