'use client'

import { ssmaLibraryJson, useCFS } from '@pascal-app/cfs'
import { useEffect } from 'react'

// Mounted unconditionally — independent of isCFSMode — so the SSMA member
// library is hydrated before the user toggles CFS mode for the first time.
// Renders nothing; surfaces load errors through useCFS.libraryLoadError for
// downstream UI (inspector, toggle hover state).
export function CFSRoot(): null {
  const loadLibrary = useCFS((s) => s.loadLibrary)
  const hasLibrary = useCFS((s) => Object.keys(s.memberLibraries).length > 0)

  useEffect(() => {
    if (hasLibrary) return
    void loadLibrary(ssmaLibraryJson)
  }, [loadLibrary, hasLibrary])

  return null
}
