'use client'

import {
  useCFS,
  useMembersByRole,
  useWallFramingSelection,
} from '@pascal-app/cfs'
import type { CFSOpening, CFSServiceHole } from '@pascal-app/cfs'
import { useScene, type AnyNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { OpeningBody } from './OpeningBody'
import { ServiceHoleBody } from './ServiceHoleBody'
import { WallFramingBody } from './WallFramingBody'

const PANEL_CLASSES =
  'fixed bottom-4 right-4 z-40 w-80 max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-background/95 p-3 shadow-2xl backdrop-blur-md text-foreground'

/**
 * Slice 3 inspector — read-only floating panel that surfaces the framing
 * derived for the selected wall (or framing). Mounted as a DOM sibling of
 * the editor; future slices will move it into Pascal's sidebar API.
 *
 * Selection bridge §7.4.1: reads `useViewer.selection.selectedIds[0]` and
 * resolves either a Pascal `wall` id or a `cfs_wall_framing` id to the same
 * subject — the framing for that wall.
 */
export function InspectorPanel(): React.JSX.Element | null {
  const isCFSMode = useCFS((s) => s.isCFSMode)
  const libraryError = useCFS((s) => s.libraryLoadError)
  const selectedHoleId = useCFS((s) => s.selectedHoleId)
  const selectedId = useViewer((s) => s.selection.selectedIds[0] ?? null)
  const { wall, framing, members } = useWallFramingSelection(selectedId)
  const membersByRole = useMembersByRole(members)
  // If the selected node is itself a cfs_opening, show the opening editor.
  const selectedOpening = useScene((s) => {
    if (!selectedId) return null
    const node = (s.nodes as unknown as Record<string, AnyNode | undefined>)[selectedId]
    if (!node || (node as { type?: string }).type !== 'cfs_opening') return null
    return node as unknown as CFSOpening
  })
  // §7.4.7 — service-hole selection is driven by `useCFS.selectedHoleId`,
  // set by `CFSServiceHoleTool` immediately after placement (and by the
  // member-body hole list when it ships in a future slice).
  const selectedHole = useScene((s) => {
    if (!selectedHoleId) return null
    const node = (s.nodes as unknown as Record<string, AnyNode | undefined>)[selectedHoleId]
    if (!node || (node as { type?: string }).type !== 'cfs_service_hole') return null
    return node as unknown as CFSServiceHole
  })

  if (!isCFSMode) return null

  return (
    <aside className={PANEL_CLASSES} aria-label="CFS inspector">
      <header className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">CFS inspector</h2>
        <span className="text-[10px] text-muted-foreground">Slice 6</span>
      </header>
      {libraryError ? (
        <p className="mb-2 rounded border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-200">
          {libraryError}
        </p>
      ) : null}
      {selectedHole ? (
        <ServiceHoleBody hole={selectedHole} />
      ) : selectedOpening ? (
        <OpeningBody opening={selectedOpening} />
      ) : wall && framing ? (
        <WallFramingBody
          wall={wall as { id: string; start?: readonly [number, number]; end?: readonly [number, number]; height?: number }}
          framing={framing}
          members={members}
          membersByRole={membersByRole}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          Select a wall to see its CFS framing.
        </p>
      )}
    </aside>
  )
}
