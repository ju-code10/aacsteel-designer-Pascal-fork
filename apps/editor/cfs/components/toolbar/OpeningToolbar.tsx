'use client'

import { useCFS } from '@pascal-app/cfs'
import type { CFSActiveTool } from '@pascal-app/cfs'
import {
  OPENING_TOOL_DOOR_LABEL,
  OPENING_TOOL_DOOR_TOOLTIP,
  OPENING_TOOL_WINDOW_LABEL,
  OPENING_TOOL_WINDOW_TOOLTIP,
  SERVICE_HOLE_TOOL_LABEL,
  SERVICE_HOLE_TOOL_TOOLTIP,
} from '../../lib/strings'

const BUTTON_BASE =
  'rounded-md px-3 py-1.5 text-xs font-medium border transition-colors'
const BUTTON_INACTIVE =
  'border-border bg-background text-foreground hover:bg-muted'
const BUTTON_ACTIVE = 'border-primary bg-primary text-primary-foreground'

/**
 * Two-button toolbar shown only in CFS mode. Selecting Door or Window flips
 * `useCFS.activeTool`, which the headless `CFSDoorTool` / `CFSWindowTool`
 * components observe to decide whether to consume `wall:click` events. We
 * deliberately do not touch Pascal's `useEditor.tool` — Pascal's tools stay
 * inactive when our tool is active because the user is in CFS mode and not
 * Pascal's build mode.
 */
export function OpeningToolbar(): React.JSX.Element | null {
  const isCFSMode = useCFS((s) => s.isCFSMode)
  const activeTool = useCFS((s) => s.activeTool)
  const setActiveTool = useCFS((s) => s.setActiveTool)

  if (!isCFSMode) return null

  const click = (tool: NonNullable<CFSActiveTool>) => () => {
    setActiveTool(activeTool === tool ? null : tool)
  }

  return (
    <div className="flex items-center gap-1" role="group" aria-label="CFS tools">
      <button
        type="button"
        className={`${BUTTON_BASE} ${activeTool === 'cfs-door' ? BUTTON_ACTIVE : BUTTON_INACTIVE}`}
        onClick={click('cfs-door')}
        title={OPENING_TOOL_DOOR_TOOLTIP}
        aria-pressed={activeTool === 'cfs-door'}
      >
        {OPENING_TOOL_DOOR_LABEL}
      </button>
      <button
        type="button"
        className={`${BUTTON_BASE} ${activeTool === 'cfs-window' ? BUTTON_ACTIVE : BUTTON_INACTIVE}`}
        onClick={click('cfs-window')}
        title={OPENING_TOOL_WINDOW_TOOLTIP}
        aria-pressed={activeTool === 'cfs-window'}
      >
        {OPENING_TOOL_WINDOW_LABEL}
      </button>
      <button
        type="button"
        className={`${BUTTON_BASE} ${activeTool === 'cfs-service-hole' ? BUTTON_ACTIVE : BUTTON_INACTIVE}`}
        onClick={click('cfs-service-hole')}
        title={SERVICE_HOLE_TOOL_TOOLTIP}
        aria-pressed={activeTool === 'cfs-service-hole'}
      >
        {SERVICE_HOLE_TOOL_LABEL}
      </button>
    </div>
  )
}
