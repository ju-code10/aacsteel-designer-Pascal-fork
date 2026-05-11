'use client'

import {
  useCFS,
  useMembersByRole,
  useWallFramingSelection,
} from '@pascal-app/cfs'
import type { CFSOpening, CFSPanel, CFSServiceHole } from '@pascal-app/cfs'
import { useScene, type AnyNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { GlobalBody } from './GlobalBody'
import { OpeningBody } from './OpeningBody'
import { PanelBody } from './PanelBody'
import { ServiceHoleBody } from './ServiceHoleBody'
import { WallFramingBody } from './WallFramingBody'

const PANEL_CLASSES =
  'fixed bottom-4 right-4 z-40 w-80 max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-background/95 p-3 shadow-2xl backdrop-blur-md text-foreground'

/**
 * §7.4 — CFS inspector router. Routes to the body component for whatever
 * is currently selected, in priority order:
 *
 *   1. Settings tab (user explicitly clicked the settings affordance)
 *   2. Service hole (useCFS.selectedHoleId, set by ServiceHoleTool)
 *   3. Panel (useCFS.selectedPanelId, set by PanelBreakTool / panel list)
 *   4. Opening (selected node is a cfs_opening)
 *   5. Wall framing (selected node is a wall / framing)
 *
 * Slice 7 adds (1)–(3); (4)–(5) shipped in earlier slices.
 */
export function InspectorPanel(): React.JSX.Element | null {
  const isCFSMode = useCFS((s) => s.isCFSMode)
  const inspectorTab = useCFS((s) => s.inspectorTab)
  const libraryError = useCFS((s) => s.libraryLoadError)
  const selectedHoleId = useCFS((s) => s.selectedHoleId)
  const selectedPanelId = useCFS((s) => s.selectedPanelId)
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
  const selectedHole = useScene((s) => {
    if (!selectedHoleId) return null
    const node = (s.nodes as unknown as Record<string, AnyNode | undefined>)[selectedHoleId]
    if (!node || (node as { type?: string }).type !== 'cfs_service_hole') return null
    return node as unknown as CFSServiceHole
  })
  const selectedPanel = useScene((s) => {
    if (!selectedPanelId) return null
    const node = (s.nodes as unknown as Record<string, AnyNode | undefined>)[selectedPanelId]
    if (!node || (node as { type?: string }).type !== 'cfs_panel') return null
    const p = node as unknown as CFSPanel
    if (p.isPendingSentinel) return null // sentinels are transient
    return p
  })

  if (!isCFSMode) return null

  return (
    <aside className={PANEL_CLASSES} aria-label="CFS inspector">
      <header className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">CFS inspector</h2>
        <span className="text-[10px] text-muted-foreground">Slice 7</span>
      </header>
      {libraryError ? (
        <p className="mb-2 rounded border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-200">
          {libraryError}
        </p>
      ) : null}
      {inspectorTab === 'settings' ? (
        <GlobalBody />
      ) : selectedHole ? (
        <ServiceHoleBody hole={selectedHole} />
      ) : selectedPanel ? (
        <PanelBody panel={selectedPanel} />
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
