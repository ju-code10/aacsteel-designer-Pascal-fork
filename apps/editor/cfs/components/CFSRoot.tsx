'use client'

import { useScene } from '@pascal-app/core'
import {
  CFSFramingSystem,
  CFSOpeningWatcher,
  CFSWallWatcher,
  ssmaLibraryJson,
  useCFS,
} from '@pascal-app/cfs'
import { useEffect } from 'react'
import { applyWallVisibility, resetWallVisibilityCache } from '../lib/wall-visibility'
import { CFSGeometrySystem } from '../systems/CFSGeometrySystem'
import { InspectorPanel } from './panels/InspectorPanel'
import { CFSDoorTool } from './tools/CFSDoorTool'
import { CFSWindowTool } from './tools/CFSWindowTool'

/**
 * CFSRoot mounts the headless CFS systems and the floating inspector. It is
 * mounted as a sibling of `<Editor>` from `app/page.tsx`. The library is
 * hydrated unconditionally so it is ready before the user first toggles CFS
 * mode. The inspector renders only when CFS mode is on.
 *
 * Slice 3 architectural note: §5.1 prescribes mounting systems inside
 * Pascal's Canvas-children group. That group is in `@pascal-app/viewer` and
 * not extensible from outside (verified in
 * `packages/editor/src/components/editor/index.tsx:694` — `<Viewer>` is
 * rendered with a hardcoded `<ViewerSceneContent>` child). All four CFS
 * systems below run as Zustand subscribers instead. The geometry system
 * (added in slice 5) reaches into Pascal's `THREE.Scene` via
 * [pascal-scene-bridge.ts](../lib/pascal-scene-bridge.ts) — see that file
 * for the Object3D-parent-walk strategy.
 */
export function CFSRoot(): React.JSX.Element {
  const loadLibrary = useCFS((s) => s.loadLibrary)
  const hasLibrary = useCFS((s) => Object.keys(s.memberLibraries).length > 0)

  useEffect(() => {
    if (hasLibrary) return
    void loadLibrary(ssmaLibraryJson)
  }, [loadLibrary, hasLibrary])

  // Slice 5.2 — toggle Pascal wall visibility on CFS-mode change AND on
  // any scene mutation (so walls created after CFS mode is on still
  // become invisible). Cheap: per call iterates only the wall registry.
  useEffect(() => {
    applyWallVisibility(useCFS.getState().isCFSMode)
    const unsubCfs = useCFS.subscribe((s, prev) => {
      if (s.isCFSMode !== prev.isCFSMode) applyWallVisibility(s.isCFSMode)
    })
    const unsubScene = useScene.subscribe((s, prev) => {
      if (s.nodes !== prev.nodes) applyWallVisibility(useCFS.getState().isCFSMode)
    })
    return () => {
      unsubCfs()
      unsubScene()
      resetWallVisibilityCache()
    }
  }, [])

  return (
    <>
      <CFSWallWatcher />
      <CFSOpeningWatcher />
      <CFSFramingSystem />
      <CFSGeometrySystem />
      <CFSDoorTool />
      <CFSWindowTool />
      <InspectorPanel />
    </>
  )
}
