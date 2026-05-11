'use client'

import { useScene } from '@pascal-app/core'
import {
  runPanelizationPass,
  useCFS,
  type CFSWallFramingId,
} from '@pascal-app/cfs'
import { useEffect, useRef } from 'react'

/**
 * §5.5 — `CFSPanelizationSystem` mount.
 *
 * Trigger model (§5.5, distinct from the other systems):
 *   1. **User-initiated.** The "Panelize" button or `B` shortcut calls
 *      `useCFS.requestPanelize(framingId)`, which adds the framing to a
 *      pending set and dirties the framing. We see the dirty event, see
 *      the framing in the pending set, and run the pass.
 *   2. **Settings cascade.** When `CFSProject.settings` changes (§4.8
 *      dirties every framing), we run the pass *only* for framings that
 *      already have at least one `CFSPanel` child. Walls the user hasn't
 *      opted into panelization for are left alone.
 *   3. **Manual break.** `CFSPanelBreakTool` creates a sentinel `CFSPanel`
 *      with `isManualBreak: true` and calls `requestPanelize`, so the
 *      same user-initiated path handles it.
 *
 * Crucially we ignore framing dirties from the framing pass itself
 * (members added/changed). The framing system handles geometry; we re-run
 * panelization only on explicit user request or settings change.
 */
export function CFSPanelizationSystem(): null {
  // Track previous scene `nodes` ref so we can detect settings cascades.
  const lastSeenProjectSettingsRef = useRef<unknown>(null)

  useEffect(() => {
    const tick = () => {
      const cfsState = useCFS.getState()
      if (!cfsState.isCFSMode) return
      const sceneState = useScene.getState()

      // Collect dirty framings that we should process.
      const pending = cfsState.pendingPanelizeFramingIds
      const dirtyFramingIds: CFSWallFramingId[] = []
      for (const id of sceneState.dirtyNodes) {
        const node = sceneState.nodes[id]
        if (!node) continue
        if ((node as { type?: string }).type !== 'cfs_wall_framing') continue
        dirtyFramingIds.push(id as unknown as CFSWallFramingId)
      }
      if (dirtyFramingIds.length === 0) return

      const projectNode = Object.values(sceneState.nodes).find(
        (n) => (n as { type?: string }).type === 'cfs_project',
      ) as { settings?: unknown } | undefined
      const settingsRef = projectNode?.settings ?? null
      const settingsChanged =
        settingsRef !== null && settingsRef !== lastSeenProjectSettingsRef.current
      lastSeenProjectSettingsRef.current = settingsRef

      const setWarnings = useCFS.getState().setPanelizationWarnings
      const consume = useCFS.getState().consumePendingPanelize

      for (const framingId of dirtyFramingIds) {
        const userInitiated = pending.has(framingId)
        const hasPanels = Object.values(sceneState.nodes).some(
          (n) =>
            (n as { type?: string }).type === 'cfs_panel' &&
            (n as { parentId?: string }).parentId === framingId,
        )
        const shouldRun = userInitiated || (settingsChanged && hasPanels)
        if (!shouldRun) continue

        const result = runPanelizationPass(framingId)
        if (userInitiated) consume(framingId)

        const warnings = (result.warnings ?? []).map((w) =>
          `Manual break at ${Math.round(w.panelEnd_mm)} mm exceeds max panel width ${w.limit_mm} mm.`,
        )
        if (result.error) warnings.push(result.error)
        setWarnings(framingId, warnings)
      }
    }

    // Initial run in case there's pending state from before mount.
    tick()

    const unsubScene = useScene.subscribe((s, prev) => {
      if (s.dirtyNodes !== prev.dirtyNodes || s.nodes !== prev.nodes) tick()
    })
    const unsubCfs = useCFS.subscribe((s, prev) => {
      if (
        s.isCFSMode !== prev.isCFSMode ||
        s.pendingPanelizeFramingIds !== prev.pendingPanelizeFramingIds
      ) {
        tick()
      }
    })

    return () => {
      unsubScene()
      unsubCfs()
    }
  }, [])

  return null
}
