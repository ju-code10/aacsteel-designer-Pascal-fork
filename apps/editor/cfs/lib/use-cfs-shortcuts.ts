'use client'

import { useCFS } from '@pascal-app/cfs'
import { useEffect } from 'react'

/**
 * §7.6 — keyboard shortcuts for the CFS toolset. Hook is conditional on
 * `isCFSMode === true`: when CFS mode is off, no listener is registered, so
 * Pascal's own bindings work unchanged. When CFS mode is on, the shortcuts
 * below win.
 *
 * Single-key shortcuts (`T`, `W`, `H`, `Esc`) only fire when no input
 * element has focus, so typing into a project-name field doesn't activate
 * a tool.
 *
 * Slice 6 adds `H` for the service-hole tool; `T` and `W` for door/window
 * tools were not yet wired in Slice 4 but get hooked here too so the slice
 * also delivers the tool keyboard surface as a polish bonus.
 */

const TOOL_SHORTCUTS: Record<string, 'cfs-door' | 'cfs-window' | 'cfs-service-hole'> = {
  KeyT: 'cfs-door',
  KeyW: 'cfs-window',
  KeyH: 'cfs-service-hole',
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  if (target.tagName === 'INPUT') return true
  if (target.tagName === 'TEXTAREA') return true
  if (target.tagName === 'SELECT') return true
  if (target.isContentEditable) return true
  return false
}

export function useCFSShortcuts(isActive: boolean): void {
  useEffect(() => {
    if (!isActive) return
    const handler = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return // skip modifier combos
      if (e.code === 'Escape') {
        useCFS.getState().setActiveTool(null)
        return
      }
      const tool = TOOL_SHORTCUTS[e.code]
      if (!tool) return
      e.preventDefault()
      const cfs = useCFS.getState()
      cfs.setActiveTool(cfs.activeTool === tool ? null : tool)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isActive])
}
