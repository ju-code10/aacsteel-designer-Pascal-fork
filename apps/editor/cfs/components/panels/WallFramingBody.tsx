'use client'

import { cfsMemberLength_mm } from '@pascal-app/cfs'
import type { CFSMember, CFSWallFraming } from '@pascal-app/cfs'
import { EMPTY_OPENINGS_HINT, EMPTY_PANELS_HINT } from '../../lib/strings'

const ROLE_COLOR: Record<CFSMember['role'], string> = {
  'top-track': '#9ca3af',
  'bottom-track': '#9ca3af',
  stud: '#3b82f6',
  'chord-stud': '#1e3a8a',
  'king-stud': '#7c3aed',
  'jamb-stud': '#a855f7',
  header: '#f59e0b',
  sill: '#fbbf24',
  'sill-track': '#fbbf24',
  cripple: '#22d3ee',
}

const ROLE_LABEL: Record<CFSMember['role'], string> = {
  'top-track': 'Top tracks',
  'bottom-track': 'Bottom tracks',
  stud: 'Field studs',
  'chord-stud': 'Chord studs',
  'king-stud': 'King studs',
  'jamb-stud': 'Jamb studs',
  header: 'Headers',
  sill: 'Sills',
  'sill-track': 'Sill tracks',
  cripple: 'Cripples',
}

interface WallLike {
  id: string
  start?: readonly [number, number]
  end?: readonly [number, number]
  height?: number
}

export interface WallFramingBodyProps {
  wall: WallLike
  framing: CFSWallFraming
  members: CFSMember[]
  membersByRole: Map<CFSMember['role'], CFSMember[]>
}

function formatMm(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${Math.round(value).toLocaleString()} mm`
}

function formatKg(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(1)} kg`
}

function wallLength_mm(wall: WallLike): number {
  if (!wall.start || !wall.end) return 0
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]) * 1000
}

export function WallFramingBody({
  wall,
  framing,
  members,
  membersByRole,
}: WallFramingBodyProps): React.JSX.Element {
  const length = wallLength_mm(wall)
  const height_mm = framing.wallHeight_mm ?? (wall.height != null ? wall.height * 1000 : null)
  const memberCount = framing.cachedMemberCount ?? members.length
  const totalWeight_kg = framing.cachedTotalWeight_kg ?? null

  // §7.8.3 / §7.8.4 empty-state hints. Inferred from member data so the
  // hint surfaces even before we add full openings/panels sub-sections
  // (those follow in v2 per the §7.4.3 backlog).
  const hasOpenings = members.some(
    (m) =>
      m.role === 'king-stud' ||
      m.role === 'jamb-stud' ||
      m.role === 'header' ||
      m.role === 'sill',
  )
  const hasAnyPanel = members.some((m) => m.panelId != null)
  const showOpeningsHint = memberCount > 0 && !hasOpenings
  const showPanelsHint = memberCount > 0 && !hasAnyPanel

  return (
    <div className="flex flex-col gap-3 text-xs">
      <section>
        <h3 className="mb-1 font-semibold text-muted-foreground uppercase tracking-wide">
          Wall info
        </h3>
        <dl className="grid grid-cols-2 gap-y-0.5">
          <dt className="text-muted-foreground">Length</dt>
          <dd>{formatMm(length)}</dd>
          <dt className="text-muted-foreground">Height</dt>
          <dd>{formatMm(height_mm)}</dd>
          <dt className="text-muted-foreground">Wall id</dt>
          <dd className="font-mono text-[10px]">{wall.id}</dd>
        </dl>
      </section>

      <section>
        <h3 className="mb-1 font-semibold text-muted-foreground uppercase tracking-wide">
          Aggregates
        </h3>
        <dl className="grid grid-cols-2 gap-y-0.5">
          <dt className="text-muted-foreground">Members</dt>
          <dd>{memberCount}</dd>
          <dt className="text-muted-foreground">Total weight</dt>
          <dd>{formatKg(totalWeight_kg)}</dd>
        </dl>
      </section>

      {showOpeningsHint || showPanelsHint ? (
        <section className="flex flex-col gap-2">
          {showOpeningsHint ? (
            <p className="rounded border border-dashed border-border bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground">
              {EMPTY_OPENINGS_HINT}
            </p>
          ) : null}
          {showPanelsHint ? (
            <p className="rounded border border-dashed border-border bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground">
              {EMPTY_PANELS_HINT}
            </p>
          ) : null}
        </section>
      ) : null}

      <section>
        <h3 className="mb-1 font-semibold text-muted-foreground uppercase tracking-wide">
          Members by role
        </h3>
        {membersByRole.size === 0 ? (
          <p className="text-muted-foreground">No members generated yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {Array.from(membersByRole.entries()).map(([role, list]) => (
              <li key={role}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="inline-block h-2.5 w-2.5 rounded-sm"
                      style={{ backgroundColor: ROLE_COLOR[role] }}
                    />
                    <span>{ROLE_LABEL[role]}</span>
                  </span>
                  <span className="font-mono text-muted-foreground">{list.length}</span>
                </div>
                <ul className="ml-4 mt-0.5 flex flex-col gap-px text-[10px] text-muted-foreground">
                  {list.slice(0, 3).map((m) => (
                    <li key={m.id} className="font-mono">
                      {`${Math.round(cfsMemberLength_mm(m)).toLocaleString()} mm`}
                    </li>
                  ))}
                  {list.length > 3 ? <li>… {list.length - 3} more</li> : null}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
