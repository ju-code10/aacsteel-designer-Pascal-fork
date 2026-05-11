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
  type SceneLike,
  ExporterError,
  applyShippingMarks,
  exportBOM,
  exportCutList,
  exportDXFs,
  getActiveLibrary,
  getCFSProject,
  slugify,
  triggerDownload,
  useCFS,
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
const listeners = new Set<() => void>()

function getStatus(): ExportStatus {
  return currentStatus
}

function setStatus(s: ExportStatus): void {
  currentStatus = s
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

// ── Module-level dispatch (consumed by the keyboard-shortcut hook) ─────────

export const exportActions = {
  exportBOM: () => enqueue(bomItem()),
  exportCutList: () => enqueue(cutListItem()),
  exportDXFs: () => enqueue(dxfItem()),
  exportShopDrawings: () =>
    setStatus({
      kind: 'error',
      label: 'Shop drawings',
      message: 'Ships in Slice 9 — not yet available.',
    }),
  exportJSON: () =>
    setStatus({
      kind: 'error',
      label: 'Scene JSON',
      message: 'Ships in Slice 9 — not yet available.',
    }),
  importJSON: () =>
    setStatus({
      kind: 'error',
      label: 'Scene import',
      message: 'Ships in Slice 9 — not yet available.',
    }),
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
  dismiss: () => void
}

export function useExport(): UseExportApi {
  const status = useSyncExternalStore(subscribe, getStatus, getStatus)
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
      dismiss: exportActions.dismiss,
    }),
    [status],
  )
}
