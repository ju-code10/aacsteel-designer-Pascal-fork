'use client'

// §7.5 — `Export ▾` dropdown.
//
// Slice 8 surfaces BOM / Cut list / Panel DXFs as enabled items. PDF /
// Scene JSON / Import are rendered disabled with the "ships in Slice 9"
// tooltip so the menu placement is stable across slices.

import {
  getActiveLibrary,
  getCFSProject,
  previewPreflight,
  useCFS,
  type SceneLike,
} from '@pascal-app/cfs'
import { useScene } from '@pascal-app/core'
import { useEffect, useRef, useState } from 'react'
import {
  EXPORT_ITEM_BOM,
  EXPORT_ITEM_CUT_LIST,
  EXPORT_ITEM_DXF,
  EXPORT_ITEM_IMPORT,
  EXPORT_ITEM_JSON,
  EXPORT_ITEM_PDF,
  EXPORT_ITEM_SLICE9_TOOLTIP,
  EXPORT_MENU_LABEL,
  EXPORT_MENU_TOOLTIP,
} from '../../lib/strings'
import { useExport } from '../../lib/use-export'

const BUTTON_BASE = 'rounded-md px-3 py-1.5 text-xs font-medium border transition-colors'
const BUTTON_INACTIVE = 'border-border bg-background text-foreground hover:bg-muted'
const BUTTON_ACTIVE = 'border-primary bg-primary text-primary-foreground'

export function ExportMenu(): React.JSX.Element | null {
  const isCFSMode = useCFS((s) => s.isCFSMode)
  const { exportBOM, exportCutList, exportDXFs, exportShopDrawings, exportJSON, importJSON } =
    useExport()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Re-derive the disabled state of every menu item on every open. Cheap —
  // one preflight walk per item over the scene.
  // The preflight runs against current scene + library + project (no project
  // means every item is disabled).
  const scene = useScene.getState() as unknown as SceneLike
  const project = getCFSProject(useScene.getState())
  const library = getActiveLibrary(useCFS.getState())

  const bomDisabled =
    previewPreflight(scene, library, project, { requirePanels: true })
  const cutListDisabled =
    previewPreflight(scene, library, project, { requirePanels: false })
  const dxfDisabled = bomDisabled

  // Click-outside close.
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [open])

  if (!isCFSMode) return null

  const choose = (fn: () => void) => () => {
    fn()
    setOpen(false)
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className={`${BUTTON_BASE} ${open ? BUTTON_ACTIVE : BUTTON_INACTIVE}`}
        onClick={() => setOpen((v) => !v)}
        title={EXPORT_MENU_TOOLTIP}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {EXPORT_MENU_LABEL} ▾
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-64 rounded-md border border-border bg-background py-1 text-xs shadow-lg"
        >
          <MenuItem
            label={EXPORT_ITEM_BOM}
            tooltip={bomDisabled ?? undefined}
            disabled={!!bomDisabled}
            onSelect={choose(exportBOM)}
          />
          <MenuItem
            label={EXPORT_ITEM_CUT_LIST}
            tooltip={cutListDisabled ?? undefined}
            disabled={!!cutListDisabled}
            onSelect={choose(exportCutList)}
          />
          <MenuItem
            label={EXPORT_ITEM_DXF}
            tooltip={dxfDisabled ?? undefined}
            disabled={!!dxfDisabled}
            onSelect={choose(exportDXFs)}
          />
          <MenuItem
            label={EXPORT_ITEM_PDF}
            tooltip={EXPORT_ITEM_SLICE9_TOOLTIP}
            disabled
            onSelect={choose(exportShopDrawings)}
          />
          <MenuItem
            label={EXPORT_ITEM_JSON}
            tooltip={EXPORT_ITEM_SLICE9_TOOLTIP}
            disabled
            onSelect={choose(exportJSON)}
          />
          <div className="my-1 h-px bg-border" role="separator" />
          <MenuItem
            label={EXPORT_ITEM_IMPORT}
            tooltip={EXPORT_ITEM_SLICE9_TOOLTIP}
            disabled
            onSelect={choose(importJSON)}
          />
        </div>
      ) : null}
    </div>
  )
}

interface MenuItemProps {
  label: string
  tooltip?: string
  disabled?: boolean
  onSelect: () => void
}

function MenuItem({ label, tooltip, disabled, onSelect }: MenuItemProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      title={tooltip}
      className={`block w-full px-3 py-1.5 text-left ${
        disabled
          ? 'cursor-not-allowed text-muted-foreground'
          : 'hover:bg-muted text-foreground'
      }`}
    >
      {label}
    </button>
  )
}
