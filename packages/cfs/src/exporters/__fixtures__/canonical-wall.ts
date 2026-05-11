// §1.2 worked example — the canonical wall, as a synthetic scene fixture.
//
// 3.6 m × 2.7 m wall, 600 mm stud spacing, 362S162-54 studs, 362T125-54
// tracks, one door (900 mm × 2100 mm) at x = 600. One real panel covering
// the full wall. All members assigned to the panel.
//
// Built explicitly (not by running the framing pass) so the exporter tests
// can verify spec semantics exactly:
//   - 1 header CFSMember per opening (per §6.1 "§5.1 emits a single
//     `header` member per opening"). The framing pass currently emits 4
//     members per box header — see TODO(slice-8-followup) at the bottom.
//
// The fixture returns the inputs every exporter takes: a SceneLike record,
// a CFSMemberLibrary, and a CFSProject. Plus helper accessors for asserting
// on individual members.

import type { CFSMember } from '../../schema/cfs-member'
import type { CFSOpening } from '../../schema/cfs-opening'
import type { CFSPanel } from '../../schema/cfs-panel'
import type { CFSProject } from '../../schema/cfs-project'
import type { CFSMemberLibrary, CFSSection } from '../../schema/cfs-member-library'
import type { CFSWallFraming } from '../../schema/cfs-wall-framing'
import type { CFSProjectSettings, CFSMemberRole, CFSHeaderType } from '../../schema/primitives'
import type { SceneLike } from '../../lib/scene-walk'
import { parseLibrary, ssmaLibraryJson } from '../../library/load-ssma'

export interface CanonicalWallFixture {
  scene: SceneLike
  library: CFSMemberLibrary
  project: CFSProject
  // useful handles for tests
  framingId: string
  panelId: string
  openingId: string
  members: CFSMember[]
}

interface BuildOptions {
  units?: 'metric' | 'imperial'
  /** When set, override the default 'box' header type on the opening. */
  headerType?: CFSHeaderType
  /** When set, skip panel creation entirely (panelId stays null on every member). */
  withoutPanels?: boolean
  /** When >1, split the wall into N evenly-spaced panels instead of one. */
  panelCount?: number
}

let uuidCounter = 0
function uuid(): string {
  uuidCounter++
  const seg = uuidCounter.toString(16).padStart(12, '0')
  return `00000000-0000-4000-8a00-${seg}`
}

export function resetCanonicalUuidCounter(): void {
  uuidCounter = 0
}

function findSection(library: CFSMemberLibrary, designation: string): CFSSection {
  const s = library.sections.find((x) => x.designation === designation)
  if (!s) throw new Error(`SSMA seed missing ${designation}`)
  return s
}

function makeMember(opts: {
  id: string
  framingId: string
  role: CFSMemberRole
  sectionId: string
  start: { x_mm: number; y_mm: number; z_mm: number }
  end: { x_mm: number; y_mm: number; z_mm: number }
  panelId: string | null
  serviceHoleIds?: string[]
}): CFSMember {
  return {
    type: 'cfs_member',
    id: opts.id as unknown as CFSMember['id'],
    parentId: opts.framingId as unknown as CFSMember['parentId'],
    role: opts.role,
    sectionId: opts.sectionId as unknown as CFSMember['sectionId'],
    start: opts.start,
    end: opts.end,
    orientation_deg: 0,
    panelId: (opts.panelId ?? null) as unknown as CFSMember['panelId'],
    serviceHoleIds: (opts.serviceHoleIds ?? []) as unknown as CFSMember['serviceHoleIds'],
    children: [],
  }
}

/**
 * Build the canonical-wall fixture. Idempotent within a single test run;
 * call `resetCanonicalUuidCounter()` between tests if you need stable ids
 * across re-builds.
 */
export function buildCanonicalWall(opts: BuildOptions = {}): CanonicalWallFixture {
  resetCanonicalUuidCounter()
  const library = parseLibrary(ssmaLibraryJson)
  const studSection = findSection(library, '362S162-54')
  const trackSection = findSection(library, '362T125-54')

  const siteId = uuid()
  const buildingId = uuid()
  const levelId = uuid()
  const wallId = uuid()
  const framingId = uuid()
  const projectId = uuid()
  const openingId = uuid()

  const settings: CFSProjectSettings = {
    defaultStudSpacing_mm: 600,
    defaultStudSection: studSection.id,
    defaultTrackSection: trackSection.id,
    defaultHeaderType: 'box',
    panelMaxWidth_mm: 3658,
    panelMaxWeight_kg: 680,
    wallHeight_mm: 2700,
    units: opts.units ?? 'metric',
  }

  const project: CFSProject = {
    type: 'cfs_project',
    id: projectId as unknown as CFSProject['id'],
    parentId: siteId as unknown as CFSProject['parentId'],
    schemaVersion: '1.0.0',
    name: 'Canonical Wall Test',
    settings,
    libraries: [library.id],
    activeLibraryId: library.id,
    createdAt: '2026-05-01T12:00:00Z',
    updatedAt: '2026-05-01T12:00:00Z',
    metadata: { jobNumber: 'JOB-001', client: 'Test Client' },
  }

  const framing: CFSWallFraming = {
    type: 'cfs_wall_framing',
    id: framingId as unknown as CFSWallFraming['id'],
    parentId: wallId as unknown as CFSWallFraming['parentId'],
    studSpacing_mm: 600,
    studSectionId: studSection.id,
    trackSectionId: trackSection.id,
    defaultHeaderType: null,
    wallHeight_mm: 2700,
    children: [],
  }

  const opening: CFSOpening = {
    type: 'cfs_opening',
    id: openingId as unknown as CFSOpening['id'],
    parentId: framingId as unknown as CFSOpening['parentId'],
    openingType: 'door',
    positionAlongWall_mm: 600,
    roughDimensions: { width_mm: 900, height_mm: 2100 },
    headerTypeOverride: opts.headerType ?? null,
    generatedMemberIds: [],
  }

  // Build panel(s).
  const panelCount = opts.withoutPanels ? 0 : opts.panelCount ?? 1
  const panels: CFSPanel[] = []
  const wallLength_mm = 3600
  for (let i = 0; i < panelCount; i++) {
    const start = (wallLength_mm * i) / panelCount
    const end = (wallLength_mm * (i + 1)) / panelCount
    const id = uuid()
    panels.push({
      type: 'cfs_panel',
      id: id as unknown as CFSPanel['id'],
      parentId: framingId as unknown as CFSPanel['parentId'],
      label: `P-${String(i + 1).padStart(2, '0')}`,
      sequenceNumber: i + 1,
      startAlongWall_mm: start,
      endAlongWall_mm: end,
      isManualBreak: false,
      isPendingSentinel: false,
      cachedWeight_kg: 0,
      cachedMemberCount: 0,
    })
  }
  const primaryPanel = panels[0] ?? null

  function pickPanel(x_mm: number): CFSPanel | null {
    for (const p of panels) {
      if (x_mm >= p.startAlongWall_mm && x_mm < p.endAlongWall_mm) return p
    }
    return panels[panels.length - 1] ?? null
  }

  // Members per the §1.2 worked example.
  const members: CFSMember[] = []
  function emit(role: CFSMemberRole, x_mm: number, opts2?: { yStart?: number; yEnd?: number; end_x_mm?: number; sectionId?: string }): CFSMember {
    const yStart = opts2?.yStart ?? 0
    const yEnd = opts2?.yEnd ?? 2700
    const endX = opts2?.end_x_mm ?? x_mm
    const panel = pickPanel((x_mm + endX) / 2)
    const m = makeMember({
      id: uuid(),
      framingId,
      role,
      sectionId: opts2?.sectionId ?? studSection.id,
      start: { x_mm, y_mm: yStart, z_mm: 0 },
      end: { x_mm: endX, y_mm: yEnd, z_mm: 0 },
      panelId: panel?.id ?? null,
    })
    members.push(m)
    return m
  }

  // Tracks span the full wall — at y = 0 (bottom) and y = 2700 (top).
  emit('bottom-track', 0, { yStart: 0, yEnd: 0, end_x_mm: 3600, sectionId: trackSection.id })
  emit('top-track', 0, { yStart: 2700, yEnd: 2700, end_x_mm: 3600, sectionId: trackSection.id })

  // Chord studs at x = 0 and x = 3600 (full height).
  emit('chord-stud', 0)
  emit('chord-stud', 3600)

  // King studs flanking the opening (x = 600 and x = 1500 — simplified, ignoring half-flange offset).
  emit('king-stud', 600)
  emit('king-stud', 1500)

  // Jamb studs immediately inside the kings.
  emit('jamb-stud', 620)
  emit('jamb-stud', 1480)

  // Three field studs: 1800, 2400, 3000.
  emit('stud', 1800)
  emit('stud', 2400)
  emit('stud', 3000)

  // ONE header (per spec §6.1 contract) spanning 600 → 1500 at y = 2100 (door head).
  const headerMember = emit('header', 600, { yStart: 2100, yEnd: 2100, end_x_mm: 1500, sectionId: studSection.id })
  // Wire the opening's generatedMemberIds so resolveHeaderType can find it.
  opening.generatedMemberIds = [
    headerMember.id as unknown as CFSOpening['generatedMemberIds'][number],
  ]

  // One cripple above the header at x = 1200 (the inside candidate).
  emit('cripple', 1200, { yStart: 2100, yEnd: 2700 })

  // Build the scene record.
  const scene: SceneLike = {
    nodes: {
      [siteId]: { type: 'site', id: siteId, parentId: null, children: [buildingId] },
      [buildingId]: {
        type: 'building',
        id: buildingId,
        parentId: siteId,
        children: [levelId],
        createdAt: '2026-05-01T12:00:00Z',
      },
      [levelId]: {
        type: 'level',
        id: levelId,
        parentId: buildingId,
        children: [wallId],
        elevation_m: 0,
      },
      [wallId]: {
        type: 'wall',
        id: wallId,
        parentId: levelId,
        children: [framingId],
        start: [0, 0],
        end: [3.6, 0],
        height: 2.7,
      },
      [framingId]: framing,
      [openingId]: opening,
      [projectId]: project,
    },
  }
  for (const p of panels) scene.nodes[p.id as unknown as string] = p
  for (const m of members) scene.nodes[m.id as unknown as string] = m

  return {
    scene,
    library,
    project,
    framingId,
    panelId: (primaryPanel?.id as unknown as string) ?? '',
    openingId,
    members,
  }
}

/**
 * TODO(slice-8-followup): The current framing pass (Slice 4) emits one
 * CFSMember per piece of a box header (4 members per box-header opening).
 * §6.1 specifies the BOM expand a SINGLE header member into 4 BOM rows.
 * Until the framing pass is reconciled to emit one header member per
 * opening, real-editor BOM output for box headers will show 4 × expansion
 * factor rows. The cut list will likewise show 4 rows per opening.
 * Spec-vs-implementation reconciliation belongs in Slice G.
 */
