'use client'

// §7.5 — `useExport` hook. Single source of truth for export progress,
// feedback, and the FIFO depth-1 queue. The dropdown items, the status
// banner, and the quick-export keyboard shortcuts all subscribe through
// this hook, which is backed by a module-level zustand store so every
// caller observes the same status.

import {
  type BOMResult,
  type CutListResult,
  type DXFResult,
  type ImportResult,
  type JSONExportResult,
  type SceneLike,
  type ShopDrawingsResult,
  ExporterError,
  applyShippingMarks,
  exportBOM,
  exportCutList,
  exportDXFs,
  exportJSON,
  exportShopDrawings,
  getActiveLibrary,
  getCFSProject,
  importJSON,
  slugify,
  triggerDownload,
  useCFS,
  withBatchedUndo,
} from '@pascal-app/cfs'
import { useScene } from '@pascal-app/core'
import { useEffect, useMemo, useSyncExternalStore } from 'react'

export type ExportStatus =
  | { kind: 'idle' }
  | { kind: 'in_progress'; label: string }
  | { kind: 'success'; label: string; filename: string }
  | { kind: 'error'; label: string; message: string }

interface QueueItem {
  label: string
  filename: string
  run: () => Promise<Blob>
}

// Tiny module-level subscribable so both the menu and the banner observe
// the same export status. Uses React's `useSyncExternalStore` to avoid a
// direct zustand dependency in the editor app.
let currentStatus: ExportStatus = { kind: 'idle' }
let menuOpen = false
const listeners = new Set<() => void>()

function getStatus(): ExportStatus {
  return currentStatus
}

function getMenuOpen(): boolean {
  return menuOpen
}

function setStatus(s: ExportStatus): void {
  currentStatus = s
  for (const l of listeners) l()
}

function setMenuOpen(v: boolean): void {
  if (menuOpen === v) return
  menuOpen = v
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

let queued: QueueItem | null = null
let running = false

const SUCCESS_DISMISS_MS = 6000
let dismissTimer: ReturnType<typeof setTimeout> | null = null

function clearDismissTimer(): void {
  if (dismissTimer) {
    clearTimeout(dismissTimer)
    dismissTimer = null
  }
}

function scheduleSuccessDismiss(): void {
  clearDismissTimer()
  dismissTimer = setTimeout(() => {
    setStatus({ kind: 'idle' })
    dismissTimer = null
  }, SUCCESS_DISMISS_MS)
}

async function runItem(item: QueueItem): Promise<void> {
  setStatus({ kind: 'in_progress', label: item.label })
  try {
    const blob = await item.run()
    triggerDownload(blob, item.filename)
    setStatus({ kind: 'success', label: item.label, filename: item.filename })
    scheduleSuccessDismiss()
  } catch (e) {
    const message =
      e instanceof ExporterError
        ? e.message
        : e instanceof Error
        ? e.message
        : 'Unknown error'
    setStatus({ kind: 'error', label: item.label, message })
  } finally {
    const next = queued
    queued = null
    if (next) {
      void runItem(next)
    } else {
      running = false
    }
  }
}

function enqueue(item: QueueItem): void {
  if (!running) {
    running = true
    void runItem(item)
  } else {
    queued = item
  }
}

function buildFilename(kind: string, ext: string): string {
  const project = getCFSProject(useScene.getState())
  const name = project?.name ?? 'project'
  return `${slugify(name)}-${kind}.${ext}`
}

function bomItem(): QueueItem {
  return {
    label: 'BOM',
    filename: buildFilename('BOM', 'xlsx'),
    run: async () => {
      applyShippingMarks()
      const scene = useScene.getState() as unknown as SceneLike
      const lib = getActiveLibrary(useCFS.getState())
      const project = getCFSProject(useScene.getState())
      const result: BOMResult = await exportBOM(scene, lib, project)
      return result.blob
    },
  }
}

function cutListItem(): QueueItem {
  return {
    label: 'Cut list',
    filename: buildFilename('CutList', 'csv'),
    run: async () => {
      applyShippingMarks()
      const scene = useScene.getState() as unknown as SceneLike
      const lib = getActiveLibrary(useCFS.getState())
      const project = getCFSProject(useScene.getState())
      const result: CutListResult = exportCutList(scene, lib, project)
      return result.blob
    },
  }
}

function dxfItem(): QueueItem {
  return {
    label: 'Panel DXFs',
    filename: buildFilename('Panels', 'zip'),
    run: async () => {
      applyShippingMarks()
      const scene = useScene.getState() as unknown as SceneLike
      const lib = getActiveLibrary(useCFS.getState())
      const project = getCFSProject(useScene.getState())
      const result: DXFResult = exportDXFs(scene, lib, project)
      return result.blob
    },
  }
}

function shopDrawingsItem(): QueueItem {
  return {
    label: 'Shop drawings',
    filename: buildFilename('ShopDrawings', 'pdf'),
    run: async () => {
      applyShippingMarks()
      const scene = useScene.getState() as unknown as SceneLike
      const lib = getActiveLibrary(useCFS.getState())
      const project = getCFSProject(useScene.getState())
      const result: ShopDrawingsResult = await exportShopDrawings(scene, lib, project)
      return result.blob
    },
  }
}

function jsonItem(): QueueItem {
  return {
    label: 'Scene JSON',
    filename: buildFilename('Scene', 'json'),
    run: async () => {
      const scene = useScene.getState() as unknown as SceneLike
      const project = getCFSProject(useScene.getState())
      const result: JSONExportResult = exportJSON(scene, project)
      return result.blob
    },
  }
}

// File-picker import. Opens a transient <input type="file"> sized to one
// `.json` at a time and pipes the contents through `importJSON`. Status
// flows through the same banner the exporters use so success / partial /
// failure cycles through one surface (§7.7).
async function pickAndImport(): Promise<void> {
  if (typeof document === 'undefined') return
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/json,.json'
  input.style.display = 'none'
  document.body.appendChild(input)
  const cleanup = () => {
    if (input.parentNode) input.parentNode.removeChild(input)
  }
  try {
    await new Promise<void>((resolve) => {
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) {
          resolve()
          return
        }
        setStatus({ kind: 'in_progress', label: 'Scene import' })
        try {
          const text = await file.text()
          const raw = JSON.parse(text)
          // §6.5 — Import replaces the current scene. Without the
          // unloadScene() call below, importJSON would call createNode on
          // top of the existing nodes (whatever Pascal restored from
          // `pascal-editor-scene` in localStorage), so the user would end
          // up with the default Pascal site + their previous work + the
          // imported scene all merged into one graph. The merged state
          // was then saved back to localStorage and reappeared on every
          // browser reload as "floating tracks" / duplicate walls.
          //
          // We wrap unload + import in a single withBatchedUndo so the
          // entire operation collapses to one Ctrl+Z step.
          // withBatchedUndo invokes its callback synchronously, but TS
          // can't narrow assignments made inside a closure. Use the
          // definite-assignment assertion so we can keep `result` typed
          // as `ImportResult` (not `ImportResult | undefined`) below.
          let result!: ImportResult
          withBatchedUndo('Scene import', () => {
            useScene.getState().unloadScene()
            result = importJSON(
              raw,
              useScene,
              // The real useCFS store's setActiveLibrary takes a branded
              // CFSMemberLibraryId; the importer's CFSStoreLike contract
              // accepts a plain string. The cast collapses the brand at
              // the boundary so we don't leak it through json.ts.
              useCFS as unknown as Parameters<typeof importJSON>[2],
              // Don't pass withBatch — we're already inside one.
              {},
            )
          })
          if (result.status === 'success') {
            setStatus({
              kind: 'success',
              label: 'Scene import',
              filename: file.name,
            })
            scheduleSuccessDismiss()
          } else {
            const partialNote =
              result.status === 'partial'
                ? `Imported ${result.importedNodeCount} nodes, ${result.rejectedNodeCount} rejected. `
                : ''
            const detail = result.messages.slice(0, 5).join('; ')
            setStatus({
              kind: 'error',
              label: 'Scene import',
              message: `${partialNote}${detail}`.trim(),
            })
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Unknown error'
          setStatus({ kind: 'error', label: 'Scene import', message })
        } finally {
          resolve()
        }
      }
      // If the user dismisses the file picker without choosing a file
      // the change handler never fires. The onfocus on window is the
      // standard workaround.
      const onFocus = () => {
        window.removeEventListener('focus', onFocus)
        // Small delay so the change handler still fires when a file
        // was chosen but focus returns first.
        setTimeout(resolve, 250)
      }
      window.addEventListener('focus', onFocus)
      input.click()
    })
  } finally {
    cleanup()
  }
}

// ── Module-level dispatch (consumed by the keyboard-shortcut hook) ─────────

export const exportActions = {
  exportBOM: () => enqueue(bomItem()),
  exportCutList: () => enqueue(cutListItem()),
  exportDXFs: () => enqueue(dxfItem()),
  exportShopDrawings: () => enqueue(shopDrawingsItem()),
  exportJSON: () => enqueue(jsonItem()),
  importJSON: () => {
    void pickAndImport()
  },
  openMenu: () => setMenuOpen(true),
  closeMenu: () => setMenuOpen(false),
  toggleMenu: () => setMenuOpen(!menuOpen),
  dismiss: () => {
    clearDismissTimer()
    setStatus({ kind: 'idle' })
  },
}

// ── React surface ───────────────────────────────────────────────────────────

export interface UseExportApi {
  exportBOM: () => void
  exportCutList: () => void
  exportDXFs: () => void
  exportShopDrawings: () => void
  exportJSON: () => void
  importJSON: () => void
  status: ExportStatus
  menuOpen: boolean
  setMenuOpen: (open: boolean) => void
  dismiss: () => void
}

export function useExport(): UseExportApi {
  const status = useSyncExternalStore(subscribe, getStatus, getStatus)
  const menuOpenSubscribed = useSyncExternalStore(
    subscribe,
    getMenuOpen,
    getMenuOpen,
  )
  // Cleanup the success-dismiss timer when the entire app unmounts. Safe
  // to call from any consumer because clearDismissTimer is idempotent.
  useEffect(() => () => clearDismissTimer(), [])
  return useMemo(
    () => ({
      exportBOM: exportActions.exportBOM,
      exportCutList: exportActions.exportCutList,
      exportDXFs: exportActions.exportDXFs,
      exportShopDrawings: exportActions.exportShopDrawings,
      exportJSON: exportActions.exportJSON,
      importJSON: exportActions.importJSON,
      status,
      menuOpen: menuOpenSubscribed,
      setMenuOpen,
      dismiss: exportActions.dismiss,
    }),
    [status, menuOpenSubscribed],
  )
}
