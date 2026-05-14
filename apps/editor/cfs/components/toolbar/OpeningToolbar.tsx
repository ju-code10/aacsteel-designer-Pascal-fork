'use client'

import { useCFS } from '@pascal-app/cfs'
import type { CFSActiveTool } from '@pascal-app/cfs'
import { useScene } from '@pascal-app/core'
import { shortcutHint } from '../../lib/shortcuts'
import {
  OPENING_TOOL_DOOR_LABEL,
  OPENING_TOOL_DOOR_TOOLTIP,
  OPENING_TOOL_WINDOW_LABEL,
  OPENING_TOOL_WINDOW_TOOLTIP,
  PANEL_BREAK_TOOL_LABEL,
  PANEL_BREAK_TOOL_TOOLTIP,
  PANELIZE_ACTION_LABEL,
  PANELIZE_ACTION_TOOLTIP,
  SERVICE_HOLE_TOOL_LABEL,
  SERVICE_HOLE_TOOL_TOOLTIP,
  SETTINGS_TAB_LABEL,
} from '../../lib/strings'

const BUTTON_BASE =
  'rounded-md px-3 py-1.5 text-xs font-medium border transition-colors'
const BUTTON_INACTIVE =
  'border-border bg-background text-foreground hover:bg-muted'
const BUTTON_ACTIVE = 'border-primary bg-primary text-primary-foreground'
// Primary one-shot action: filled, accent-bordered, distinct from the modal
// tool buttons so the user reads "Panelize All" as a single command rather
// than a tool to activate.
const BUTTON_PRIMARY_ACTION =
  'border-primary bg-primary text-primary-foreground hover:bg-primary/90'

/**
 * CFS-mode toolbar. Slice 1 added the mode toggle; slice 4 added the
 * door/window/service-hole tool buttons; slice 7 adds the panel-break tool,
 * the Panelize one-shot action, and the Settings tab affordance.
 *
 * The toolbar still talks to `useCFS.activeTool` for modal tools; the
 * Panelize button is a one-shot action that calls `requestPanelize` for
 * every framing in the scene.
 */
export function OpeningToolbar(): React.JSX.Element | null {
  const isCFSMode = useCFS((s) => s.isCFSMode)
  const activeTool = useCFS((s) => s.activeTool)
  const setActiveTool = useCFS((s) => s.setActiveTool)
  const inspectorTab = useCFS((s) => s.inspectorTab)
  const setInspectorTab = useCFS((s) => s.setInspectorTab)

  if (!isCFSMode) return null

  const click = (tool: NonNullable<CFSActiveTool>) => () => {
    setActiveTool(activeTool === tool ? null : tool)
  }

  const panelizeAll = () => {
    const scene = useScene.getState()
    const framingIds: string[] = []
    for (const n of Object.values(scene.nodes)) {
      if ((n as { type?: string }).type === 'cfs_wall_framing') {
        framingIds.push((n as { id: string }).id)
      }
    }
    const req = useCFS.getState().requestPanelize
    for (const id of framingIds) req(id)
  }

  const toggleSettings = () => {
    setInspectorTab(inspectorTab === 'settings' ? 'wall' : 'settings')
  }

  return (
    <div className="flex items-center gap-1" role="group" aria-label="CFS tools">
      <button
        type="button"
        className={`${BUTTON_BASE} ${activeTool === 'cfs-door' ? BUTTON_ACTIVE : BUTTON_INACTIVE}`}
        onClick={click('cfs-door')}
        title={`${OPENING_TOOL_DOOR_TOOLTIP} ${shortcutHint('cfs:tool:opening')}`}
        aria-pressed={activeTool === 'cfs-door'}
      >
        {OPENING_TOOL_DOOR_LABEL}
      </button>
      <button
        type="button"
        className={`${BUTTON_BASE} ${activeTool === 'cfs-window' ? BUTTON_ACTIVE : BUTTON_INACTIVE}`}
        onClick={click('cfs-window')}
        title={`${OPENING_TOOL_WINDOW_TOOLTIP} ${shortcutHint('cfs:tool:window')}`}
        aria-pressed={activeTool === 'cfs-window'}
      >
        {OPENING_TOOL_WINDOW_LABEL}
      </button>
      <button
        type="button"
        className={`${BUTTON_BASE} ${activeTool === 'cfs-service-hole' ? BUTTON_ACTIVE : BUTTON_INACTIVE}`}
        onClick={click('cfs-service-hole')}
        title={`${SERVICE_HOLE_TOOL_TOOLTIP} ${shortcutHint('cfs:tool:service-hole')}`}
        aria-pressed={activeTool === 'cfs-service-hole'}
      >
        {SERVICE_HOLE_TOOL_LABEL}
      </button>
      <button
        type="button"
        className={`${BUTTON_BASE} ${activeTool === 'cfs-panel-break' ? BUTTON_ACTIVE : BUTTON_INACTIVE}`}
        onClick={click('cfs-panel-break')}
        title={`${PANEL_BREAK_TOOL_TOOLTIP} ${shortcutHint('cfs:tool:panel-break')}`}
        aria-pressed={activeTool === 'cfs-panel-break'}
      >
        {PANEL_BREAK_TOOL_LABEL}
      </button>
      <span
        aria-hidden="true"
        className="mx-1 h-5 w-px bg-border"
      />
      <button
        type="button"
        className={`${BUTTON_BASE} ${BUTTON_PRIMARY_ACTION}`}
        onClick={panelizeAll}
        title={`${PANELIZE_ACTION_TOOLTIP} ${shortcutHint('cfs:action:panelize')}`}
      >
        {PANELIZE_ACTION_LABEL}
      </button>
      <button
        type="button"
        className={`${BUTTON_BASE} ${inspectorTab === 'settings' ? BUTTON_ACTIVE : BUTTON_INACTIVE}`}
        onClick={toggleSettings}
        title="Show project settings in the inspector."
        aria-pressed={inspectorTab === 'settings'}
      >
        {SETTINGS_TAB_LABEL}
      </button>
    </div>
  )
}
