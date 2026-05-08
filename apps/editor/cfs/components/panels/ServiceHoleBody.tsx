'use client'

import type {
  CFSMember,
  CFSServiceHole,
  CFSServiceHoleShape,
} from '@pascal-app/cfs'
import { useScene, type AnyNode, type AnyNodeId } from '@pascal-app/core'
import { useCFS } from '@pascal-app/cfs'
import {
  SERVICE_HOLE_INSPECTOR_DIAMETER_LABEL,
  SERVICE_HOLE_INSPECTOR_OBLONG_LENGTH_LABEL,
  SERVICE_HOLE_INSPECTOR_POSITION_LABEL,
  SERVICE_HOLE_INSPECTOR_SHAPE_LABEL,
  SERVICE_HOLE_INSPECTOR_STIFFENER_LABEL,
  SERVICE_HOLE_INSPECTOR_TITLE,
} from '../../lib/strings'
import { ComplianceBadge } from './ComplianceBadge'

/**
 * §7.4.7 — `ServiceHoleBody`. Shown when a `cfs_service_hole` is selected.
 *
 * Edits dirty the hole node directly; `CFSServiceHoleSystem` re-validates
 * on the next frame and the badge updates automatically. A `Delete hole`
 * footer button removes the node; the geometry pass rebuilds the parent
 * member's mesh on the next frame (because the member's hole-list
 * signature changed — §5.3 layer 3).
 */

export interface ServiceHoleBodyProps {
  hole: CFSServiceHole
}

function updateHole(hole: CFSServiceHole, patch: Partial<CFSServiceHole>): void {
  useScene
    .getState()
    .updateNode(
      hole.id as unknown as AnyNodeId,
      patch as unknown as Partial<AnyNode>,
    )
}

function deleteHole(hole: CFSServiceHole): void {
  useScene
    .getState()
    .deleteNode(hole.id as unknown as AnyNodeId)
  useCFS.setState({ selectedHoleId: null })
}

function NumberRow({
  label,
  value,
  onChange,
  step = 5,
  min = 0,
  suffix = 'mm',
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  suffix?: string
}): React.JSX.Element {
  return (
    <label className="grid grid-cols-[1fr_auto_auto] items-center gap-2 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="number"
        className="w-20 rounded border border-border bg-background px-2 py-0.5 text-right font-mono text-[11px]"
        value={Math.round(value)}
        min={min}
        step={step}
        onChange={(e) => {
          const next = Number(e.target.value)
          if (Number.isFinite(next)) onChange(next)
        }}
      />
      <span className="font-mono text-[10px] text-muted-foreground">{suffix}</span>
    </label>
  )
}

export function ServiceHoleBody({ hole }: ServiceHoleBodyProps): React.JSX.Element {
  // Look up the parent member for context — section + length so the inspector
  // can show "stud, 362S162-54, 2743 mm".
  const parentMember = useScene((s) => {
    const n = (s.nodes as Record<string, AnyNode | undefined>)[hole.parentId]
    return n && (n as { type?: string }).type === 'cfs_member'
      ? (n as unknown as CFSMember)
      : null
  })

  return (
    <div className="flex flex-col gap-3 text-xs">
      <header className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{SERVICE_HOLE_INSPECTOR_TITLE}</h3>
        <span className="font-mono text-[10px] text-muted-foreground">
          {hole.shape}
        </span>
      </header>

      <ComplianceBadge verdict={hole.compliance} />

      {hole.compliance.reasons.length > 0 ? (
        <ul className="flex flex-col gap-0.5 rounded border border-red-500/30 bg-red-500/5 p-2 text-[10px] text-red-200">
          {hole.compliance.reasons.map((r, i) => (
            <li key={i}>• {r}</li>
          ))}
        </ul>
      ) : null}

      <section className="flex flex-col gap-1.5">
        <NumberRow
          label={SERVICE_HOLE_INSPECTOR_POSITION_LABEL}
          value={hole.positionAlongMember_mm}
          step={25}
          onChange={(v) => updateHole(hole, { positionAlongMember_mm: v })}
        />
        <NumberRow
          label={SERVICE_HOLE_INSPECTOR_DIAMETER_LABEL}
          value={hole.diameter_mm}
          step={5}
          min={12}
          onChange={(v) => updateHole(hole, { diameter_mm: v })}
        />

        <label className="grid grid-cols-2 items-center gap-2 text-[11px]">
          <span className="text-muted-foreground">{SERVICE_HOLE_INSPECTOR_SHAPE_LABEL}</span>
          <select
            className="rounded border border-border bg-background px-2 py-0.5 text-[11px]"
            value={hole.shape}
            onChange={(e) => {
              const shape = e.target.value as CFSServiceHoleShape
              const patch: Partial<CFSServiceHole> = { shape }
              if (shape === 'oblong' && hole.oblongLength_mm === undefined) {
                patch.oblongLength_mm = Math.max(hole.diameter_mm + 1, 80)
              }
              updateHole(hole, patch)
            }}
          >
            <option value="round">round</option>
            <option value="oblong">oblong</option>
          </select>
        </label>

        {hole.shape === 'oblong' ? (
          <NumberRow
            label={SERVICE_HOLE_INSPECTOR_OBLONG_LENGTH_LABEL}
            value={hole.oblongLength_mm ?? hole.diameter_mm + 1}
            step={10}
            onChange={(v) => updateHole(hole, { oblongLength_mm: v })}
          />
        ) : null}

        <label className="flex items-center gap-2 text-[11px]">
          <input
            type="checkbox"
            className="h-3 w-3"
            checked={hole.hasStiffener}
            onChange={(e) => updateHole(hole, { hasStiffener: e.target.checked })}
          />
          <span className="text-muted-foreground">
            {SERVICE_HOLE_INSPECTOR_STIFFENER_LABEL}
          </span>
        </label>
      </section>

      {parentMember ? (
        <section className="rounded border border-border bg-background/40 p-2 text-[10px]">
          <p className="text-muted-foreground">Parent member</p>
          <p className="font-mono">
            {parentMember.role} · {parentMember.sectionId.slice(0, 8)}…
          </p>
        </section>
      ) : null}

      <footer>
        <button
          type="button"
          onClick={() => deleteHole(hole)}
          className="w-full rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-500/20"
        >
          Delete hole
        </button>
      </footer>
    </div>
  )
}
