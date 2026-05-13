'use client'

// §7.8.1 — Welcome callout. Shown above `ProjectSettingsBody` the first
// time the user toggles CFS mode in a session, AND only when the scene
// has no `cfs_wall_framing` yet (a returning user with an imported scene
// already knows what CFS mode is). Session-only dismissal per appendix
// A.4 (slice-9 default); localStorage persistence is v2.

import { useCFS } from '@pascal-app/cfs'
import { useScene } from '@pascal-app/core'
import {
  WELCOME_CALLOUT_BODY,
  WELCOME_CALLOUT_DISMISS_LABEL,
  WELCOME_CALLOUT_TITLE,
} from '../../lib/strings'

export function WelcomeCallout(): React.JSX.Element | null {
  const dismissed = useCFS((s) => s.welcomeCalloutDismissed)
  const dismiss = useCFS((s) => s.dismissWelcomeCallout)
  const isCFSMode = useCFS((s) => s.isCFSMode)
  const hasFraming = useScene((s) => {
    for (const node of Object.values(s.nodes)) {
      if ((node as { type?: string }).type === 'cfs_wall_framing') return true
    }
    return false
  })

  if (!isCFSMode || dismissed || hasFraming) return null

  return (
    <div
      role="status"
      className="mb-3 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs text-foreground"
    >
      <div className="mb-1 flex items-start justify-between gap-3">
        <span className="font-semibold">{WELCOME_CALLOUT_TITLE}</span>
        <button
          type="button"
          aria-label="Dismiss welcome callout"
          onClick={dismiss}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          ✕
        </button>
      </div>
      <p className="mb-2 text-muted-foreground">{WELCOME_CALLOUT_BODY}</p>
      <button
        type="button"
        onClick={dismiss}
        className="rounded border border-border bg-background px-2 py-1 text-[11px] hover:bg-muted"
      >
        {WELCOME_CALLOUT_DISMISS_LABEL}
      </button>
    </div>
  )
}
