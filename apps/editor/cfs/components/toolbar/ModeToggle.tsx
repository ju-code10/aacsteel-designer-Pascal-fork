'use client'

import { useCFS } from '@pascal-app/cfs'
import { twMerge } from 'tailwind-merge'
import {
  MODE_TOGGLE_LABEL_OFF,
  MODE_TOGGLE_LABEL_ON,
  MODE_TOGGLE_TOOLTIP_OFF,
  MODE_TOGGLE_TOOLTIP_ON,
} from '../../lib/strings'

const CONTAINER =
  'inline-flex h-8 items-stretch overflow-hidden rounded-xl border border-border bg-background/90 shadow-2xl backdrop-blur-md'

const SEGMENT_BASE =
  'flex items-center justify-center px-3 font-medium text-xs transition-colors min-w-[88px]'

const SEGMENT_ACTIVE = 'bg-white/10 text-foreground'

const SEGMENT_INACTIVE = 'text-muted-foreground/70 hover:bg-white/8 hover:text-muted-foreground'

export function ModeToggle() {
  const isCFSMode = useCFS((s) => s.isCFSMode)
  const setCFSMode = useCFS((s) => s.setCFSMode)

  return (
    <div className={CONTAINER} role="group">
      <button
        aria-pressed={!isCFSMode}
        className={twMerge(SEGMENT_BASE, isCFSMode ? SEGMENT_INACTIVE : SEGMENT_ACTIVE)}
        onClick={() => setCFSMode(false)}
        title={isCFSMode ? MODE_TOGGLE_TOOLTIP_ON : undefined}
        type="button"
      >
        {MODE_TOGGLE_LABEL_OFF}
      </button>
      <button
        aria-pressed={isCFSMode}
        className={twMerge(SEGMENT_BASE, isCFSMode ? SEGMENT_ACTIVE : SEGMENT_INACTIVE)}
        onClick={() => setCFSMode(true)}
        title={isCFSMode ? undefined : MODE_TOGGLE_TOOLTIP_OFF}
        type="button"
      >
        {MODE_TOGGLE_LABEL_ON}
      </button>
    </div>
  )
}
