'use client'

import { useScene, type AnyNode, type AnyNodeId } from '@pascal-app/core'
import type { CFSHeaderType, CFSOpening } from '@pascal-app/cfs'
import {
  OPENING_INSPECTOR_HEADER_DEFAULT,
  OPENING_INSPECTOR_HEADER_LABEL,
  OPENING_INSPECTOR_HEIGHT_LABEL,
  OPENING_INSPECTOR_POSITION_LABEL,
  OPENING_INSPECTOR_SILL_LABEL,
  OPENING_INSPECTOR_TITLE,
  OPENING_INSPECTOR_TYPE_LABEL,
  OPENING_INSPECTOR_WIDTH_LABEL,
} from '../../lib/strings'

const HEADER_TYPES: CFSHeaderType[] = [
  'box',
  'L-header',
  'back-to-back',
  'single-track',
  'proprietary',
]

export interface OpeningBodyProps {
  opening: CFSOpening
}

function updateOpening(opening: CFSOpening, patch: Partial<CFSOpening>): void {
  useScene
    .getState()
    .updateNode(
      opening.id as unknown as AnyNodeId,
      patch as unknown as Partial<AnyNode>,
    )
}

function NumberRow({
  label,
  value,
  onChange,
  min = 0,
  step = 50,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  step?: number
}): React.JSX.Element {
  return (
    <label className="grid grid-cols-2 items-center gap-2 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="number"
        className="rounded border border-border bg-background px-2 py-0.5 text-right font-mono text-[11px]"
        value={Math.round(value)}
        min={min}
        step={step}
        onChange={(e) => {
          const next = Number(e.target.value)
          if (Number.isFinite(next)) onChange(next)
        }}
      />
    </label>
  )
}

export function OpeningBody({ opening }: OpeningBodyProps): React.JSX.Element {
  const isWindow = opening.openingType === 'window'

  return (
    <div className="flex flex-col gap-3 text-xs">
      <header className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{OPENING_INSPECTOR_TITLE}</h3>
        <span className="font-mono text-[10px] text-muted-foreground">
          {opening.openingType}
        </span>
      </header>

      <section className="flex flex-col gap-1.5">
        <div className="grid grid-cols-2 gap-y-0.5">
          <span className="text-muted-foreground">{OPENING_INSPECTOR_TYPE_LABEL}</span>
          <span className="font-mono">{opening.openingType}</span>
        </div>

        <NumberRow
          label={OPENING_INSPECTOR_POSITION_LABEL}
          value={opening.positionAlongWall_mm}
          onChange={(v) => updateOpening(opening, { positionAlongWall_mm: v })}
        />
        <NumberRow
          label={OPENING_INSPECTOR_WIDTH_LABEL}
          value={opening.roughDimensions.width_mm}
          onChange={(v) =>
            updateOpening(opening, {
              roughDimensions: { ...opening.roughDimensions, width_mm: v },
            })
          }
        />
        <NumberRow
          label={OPENING_INSPECTOR_HEIGHT_LABEL}
          value={opening.roughDimensions.height_mm}
          onChange={(v) =>
            updateOpening(opening, {
              roughDimensions: { ...opening.roughDimensions, height_mm: v },
            })
          }
        />
        {isWindow ? (
          <NumberRow
            label={OPENING_INSPECTOR_SILL_LABEL}
            value={opening.sillHeight_mm ?? 900}
            onChange={(v) => updateOpening(opening, { sillHeight_mm: v })}
          />
        ) : null}

        <label className="grid grid-cols-2 items-center gap-2 text-[11px]">
          <span className="text-muted-foreground">{OPENING_INSPECTOR_HEADER_LABEL}</span>
          <select
            className="rounded border border-border bg-background px-2 py-0.5 text-[11px]"
            value={opening.headerTypeOverride ?? ''}
            onChange={(e) => {
              const v = e.target.value
              updateOpening(opening, {
                headerTypeOverride: (v === '' ? null : (v as CFSHeaderType)),
              })
            }}
          >
            <option value="">{OPENING_INSPECTOR_HEADER_DEFAULT}</option>
            {HEADER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </section>
    </div>
  )
}
