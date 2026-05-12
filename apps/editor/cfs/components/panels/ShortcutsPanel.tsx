'use client'

// §7.6.4 — `ShortcutsPanel`. Modal-less list of every shortcut from §7.6.2
// grouped by category. Toggled by `?`; dismissed by the close button or
// `Esc`. Does not steal focus — the user can keep pressing shortcuts
// while it is visible.

import { useEffect } from 'react'
import {
  SHORTCUTS,
  SHORTCUT_CATEGORY_TITLES,
  type ShortcutCategory,
  type ShortcutDef,
} from '../../lib/shortcuts'
import { helpPanelActions, useHelpPanelOpen } from '../../lib/use-cfs-shortcuts'

// Order categories should appear in the panel. `tools` is folded into
// `mode` in the title table (same heading text), so we list `mode` once
// and skip `tools` when iterating.
const CATEGORY_ORDER: ShortcutCategory[] = ['mode', 'edit', 'export', 'help']

export function ShortcutsPanel(): React.JSX.Element | null {
  const open = useHelpPanelOpen()

  // `Esc` dismisses — but only when no shortcut binding above it is
  // primary. The global handler in `use-cfs-shortcuts` handles `Esc`
  // for the active-tool deactivation; we re-listen here for the help
  // panel specifically because that handler doesn't know about it.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        helpPanelActions.close()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  const grouped: Record<ShortcutCategory, ShortcutDef[]> = {
    mode: [],
    tools: [],
    edit: [],
    export: [],
    help: [],
  }
  for (const s of SHORTCUTS) grouped[s.category].push(s)
  // Fold tools into mode for display.
  grouped.mode = [...grouped.mode, ...grouped.tools]

  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      className="pointer-events-auto fixed right-4 bottom-4 z-40 w-80 rounded-lg border border-border bg-background shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Keyboard shortcuts
        </span>
        <button
          type="button"
          aria-label="Close shortcuts panel"
          onClick={() => helpPanelActions.close()}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          ✕
        </button>
      </div>
      <div className="max-h-[420px] overflow-auto px-3 py-2 text-xs">
        {CATEGORY_ORDER.map((cat) => {
          const rows = grouped[cat]
          if (rows.length === 0) return null
          return (
            <div key={cat} className="mb-3 last:mb-0">
              <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
                {SHORTCUT_CATEGORY_TITLES[cat]}
              </div>
              <ul className="space-y-0.5">
                {rows.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span className="font-mono text-[11px] text-foreground">
                      {s.label}
                    </span>
                    <span className="flex-1 text-muted-foreground">
                      {s.description}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}
