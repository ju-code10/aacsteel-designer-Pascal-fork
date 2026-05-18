'use client'

import { useScene } from '@pascal-app/core'
import {
  CFSFramingSystem,
  CFSOpeningWatcher,
  CFSServiceHoleSystem,
  CFSSlabWatcher,
  CFSWallWatcher,
  ssmaLibraryJson,
  useCFS,
} from '@pascal-app/cfs'
import { useEffect } from 'react'
import {
  applyCeilingAffordanceVisibility,
  resetCeilingAffordanceVisibilityCache,
} from '../lib/affordance-visibility'
import { useCFSWallClickForwarder } from '../lib/use-cfs-click-forwarder'
import { useCFSShortcuts } from '../lib/use-cfs-shortcuts'
import { applyWallVisibility, resetWallVisibilityCache } from '../lib/wall-visibility'
import { CFSGeometrySystem } from '../systems/CFSGeometrySystem'
import { CFSPanelizationSystem } from '../systems/CFSPanelizationSystem'
import { CFSPanelOverlay } from '../systems/CFSPanelOverlay'
import { InspectorPanel } from './panels/InspectorPanel'
import { ShortcutsPanel } from './panels/ShortcutsPanel'
import { CFSDoorTool } from './tools/CFSDoorTool'
import { CFSPanelBreakTool } from './tools/CFSPanelBreakTool'
import { CFSServiceHoleTool } from './tools/CFSServiceHoleTool'
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
  const isCFSMode = useCFS((s) => s.isCFSMode)
  // §7.6 — register tool shortcuts (T/W/H/Esc) only while in CFS mode so
  // Pascal's bindings remain unaffected in architectural mode.
  useCFSShortcuts(isCFSMode)
  // wall-visibility.ts hides Pascal walls when CFS mode is on, which
  // also blocks R3F from dispatching wall:click events on them. The
  // forwarder raycasts the CFS framing group on every canvas click and
  // synthesizes a Pascal wall:click on hit, so the Panel Break / Door /
  // Window / Service Hole tools still work in 3D CFS mode.
  useCFSWallClickForwarder(isCFSMode)

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

  // Hide Pascal's CeilingSelectionAffordanceSystem brackets in CFS mode.
  // They render via R3F createPortal, so we defer one tick after scene
  // mutations to let R3F mount the new affordance Groups before we hide
  // them. Each call walks at most a handful of Group children per level,
  // so re-applying is cheap.
  useEffect(() => {
    const apply = () => applyCeilingAffordanceVisibility(useCFS.getState().isCFSMode)
    apply()
    const unsubCfs = useCFS.subscribe((s, prev) => {
      if (s.isCFSMode !== prev.isCFSMode) apply()
    })
    const unsubScene = useScene.subscribe((s, prev) => {
      if (s.nodes !== prev.nodes) setTimeout(apply, 50)
    })
    return () => {
      unsubCfs()
      unsubScene()
      resetCeilingAffordanceVisibilityCache()
    }
  }, [])

  return (
    <>
      <CFSWallWatcher />
      <CFSOpeningWatcher />
      <CFSSlabWatcher />
      <CFSFramingSystem />
      <CFSGeometrySystem />
      <CFSServiceHoleSystem />
      <CFSPanelizationSystem />
      <CFSPanelOverlay />
      <CFSDoorTool />
      <CFSWindowTool />
      <CFSServiceHoleTool />
      <CFSPanelBreakTool />
      <InspectorPanel />
      <ShortcutsPanel />
      {isCFSMode ? <PascalPanelSuppressor /> : null}
    </>
  )
}

/**
 * Hide Pascal's node-property panels (CeilingPanel, SlabPanel, etc.) while
 * CFS mode is on. Those panels live in `packages/editor` (read-only
 * upstream) and pop up at the top-right whenever a Pascal node is selected
 * — so clicking near a wall in CFS mode can surface a "Room N Ceiling"
 * inspector that's confusing in the CFS workflow. The CFS InspectorPanel
 * at the bottom-right is the single source of truth in CFS mode.
 *
 * Match Pascal's `PanelWrapper` by its stable Tailwind class combo
 * (`fixed top-20 right-4 z-50`). If upstream ever changes those
 * utilities, the panels will start showing through again — at which
 * point we should add a data-attribute upstream rather than chase the
 * selector.
 */
function PascalPanelSuppressor(): React.JSX.Element {
  return (
    <style>{`
      .fixed.top-20.right-4.z-50 { display: none !important; }
    `}</style>
  )
}
