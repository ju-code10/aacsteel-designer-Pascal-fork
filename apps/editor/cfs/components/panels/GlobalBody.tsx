'use client'

import { updateProjectSettings, useProjectSettings } from '@pascal-app/cfs'
import { useState } from 'react'

const PANEL_MAX_WIDTH_MIN_MM = 1500
const PANEL_MAX_WIDTH_MAX_MM = 12_000
const PANEL_MAX_WEIGHT_MIN_KG = 100
const PANEL_MAX_WEIGHT_MAX_KG = 5000

/**
 * §7.4.4 — minimal GlobalBody / SettingsBody for slice 7. Surfaces the two
 * project settings the panelization pass cares about. Editing them goes
 * through `updateProjectSettings` so the change rides Pascal's Zundo and
 * §4.8 dirties every framing — which then triggers re-panelization for
 * walls that already have panels.
 *
 * Other project settings (stud spacing, header default, units) are not yet
 * surfaced here — they'll join in the slice 9 polish pass.
 */
export function GlobalBody(): React.JSX.Element | null {
  const settings = useProjectSettings()
  if (!settings) {
    return (
      <p className="text-xs text-muted-foreground">
        Turn on CFS mode to access project settings.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3 text-xs">
      <section>
        <h3 className="mb-1 font-semibold text-muted-foreground uppercase tracking-wide">
          Panel constraints
        </h3>
        <NumberField
          label="Max panel width"
          unit="mm"
          step={100}
          min={PANEL_MAX_WIDTH_MIN_MM}
          max={PANEL_MAX_WIDTH_MAX_MM}
          value={settings.panelMaxWidth_mm}
          onCommit={(v) => updateProjectSettings({ panelMaxWidth_mm: v })}
        />
        <NumberField
          label="Max panel weight"
          unit="kg"
          step={50}
          min={PANEL_MAX_WEIGHT_MIN_KG}
          max={PANEL_MAX_WEIGHT_MAX_KG}
          value={settings.panelMaxWeight_kg}
          onCommit={(v) => updateProjectSettings({ panelMaxWeight_kg: v })}
        />
        <p className="mt-1 text-[10px] text-muted-foreground">
          Changing these re-runs panelization for every wall that already has panels.
        </p>
      </section>
    </div>
  )
}

interface NumberFieldProps {
  label: string
  unit: string
  step: number
  min: number
  max: number
  value: number
  onCommit: (next: number) => void
}

function NumberField({
  label,
  unit,
  step,
  min,
  max,
  value,
  onCommit,
}: NumberFieldProps): React.JSX.Element {
  const [draft, setDraft] = useState(String(Math.round(value)))
  return (
    <label className="my-1 flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          step={step}
          min={min}
          max={max}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const n = Number.parseInt(draft, 10)
            if (Number.isFinite(n) && n >= min && n <= max) {
              onCommit(n)
            } else {
              setDraft(String(Math.round(value)))
            }
          }}
          className="w-24 rounded border border-border bg-background px-1.5 py-0.5 text-right text-xs"
        />
        <span className="text-muted-foreground">{unit}</span>
      </span>
    </label>
  )
}
