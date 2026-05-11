'use client'

import {
  panelWidth_mm,
  useCFS,
  type CFSPanel,
} from '@pascal-app/cfs'
import { useScene, type AnyNodeId } from '@pascal-app/core'

const PANEL_COLORS = [
  '#60a5fa', '#a78bfa', '#f472b6', '#fb923c', '#facc15',
  '#34d399', '#22d3ee', '#818cf8', '#f87171', '#94a3b8',
]

/** Colour for a real panel — same palette used by the geometry tint. */
export function panelColor(p: Pick<CFSPanel, 'sequenceNumber'>): string {
  const idx = (p.sequenceNumber - 1) % PANEL_COLORS.length
  return PANEL_COLORS[idx < 0 ? 0 : idx]!
}

function formatMm(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${Math.round(value).toLocaleString()} mm`
}

function formatKg(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(1)} kg`
}

export interface PanelBodyProps {
  panel: CFSPanel
}

/**
 * §7.4.5 — `PanelBody`. Shows panel info, aggregates, and a "Remove this
 * break" footer for manual breaks. Read-only otherwise; the panel
 * geometry is derived from the panelization pass.
 */
export function PanelBody({ panel }: PanelBodyProps): React.JSX.Element {
  const warnings = useCFS(
    (s) => s.panelizationWarnings[panel.parentId] ?? [],
  )
  const removeBreak = () => {
    // Soft-delete: clear isManualBreak on this panel and request a re-pan.
    // Per §7.4.5, the inspector deletes the panel and re-runs panelization;
    // the auto-panelizer takes over the segment.
    if (!panel.isManualBreak) return
    const scene = useScene.getState()
    scene.deleteNode(panel.id as unknown as AnyNodeId)
    useCFS.getState().requestPanelize(panel.parentId)
    useCFS.getState().setSelectedPanel(null)
  }

  return (
    <div className="flex flex-col gap-3 text-xs">
      <section>
        <h3 className="mb-1 font-semibold text-muted-foreground uppercase tracking-wide">
          Panel info
        </h3>
        <dl className="grid grid-cols-2 gap-y-0.5">
          <dt className="text-muted-foreground">Label</dt>
          <dd className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: panelColor(panel) }}
            />
            <span>{panel.label}</span>
            {panel.isManualBreak ? (
              <span className="text-[10px] text-amber-400">manual</span>
            ) : null}
          </dd>
          <dt className="text-muted-foreground">Sequence</dt>
          <dd>{panel.sequenceNumber}</dd>
          <dt className="text-muted-foreground">Start</dt>
          <dd>{formatMm(panel.startAlongWall_mm)}</dd>
          <dt className="text-muted-foreground">End</dt>
          <dd>{formatMm(panel.endAlongWall_mm)}</dd>
          <dt className="text-muted-foreground">Width</dt>
          <dd>{formatMm(panelWidth_mm(panel))}</dd>
        </dl>
      </section>

      <section>
        <h3 className="mb-1 font-semibold text-muted-foreground uppercase tracking-wide">
          Aggregates
        </h3>
        <dl className="grid grid-cols-2 gap-y-0.5">
          <dt className="text-muted-foreground">Members</dt>
          <dd>{panel.cachedMemberCount ?? '—'}</dd>
          <dt className="text-muted-foreground">Weight</dt>
          <dd>{formatKg(panel.cachedWeight_kg ?? null)}</dd>
        </dl>
      </section>

      {warnings.length > 0 ? (
        <section>
          <h3 className="mb-1 font-semibold text-amber-300 uppercase tracking-wide">
            Warnings
          </h3>
          <ul className="ml-2 list-disc text-amber-200">
            {warnings.map((w, i) => (
              <li key={`${i}-${w.slice(0, 8)}`}>{w}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="border-t border-border pt-2">
        <button
          type="button"
          onClick={removeBreak}
          disabled={!panel.isManualBreak}
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          title={
            panel.isManualBreak
              ? 'Delete this manual break and let the auto-panelizer take over the segment.'
              : 'Only manual breaks can be removed individually.'
          }
        >
          Remove this break
        </button>
      </footer>
    </div>
  )
}
