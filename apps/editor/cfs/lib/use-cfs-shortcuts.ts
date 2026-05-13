'use client'

import { useCFS } from '@pascal-app/cfs'
import { emitter, useScene } from '@pascal-app/core'
import { useEffect, useState } from 'react'
import { SHORTCUTS, type ShortcutId } from './shortcuts'
import { exportActions } from './use-export'

/**
 * §7.6 — CFS keyboard shortcuts.
 *
 * Bindings come from `shortcuts.ts`. The hook is conditional on
 * `isCFSMode === true` for the tool / Esc / shortcut-panel cluster;
 * the mode-toggle (`M`) and the help panel (`?`) listen unconditionally
 * so the user can flip into CFS mode from architectural mode and back
 * via the keyboard.
 *
 * Single-letter shortcuts only fire when no input element has focus.
 */

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  if (target.tagName === 'INPUT') return true
  if (target.tagName === 'TEXTAREA') return true
  if (target.tagName === 'SELECT') return true
  if (target.isContentEditable) return true
  return false
}

const HANDLERS: Record<ShortcutId, () => void> = {
  'cfs:mode:toggle': () => {
    const s = useCFS.getState()
    s.setCFSMode(!s.isCFSMode)
  },
  'cfs:tool:opening': () => activateTool('cfs-door'),
  'cfs:tool:window': () => activateTool('cfs-window'),
  'cfs:tool:service-hole': () => activateTool('cfs-service-hole'),
  'cfs:tool:panel-break': () => activateTool('cfs-panel-break'),
  'cfs:action:panelize': () => {
    const scene = useScene.getState()
    const req = useCFS.getState().requestPanelize
    for (const n of Object.values(scene.nodes)) {
      if ((n as { type?: string }).type === 'cfs_wall_framing') {
        req((n as { id: string }).id)
      }
    }
  },
  'cfs:action:cancel': () => {
    useCFS.getState().setActiveTool(null)
  },
  'cfs:export:menu': () => exportActions.toggleMenu(),
  'cfs:export:bom': () => exportActions.exportBOM(),
  'cfs:export:dxf': () => exportActions.exportDXFs(),
  'cfs:export:pdf': () => exportActions.exportShopDrawings(),
  'cfs:export:json': () => exportActions.exportJSON(),
  'cfs:help:shortcuts': () => helpPanelActions.toggle(),
}

type ActiveTool = 'cfs-door' | 'cfs-window' | 'cfs-service-hole' | 'cfs-panel-break'

function activateTool(tool: ActiveTool): void {
  const cfs = useCFS.getState()
  cfs.setActiveTool(cfs.activeTool === tool ? null : tool)
}

// Tool / Esc / Panelize shortcuts only fire in CFS mode; help and mode-toggle
// fire anywhere.
const ALWAYS_ON: ShortcutId[] = ['cfs:mode:toggle', 'cfs:help:shortcuts']

export function useCFSShortcuts(isCFSMode: boolean): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Single-letter shortcuts (no modifier) bail when typing into a field.
      const isModifierCombo = e.metaKey || e.ctrlKey || e.altKey
      if (!isModifierCombo && isEditableTarget(e.target)) return

      for (const def of SHORTCUTS) {
        if (!def.match(e)) continue
        if (!isCFSMode && !ALWAYS_ON.includes(def.id)) continue
        // §7.6.3 conflict resolution: Pascal listens on `window` for `t`/`b`
        // (`packages/editor/src/hooks/use-keyboard.ts`); without
        // stopPropagation, both the CFS tool AND Pascal's tool activate
        // when CFS mode is on. We capture on `document`, run first, and
        // stop the bubble before Pascal's window listener sees it.
        //
        // Exception — Esc (`cfs:action:cancel`): we deliberately let the
        // event continue to Pascal so its window-level Esc handler also
        // runs and emits `tool:cancel`. That gives us a second cancel
        // path through the emitter subscription below — if for any reason
        // this keydown handler doesn't reach (focus on an upstream
        // element with its own keydown, a stopPropagation from an
        // intermediate handler, etc.), the tool still clears.
        e.preventDefault()
        if (def.id !== 'cfs:action:cancel') {
          e.stopPropagation()
        }
        HANDLERS[def.id]()
        return
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isCFSMode])

  // Belt-and-suspenders: Pascal emits `tool:cancel` on Esc (and via any
  // other tool-cancel UI path it has). Subscribe so a CFS tool clears
  // whenever Pascal's cancel fires — independent of whether our keydown
  // handler above ran. setActiveTool(null) is idempotent when there is
  // no active tool, so this is safe even outside CFS mode.
  useEffect(() => {
    const onCancel = () => {
      useCFS.getState().setActiveTool(null)
    }
    emitter.on('tool:cancel', onCancel)
    return () => {
      emitter.off('tool:cancel', onCancel)
    }
  }, [])
}

// ── Help panel signal ──────────────────────────────────────────────────────
// The ShortcutsPanel subscribes to this tiny module-level toggle. Stays
// here (not in use-export) because it is unrelated to export status.

let helpOpen = false
const helpListeners = new Set<() => void>()

function notify(): void {
  for (const l of helpListeners) l()
}

export const helpPanelActions = {
  open: () => {
    helpOpen = true
    notify()
  },
  close: () => {
    helpOpen = false
    notify()
  },
  toggle: () => {
    helpOpen = !helpOpen
    notify()
  },
}

export function useHelpPanelOpen(): boolean {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    helpListeners.add(l)
    return () => {
      helpListeners.delete(l)
    }
  }, [])
  return helpOpen
}
