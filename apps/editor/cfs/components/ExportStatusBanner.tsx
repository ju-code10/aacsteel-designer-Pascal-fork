'use client'

// §7.5 — top-anchored progress / success / error banner driven by
// `useExport().status`. Auto-dismisses success after 6s (the hook does
// the timer); error stays until the user clicks ✕.

import { useExport } from '../lib/use-export'

export function ExportStatusBanner(): React.JSX.Element | null {
  const { status, dismiss } = useExport()
  if (status.kind === 'idle') return null

  const baseClass =
    'fixed top-2 left-1/2 z-50 -translate-x-1/2 rounded-md px-4 py-2 text-xs font-medium shadow-md flex items-center gap-3'

  if (status.kind === 'in_progress') {
    return (
      <div className={`${baseClass} bg-background border border-border`} role="status">
        <span
          aria-hidden
          className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-foreground/30 border-t-foreground"
        />
        <span>Exporting {status.label}…</span>
      </div>
    )
  }
  if (status.kind === 'success') {
    return (
      <div
        className={`${baseClass} border border-green-500/40 bg-green-500/10 text-green-700`}
        role="status"
      >
        <span>
          {status.label} downloaded as <code>{status.filename}</code>
        </span>
      </div>
    )
  }
  // error
  return (
    <div
      className={`${baseClass} border border-red-500/40 bg-red-500/10 text-red-700`}
      role="alert"
    >
      <span>
        {status.label} failed: {status.message}
      </span>
      <button
        type="button"
        onClick={dismiss}
        className="ml-2 text-red-700 hover:text-red-900"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}
