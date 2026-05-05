'use client'

import {
  CFSFramingSystem,
  CFSOpeningWatcher,
  CFSWallWatcher,
  ssmaLibraryJson,
  useCFS,
} from '@pascal-app/cfs'
import { useEffect } from 'react'
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
 * not extensible from outside. The systems instead subscribe to `useScene`
 * directly, satisfying the dirty-node contract without a Canvas dependency.
 * See packages/cfs/src/systems/framing-system.tsx for the deeper note.
 */
export function CFSRoot(): React.JSX.Element {
  const loadLibrary = useCFS((s) => s.loadLibrary)
  const hasLibrary = useCFS((s) => Object.keys(s.memberLibraries).length > 0)

  useEffect(() => {
    if (hasLibrary) return
    void loadLibrary(ssmaLibraryJson)
  }, [loadLibrary, hasLibrary])

  return (
    <>
      <CFSWallWatcher />
      <CFSOpeningWatcher />
      <CFSFramingSystem />
      <CFSDoorTool />
      <CFSWindowTool />
      <InspectorPanel />
    </>
  )
}
