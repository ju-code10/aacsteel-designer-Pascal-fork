# 3. Zod schemas (data model)

This section is the data spine of AACSteel-Designer. Every system, exporter, and UI surface in this spec consumes shapes defined here. If a downstream section needs a field that is not in this section, the spec has drifted — fix it here first, then propagate.

The audience is Claude Code reading this file at the start of a build session. Treat every schema below as final unless explicitly noted. When implementing build slice 2, transcribe these schemas directly into `packages/cfs/src/schema/` with one file per top-level schema.

> Note on terminology: this section uses the terms established in sections 0–2 (preamble, CFS domain primer, Pascal architecture inheritance). If terminology here drifts from those sections, sections 0–2 win and this section must be reconciled during spec slice G.

## 3.0 Conventions

These conventions apply to every schema in this section. Do not deviate without updating this subsection first.

### Units

All physical quantities are stored in metric base units. Imperial conversions happen only at the UI rendering boundary and inside exporters that target imperial-native formats (DXF, FRAMECAD, Scottsdale).

| Quantity | Unit | Suffix on field name |
|---|---|---|
| Length, dimension | millimeter | `_mm` |
| Area | square millimeter | `_mm2` |
| Volume | cubic millimeter | `_mm3` |
| Mass | kilogram | `_kg` |
| Density | kilogram per cubic meter | `_kgPerM3` |
| Force | newton | `_N` |
| Stress, modulus | megapascal | `_MPa` |
| Angle | degree (not radian) | `_deg` |
| Time, duration | ISO 8601 string | (no suffix; field name conveys meaning) |

Designations from manufacturer catalogs (for example `362S162-54`) are stored as opaque strings. Do not parse them at runtime; the catalog entry's structured fields are the source of truth.

### Identifiers

Every entity has an id field typed as a Zod-branded string. Brands prevent passing a `CFSPanelId` where a `CFSMemberId` is expected, at compile time and at parse time.

```ts
import { z } from 'zod';

const brandedId = <B extends string>(brand: B) =>
  z.string().uuid().brand<B>();

export const CFSProjectId       = brandedId('CFSProjectId');
export const CFSWallFramingId   = brandedId('CFSWallFramingId');
export const CFSMemberId        = brandedId('CFSMemberId');
export const CFSOpeningId       = brandedId('CFSOpeningId');
export const CFSPanelId         = brandedId('CFSPanelId');
export const CFSServiceHoleId   = brandedId('CFSServiceHoleId');
export const CFSConnectionId    = brandedId('CFSConnectionId');
export const CFSSectionId       = brandedId('CFSSectionId');
export const CFSMemberLibraryId = brandedId('CFSMemberLibraryId');
export const PascalNodeId       = z.string().uuid().brand<'PascalNodeId'>();

export type CFSProjectId       = z.infer<typeof CFSProjectId>;
export type CFSWallFramingId   = z.infer<typeof CFSWallFramingId>;
export type CFSMemberId        = z.infer<typeof CFSMemberId>;
export type CFSOpeningId       = z.infer<typeof CFSOpeningId>;
export type CFSPanelId         = z.infer<typeof CFSPanelId>;
export type CFSServiceHoleId   = z.infer<typeof CFSServiceHoleId>;
export type CFSConnectionId    = z.infer<typeof CFSConnectionId>;
export type CFSSectionId       = z.infer<typeof CFSSectionId>;
export type CFSMemberLibraryId = z.infer<typeof CFSMemberLibraryId>;
export type PascalNodeId       = z.infer<typeof PascalNodeId>;
```

`PascalNodeId` is the type used to reference an existing Pascal scene node (typically a `Wall`). The Pascal node's own schema is treated as a black box from this spec's perspective — we reference it by id and do not redefine it here.

### Pascal scene-node integration

Every CFS entity that participates in undo/redo and registry-based 3D rendering is a real Pascal scene node, stored in `useScene.nodes`. This means each CFS schema below carries:

- a `type` discriminator with a `cfs_` prefix literal
- an `id` field typed as the entity's branded id
- a `parentId` field pointing to the parent Pascal node (or another CFS node)

The `cfs_` prefix is what makes the JSON exporter / importer round-trip work cleanly per execution plan slice 9: pure-Pascal nodes have no prefix; CFS nodes do.

```ts
const cfsNodeBase = z.object({
  parentId: PascalNodeId, // or a CFS branded id where appropriate
});
```

Editor-local state (currently selected panel, currently active inspector tab, mode toggle) does **not** live in scene nodes. That state lives in `useCFS` and is defined in section 4.

### Strictness

Every `z.object` in this section uses `.strict()` by default. Unknown keys are a parse error. The single exception is `CFSProject.metadata`, which uses `.passthrough()` so that user-defined notes survive round-trips.

### Optional vs nullable vs default

- `field: z.string().optional()` — field may be absent from the parsed object. Use for genuinely optional concepts.
- `field: z.string().nullable()` — field is present but explicitly null. Use when the absence is meaningful and must be preserved through serialization.
- `field: z.string().default('foo')` — field may be absent on input but is always present on output. Use for sensible defaults.

Prefer `default` over `optional` for fields the system can fill in safely. Prefer `optional` for fields whose absence has semantic meaning.

### Schema versioning

`CFSProject` carries a `schemaVersion` field set to `'1.0.0'` for v1. The JSON importer (slice 9) reads this field first and dispatches to a migration table on mismatch. v1 has no migrations; v2 will.

### File layout

One top-level schema per file under `packages/cfs/src/schema/`. Index file re-exports everything.

```
packages/cfs/src/schema/
  index.ts               // re-exports everything
  ids.ts                 // all branded id types
  primitives.ts          // shared point/dimension/enum schemas
  CFSProject.ts
  CFSMemberLibrary.ts    // includes CFSSection
  CFSWallFraming.ts
  CFSMember.ts
  CFSOpening.ts
  CFSPanel.ts
  CFSServiceHole.ts
  CFSConnection.ts
  invariants.ts          // cross-schema runtime checks
```

## 3.1 Primitive and shared schemas

These shapes are reused across multiple top-level schemas. Define them once in `primitives.ts` and import everywhere.

### Geometry primitives

```ts
export const CFSPoint3D = z.object({
  x_mm: z.number().finite(),
  y_mm: z.number().finite(),
  z_mm: z.number().finite(),
}).strict();
export type CFSPoint3D = z.infer<typeof CFSPoint3D>;

export const CFSVector3D = CFSPoint3D; // structurally identical, semantic alias
export type CFSVector3D = z.infer<typeof CFSVector3D>;

export const CFSDimensions2D = z.object({
  width_mm:  z.number().positive(),
  height_mm: z.number().positive(),
}).strict();
export type CFSDimensions2D = z.infer<typeof CFSDimensions2D>;
```

Coordinate convention follows Pascal Editor: X is east, Y is up, Z is north. All CFS geometry is in world space unless an explicit `local` qualifier is on the field name.

### Section profile shape

The structured geometry of a single cold-formed steel cross section. Used inside `CFSSection`.

```ts
export const CFSProfileShape = z.enum([
  'C',   // lipped channel — studs, joists
  'U',   // unlipped channel (track) — top and bottom plates
  'Z',   // Z section — purlins, occasionally girts
  'HAT', // hat / furring channel — secondary framing (v2)
]);
export type CFSProfileShape = z.infer<typeof CFSProfileShape>;

export const CFSSectionProperties = z.object({
  shape:           CFSProfileShape,
  webDepth_mm:     z.number().positive(),     // overall depth
  flangeWidth_mm:  z.number().positive(),     // overall flange width
  lipLength_mm:    z.number().nonnegative(),  // 0 for U / track
  thickness_mm:    z.number().positive(),     // base steel thickness, no coating
  cornerRadius_mm: z.number().nonnegative().default(0), // inside corner; 0 = sharp
}).strict();
export type CFSSectionProperties = z.infer<typeof CFSSectionProperties>;
```

For v1 these geometric fields, plus `material` and `linearMass_kgPerM` (defined on `CFSSection` below), are sufficient to render meshes, compute weights, and produce BOMs and cut lists. Full AISI structural properties (`Ix`, `Sx`, `rx`, `Cw`, `J`, effective-section properties, etc.) are deferred to slice 12 and are an optional bag on `CFSSection` (see 3.3).

### Material schema

```ts
export const CFSMaterial = z.object({
  designation:        z.string().min(1),       // e.g. 'ASTM A1003 ST50H'
  yieldStrength_MPa:  z.number().positive(),   // Fy
  tensileStrength_MPa: z.number().positive(),  // Fu
  modulusOfElasticity_MPa: z.number().positive().default(203_000),
  density_kgPerM3:    z.number().positive().default(7850),
  coating:            z.string().min(1),       // e.g. 'G90', 'G60', 'AZ50'
}).strict();
export type CFSMaterial = z.infer<typeof CFSMaterial>;
```

### Member role

The role a member plays in the framing. Drives geometry choice, color, and inspector grouping.

```ts
export const CFSMemberRole = z.enum([
  'top-track',
  'bottom-track',
  'stud',          // field stud
  'chord-stud',    // wall-end stud (corner / intersection)
  'king-stud',     // full-height stud flanking opening
  'jamb-stud',     // inboard of king, supports header
  'header',        // spans opening
  'sill',          // bottom of window opening
  'sill-track',    // track at sill line
  'cripple',       // short stud above header / below sill
]);
export type CFSMemberRole = z.infer<typeof CFSMemberRole>;
```

### Opening type

```ts
export const CFSOpeningType = z.enum(['door', 'window']);
export type CFSOpeningType = z.infer<typeof CFSOpeningType>;
```

### Header type

The way a header is built up. Selectable per opening; project setting provides the default.

```ts
export const CFSHeaderType = z.enum([
  'box',           // built-up box header from two C sections + tracks
  'L-header',      // L-shaped from track + angle
  'back-to-back',  // two C sections back-to-back
  'single-track',  // single track, light loads only
  'proprietary',   // vendor-specific (e.g. SCAFCO clip-and-track)
]);
export type CFSHeaderType = z.infer<typeof CFSHeaderType>;
```

### Compliance status

Used by service holes (and reusable for any future validator output).

```ts
export const CFSComplianceStatus = z.enum(['compliant', 'non-compliant', 'unchecked']);
export type CFSComplianceStatus = z.infer<typeof CFSComplianceStatus>;

export const CFSComplianceVerdict = z.object({
  status:   CFSComplianceStatus,
  reasons:  z.array(z.string()).default([]),  // human-readable, AISI clause refs
  checkedAt: z.string().datetime().optional(), // ISO 8601
}).strict();
export type CFSComplianceVerdict = z.infer<typeof CFSComplianceVerdict>;
```

### Project settings

Embedded in `CFSProject` (3.2) but defined here because multiple system slices read it.

```ts
export const CFSProjectSettings = z.object({
  defaultStudSpacing_mm:     z.number().positive().default(406.4), // 16"
  defaultStudSection:        CFSSectionId,
  defaultTrackSection:       CFSSectionId,
  defaultHeaderType:         CFSHeaderType.default('box'),
  panelMaxWidth_mm:          z.number().positive().default(3658),  // 12'
  panelMaxWeight_kg:         z.number().positive().default(680),   // ~1500 lb
  wallHeight_mm:             z.number().positive().default(2743),  // 9'
  units:                     z.enum(['metric', 'imperial']).default('imperial'),
}).strict();
export type CFSProjectSettings = z.infer<typeof CFSProjectSettings>;
```

The `units` field is a UI display preference only. All stored values remain metric regardless.

## 3.2 CFSProject

The root container for everything CFS in the scene. Exactly one `CFSProject` exists per Pascal scene that has CFS mode enabled.

**Purpose.** Holds project-level settings, the active member library, the catalog of all available libraries, and a metadata bag for user notes. It does **not** hold framing, members, or panels — those are scene nodes and live under their respective Pascal walls in `useScene.nodes`.

**Parent.** No parent in the CFS sense. Its `parentId` references the Pascal site or building root node. There is at most one `CFSProject` per scene.

**Lifecycle.** Created on first activation of CFS mode. Hydrated on app load (slice 2) with the SSMA library as the default `activeLibraryId`.

```ts
export const CFSProject = z.object({
  type:            z.literal('cfs_project'),
  id:              CFSProjectId,
  parentId:        PascalNodeId,
  schemaVersion:   z.literal('1.0.0'),

  name:            z.string().min(1).default('Untitled CFS project'),
  settings:        CFSProjectSettings,

  libraries:       z.array(CFSMemberLibraryId).min(1),
  activeLibraryId: CFSMemberLibraryId,

  createdAt:       z.string().datetime(),
  updatedAt:       z.string().datetime(),

  metadata:        z.record(z.string(), z.unknown()).default({}),
}).strict();
export type CFSProject = z.infer<typeof CFSProject>;
```

`metadata` is the **one** schema in this section that uses a permissive value type. It is intended for user-facing notes (project number, client name, revision tag) that should round-trip without the importer rejecting them. The schema as a whole is still `.strict()`; only the values inside `metadata` are unconstrained.

**Example value** (illustrative — ids shortened for readability):

```ts
{
  type: 'cfs_project',
  id: 'proj-001',
  parentId: 'site-root',
  schemaVersion: '1.0.0',
  name: 'Riverside Warehouse',
  settings: {
    defaultStudSpacing_mm: 406.4,
    defaultStudSection: 'sec-362S162-54',
    defaultTrackSection: 'sec-362T125-54',
    defaultHeaderType: 'box',
    panelMaxWidth_mm: 3658,
    panelMaxWeight_kg: 680,
    wallHeight_mm: 2743,
    units: 'imperial',
  },
  libraries: ['lib-ssma'],
  activeLibraryId: 'lib-ssma',
  createdAt: '2026-04-29T14:00:00Z',
  updatedAt: '2026-04-29T14:00:00Z',
  metadata: { jobNumber: '2026-014', client: 'Riverside Industrial' },
}
```

## 3.3 CFSMemberLibrary and CFSSection

A library is a named catalog of cross-section definitions. The default library shipped with the app is SSMA; users may load additional libraries from JSON in v2.

**Purpose.** Look up a section by id to get its geometry (for rendering), linear mass (for weight), material (for color and future analysis), and optional structural properties (for slice 12).

**Parent.** Libraries are not scene nodes. They live in `useCFS.memberLibraries: Record<CFSMemberLibraryId, CFSMemberLibrary>` and are loaded from JSON files under `packages/cfs/src/data/`. They do not have a `parentId`.

**Why not scene nodes?** Libraries are read-only reference data. They do not participate in undo/redo (you don't undo "adding SSMA to the catalog"), do not render in 3D, and do not have a position. Storing them as scene nodes would pollute the scene graph and bloat the dirty-node set. They are editor configuration, not scene data.

```ts
export const CFSSection = z.object({
  id:                CFSSectionId,
  designation:       z.string().min(1),       // e.g. '362S162-54'
  shape:             CFSProfileShape,         // duplicates SectionProperties.shape for fast filtering
  properties:        CFSSectionProperties,
  material:          CFSMaterial,
  linearMass_kgPerM: z.number().positive(),   // catalog-published value; sanity-checked against properties

  // Optional structural properties bag — populated for slice 12, ignored in v1.
  structuralProperties: z.object({
    area_mm2:        z.number().positive().optional(),
    Ix_mm4:          z.number().positive().optional(),
    Iy_mm4:          z.number().positive().optional(),
    Sx_mm3:          z.number().positive().optional(),
    Sy_mm3:          z.number().positive().optional(),
    rx_mm:           z.number().positive().optional(),
    ry_mm:           z.number().positive().optional(),
    J_mm4:           z.number().positive().optional(),
    Cw_mm6:          z.number().positive().optional(),
  }).strict().optional(),
}).strict();
export type CFSSection = z.infer<typeof CFSSection>;

export const CFSMemberLibrary = z.object({
  id:        CFSMemberLibraryId,
  name:      z.string().min(1),                // e.g. 'SSMA', 'ClarkDietrich'
  version:   z.string().min(1),                // catalog version, e.g. '2024.1'
  source:    z.string().url().optional(),      // catalog reference URL
  sections:  z.array(CFSSection).min(1),
}).strict();
export type CFSMemberLibrary = z.infer<typeof CFSMemberLibrary>;
```

The actual SSMA section data — the 12+ entries shipped with v1 — lives in `packages/cfs/src/data/ssma.json` and is selected during build slice 2. This spec defines only the **shape**.

**Example value:**

```ts
{
  id: 'lib-ssma',
  name: 'SSMA',
  version: '2024.1',
  source: 'https://www.ssma.com/catalog',
  sections: [
    {
      id: 'sec-362S162-54',
      designation: '362S162-54',
      shape: 'C',
      properties: {
        shape: 'C',
        webDepth_mm: 92.1,
        flangeWidth_mm: 41.3,
        lipLength_mm: 12.7,
        thickness_mm: 1.37,
        cornerRadius_mm: 2.06,
      },
      material: {
        designation: 'ASTM A1003 ST50H',
        yieldStrength_MPa: 345,
        tensileStrength_MPa: 448,
        modulusOfElasticity_MPa: 203_000,
        density_kgPerM3: 7850,
        coating: 'G60',
      },
      linearMass_kgPerM: 1.61,
    },
    // ... at least 11 more entries shipped in slice 2
  ],
}
```

## 3.4 CFSWallFraming

The framing assembly attached to a single Pascal `Wall`. One framing per wall, in CFS mode.

**Purpose.** Container for all members, openings, panels, and service holes that belong to one wall. Carries the per-wall framing configuration that overrides project defaults.

**Parent.** A Pascal `Wall` node. The framing is created automatically by `CFSFramingSystem` (build slice 3) when a wall becomes dirty in CFS mode and no framing exists yet.

**Children.** Members, openings, panels, and service holes are all separate scene nodes whose `parentId` points to this `CFSWallFraming.id`. The framing does not embed them as arrays — they are looked up via `sceneRegistry.byType` or by walking children in `useScene`.

```ts
export const CFSWallFraming = z.object({
  type:                z.literal('cfs_wall_framing'),
  id:                  CFSWallFramingId,
  parentId:            PascalNodeId,           // the Pascal Wall

  // Per-wall config — null means "use project default"
  studSpacing_mm:      z.number().positive().nullable().default(null),
  studSectionId:       CFSSectionId.nullable().default(null),
  trackSectionId:      CFSSectionId.nullable().default(null),
  defaultHeaderType:   CFSHeaderType.nullable().default(null),
  wallHeight_mm:       z.number().positive().nullable().default(null),

  // Cached layout — written by CFSFramingSystem, read by inspector / exporters
  cachedTotalWeight_kg: z.number().nonnegative().optional(),
  cachedMemberCount:    z.number().int().nonnegative().optional(),
}).strict();
export type CFSWallFraming = z.infer<typeof CFSWallFraming>;
```

The cached fields are denormalized for the inspector panel. They are never authoritative — the system recomputes them whenever child members change. Treat them as a UI optimization, not as data the exporters should trust.

**Example value:**

```ts
{
  type: 'cfs_wall_framing',
  id: 'frm-001',
  parentId: 'wall-007',
  studSpacing_mm: null,        // inherits project default
  studSectionId: null,
  trackSectionId: null,
  defaultHeaderType: null,
  wallHeight_mm: null,
  cachedTotalWeight_kg: 287.4,
  cachedMemberCount: 38,
}
```

## 3.5 CFSMember

A single physical stick of cold-formed steel.

**Purpose.** Represents one stud, one track segment, one header, one cripple. Every member can be cut, fabricated, shipped, and counted independently.

**Parent.** Always a `CFSWallFraming`. A member never lives outside a framing.

**Geometry storage.** A member is defined by two endpoints in world space and a section reference. Endpoints define the centerline of the web. The actual extruded mesh is computed by `CFSGeometrySystem` (build slice 5) from `sectionId` + `start` + `end` + `orientation_deg`.

```ts
export const CFSMember = z.object({
  type:            z.literal('cfs_member'),
  id:              CFSMemberId,
  parentId:        CFSWallFramingId,

  role:            CFSMemberRole,
  sectionId:       CFSSectionId,

  start:           CFSPoint3D,                  // member axis start
  end:             CFSPoint3D,                  // member axis end
  orientation_deg: z.number().min(-180).max(180).default(0), // rotation about member axis; 0 = flanges horizontal

  panelId:         CFSPanelId.nullable().default(null), // null until panelization runs
  shippingMark:    z.string().min(1).optional(),         // e.g. 'P03-S07', set by exporters

  // Reverse references — cached, not authoritative.
  serviceHoleIds:  z.array(CFSServiceHoleId).default([]),
}).strict();
export type CFSMember = z.infer<typeof CFSMember>;
```

`serviceHoleIds` is denormalized for fast lookup during rendering and inspector display. The authoritative parent-child link is the hole's `parentId` pointing to this member.

**Length** is computed at runtime as `distance(start, end)`. It is not stored on the member because storing it creates a consistency hazard (geometry update without length update). Helper: `cfsMemberLength_mm(m: CFSMember): number`.

**Example value:**

```ts
{
  type: 'cfs_member',
  id: 'mem-042',
  parentId: 'frm-001',
  role: 'stud',
  sectionId: 'sec-362S162-54',
  start: { x_mm: 1219.2, y_mm: 0,    z_mm: 0 },
  end:   { x_mm: 1219.2, y_mm: 2743, z_mm: 0 },
  orientation_deg: 0,
  panelId: 'pan-002',
  shippingMark: 'P02-S05',
  serviceHoleIds: ['hol-009', 'hol-014'],
}
```

## 3.6 CFSOpening

A door or window in a wall.

**Purpose.** A user-placed marker that triggers `CFSFramingSystem` to generate king studs, jamb studs, header, sill, and cripples around it.

**Parent.** A `CFSWallFraming`. The opening's position is stored as a 1D distance along the wall's centerline (rather than a 3D point) so it survives wall edits cleanly: if the wall is moved or rotated, the opening moves with it.

```ts
export const CFSOpening = z.object({
  type:               z.literal('cfs_opening'),
  id:                 CFSOpeningId,
  parentId:           CFSWallFramingId,

  openingType:        CFSOpeningType,
  positionAlongWall_mm: z.number().nonnegative(), // distance from wall start to opening's left edge
  roughDimensions:    CFSDimensions2D,            // width × height of the rough opening
  sillHeight_mm:      z.number().nonnegative().optional(), // windows only; ignored for doors

  headerTypeOverride: CFSHeaderType.nullable().default(null), // null = use framing default

  // IDs of members that were generated to frame this opening. Cached by the system.
  generatedMemberIds: z.array(CFSMemberId).default([]),
}).strict();
export type CFSOpening = z.infer<typeof CFSOpening>;
```

`sillHeight_mm` is required for windows by runtime invariant (3.12), not by Zod — keeping it `optional` lets the same schema cover both opening types, and the system rejects windows with no sill height before generating framing.

`generatedMemberIds` is the back-pointer: when an opening is deleted, the system uses this list to clean up its kings, jambs, header, sill, and cripples.

**Example value:**

```ts
{
  type: 'cfs_opening',
  id: 'opn-003',
  parentId: 'frm-001',
  openingType: 'window',
  positionAlongWall_mm: 2438.4,
  roughDimensions: { width_mm: 914.4, height_mm: 1219.2 },
  sillHeight_mm: 914.4,
  headerTypeOverride: null,
  generatedMemberIds: ['mem-101', 'mem-102', 'mem-103', 'mem-104'],
}
```

## 3.7 CFSPanel

A shippable, erectable subdivision of a wall.

**Purpose.** Groups members for fabrication, transport, and erection. Drives BOM tabs (one tab per panel), DXF files (one file per panel), and PDF shop drawings (one page per panel).

**Parent.** A `CFSWallFraming`. Panels never span walls.

```ts
export const CFSPanel = z.object({
  type:             z.literal('cfs_panel'),
  id:               CFSPanelId,
  parentId:         CFSWallFramingId,

  label:            z.string().min(1),         // human-readable, e.g. 'P-03'
  sequenceNumber:   z.number().int().positive(), // 1-based order along the wall

  // Panel bounds along the wall, in distance-from-wall-start.
  startAlongWall_mm: z.number().nonnegative(),
  endAlongWall_mm:   z.number().positive(),

  // Cached aggregates — written by CFSPanelizationSystem.
  cachedWeight_kg:   z.number().nonnegative().optional(),
  cachedMemberCount: z.number().int().nonnegative().optional(),

  // Whether this break was placed by the user (manual) or computed (auto).
  isManualBreak:    z.boolean().default(false),
}).strict();
export type CFSPanel = z.infer<typeof CFSPanel>;
```

A panel does not store its member ids. Each member carries `panelId` pointing back at the panel. This single source of truth means re-panelization is just a `panelId` reassignment and never leaves stale arrays behind.

`isManualBreak` distinguishes panels that came from `CFSPanelBreakTool` from panels the auto-panelizer produced. The panelizer respects manual breaks on re-run.

**Example value:**

```ts
{
  type: 'cfs_panel',
  id: 'pan-002',
  parentId: 'frm-001',
  label: 'P-02',
  sequenceNumber: 2,
  startAlongWall_mm: 3657.6,
  endAlongWall_mm:   7315.2,
  cachedWeight_kg: 142.8,
  cachedMemberCount: 12,
  isManualBreak: false,
}
```

## 3.8 CFSServiceHole

A penetration through a member's web for MEP routing.

**Purpose.** Records the location and size of a punchout. Validated against AISI S100 punchout rules by `CFSServiceHoleSystem` (build slice 6). Cut from the member geometry by `CFSGeometrySystem` (build slice 5) via CSG.

**Parent.** A `CFSMember`. A hole is always tied to exactly one member.

```ts
export const CFSServiceHole = z.object({
  type:               z.literal('cfs_service_hole'),
  id:                 CFSServiceHoleId,
  parentId:           CFSMemberId,

  positionAlongMember_mm: z.number().nonnegative(), // distance from member.start
  diameter_mm:        z.number().positive(),
  shape:              z.enum(['round', 'oblong']).default('round'),
  oblongLength_mm:    z.number().positive().optional(), // required if shape === 'oblong'

  hasStiffener:       z.boolean().default(false),

  // Validator output — see CFSComplianceVerdict in 3.1.
  compliance:         CFSComplianceVerdict.default({
                        status: 'unchecked',
                        reasons: [],
                      }),
}).strict();
export type CFSServiceHole = z.infer<typeof CFSServiceHole>;
```

`compliance` carries the most recent verdict from the validator. It is part of the schema (and therefore round-trips through JSON export) so that opening a saved project shows the same red/green badges as the moment it was saved, without re-running validation. The validator re-runs whenever the hole, its member, or the AISI rule set changes.

**Example value:**

```ts
{
  type: 'cfs_service_hole',
  id: 'hol-009',
  parentId: 'mem-042',
  positionAlongMember_mm: 1371.6,
  diameter_mm: 38.1,
  shape: 'round',
  hasStiffener: false,
  compliance: {
    status: 'compliant',
    reasons: [],
    checkedAt: '2026-04-29T14:32:11Z',
  },
}
```

## 3.9 CFSConnection

A fastener pattern joining two or more members.

**Purpose.** Records that two members are screwed, welded, or clipped together, with what fastener and at what spacing. Drives shop drawing call-outs (build slice 9) and is the foundation for engineering analysis (build slice 12).

**v1 status.** Defined fully here per the execution plan's slice 2 schema list. No v1 system populates `CFSConnection` records automatically — they exist for the shop-drawing exporter to attach fastener call-outs and for v2/slice 12 to consume. Build slice 9 may create connection records implicitly while emitting PDFs; if it does, those records persist and round-trip.

**Parent.** A `CFSWallFraming`. The connected members are referenced by id in `memberIds`.

```ts
export const CFSConnectionType = z.enum([
  'screw',         // self-drilling tek screw, the v1 default
  'weld',          // shop or field weld
  'clip',          // proprietary clip-and-screw assembly
  'bolt',          // through-bolt
]);
export type CFSConnectionType = z.infer<typeof CFSConnectionType>;

export const CFSConnection = z.object({
  type:           z.literal('cfs_connection'),
  id:             CFSConnectionId,
  parentId:       CFSWallFramingId,

  connectionType: CFSConnectionType,
  memberIds:      z.array(CFSMemberId).min(2), // at least two parties to a connection

  // Fastener schedule — interpretation depends on connectionType.
  fastenerDesignation: z.string().min(1).optional(), // e.g. '#10 self-drilling'
  fastenerCount:       z.number().int().positive().optional(),
  fastenerSpacing_mm:  z.number().positive().optional(),

  location:       CFSPoint3D,                   // representative location for drawing call-outs
  notes:          z.string().optional(),
}).strict();
export type CFSConnection = z.infer<typeof CFSConnection>;
```

The fastener fields are independently optional because different connection types use different subsets: a single weld has no fastener count or spacing; a screwed seam has all three. The shop-drawing exporter chooses a sensible call-out based on which fields are populated.

**Example value:**

```ts
{
  type: 'cfs_connection',
  id: 'con-018',
  parentId: 'frm-001',
  connectionType: 'screw',
  memberIds: ['mem-042', 'mem-001'], // a stud screwed to the bottom track
  fastenerDesignation: '#10 self-drilling',
  fastenerCount: 2,
  fastenerSpacing_mm: 25.4,
  location: { x_mm: 1219.2, y_mm: 0, z_mm: 0 },
  notes: undefined,
}
```

## 3.10 Relationship diagram

The following diagram shows ownership (solid lines: `parentId` references) and reference relationships (dashed lines: id references that are not parent-child).

```
                          [ Pascal Site / Building ]
                                     │
                                     ▼ (parentId)
                              ┌─────────────┐         (libraries: [])
                              │ CFSProject  │ ──── ▷ CFSMemberLibrary[]
                              └─────────────┘            │
                                                         │ contains
                              [ Pascal Wall ]            ▼
                                     │              CFSSection[]
                                     ▼ (parentId)
                          ┌──────────────────┐
                          │ CFSWallFraming   │ ─ ─ ─ ─ ▷ studSectionId, trackSectionId
                          └──────────────────┘                   ↳ CFSSection.id
                            │   │   │   │
                ┌───────────┘   │   │   └──────────────┐
                │               │   │                  │
                ▼ (parentId)    ▼   ▼                  ▼
          CFSMember[]     CFSOpening[]  CFSPanel[]   CFSConnection[]
              │                                    ▲
              │ panelId  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
              │ sectionId ─ ─ ─ ─ ▷ CFSSection.id
              │
              ▼ (parentId)
      CFSServiceHole[]
```

Solid arrow = `parentId` (ownership; deletion cascades).
Dashed arrow = id reference (deletion of the target requires fixup of the source, see 3.12).

## 3.11 Worked example

A minimal but complete CFS scene: one project, one wall framing, one opening, two members, one panel, one service hole. JSON form, as it would appear in an exported scene file. Some values truncated for readability.

```json
{
  "schemaVersion": "1.0.0",
  "nodes": {
    "proj-001": {
      "type": "cfs_project",
      "id": "proj-001",
      "parentId": "site-root",
      "schemaVersion": "1.0.0",
      "name": "Demo project",
      "settings": {
        "defaultStudSpacing_mm": 406.4,
        "defaultStudSection": "sec-362S162-54",
        "defaultTrackSection": "sec-362T125-54",
        "defaultHeaderType": "box",
        "panelMaxWidth_mm": 3658,
        "panelMaxWeight_kg": 680,
        "wallHeight_mm": 2743,
        "units": "imperial"
      },
      "libraries": ["lib-ssma"],
      "activeLibraryId": "lib-ssma",
      "createdAt": "2026-04-29T14:00:00Z",
      "updatedAt": "2026-04-29T14:00:00Z",
      "metadata": {}
    },

    "frm-001": {
      "type": "cfs_wall_framing",
      "id": "frm-001",
      "parentId": "wall-007",
      "studSpacing_mm": null,
      "studSectionId": null,
      "trackSectionId": null,
      "defaultHeaderType": null,
      "wallHeight_mm": null
    },

    "mem-001": {
      "type": "cfs_member",
      "id": "mem-001",
      "parentId": "frm-001",
      "role": "bottom-track",
      "sectionId": "sec-362T125-54",
      "start": { "x_mm": 0,    "y_mm": 0, "z_mm": 0 },
      "end":   { "x_mm": 6096, "y_mm": 0, "z_mm": 0 },
      "orientation_deg": 0,
      "panelId": "pan-001",
      "serviceHoleIds": []
    },

    "mem-042": {
      "type": "cfs_member",
      "id": "mem-042",
      "parentId": "frm-001",
      "role": "stud",
      "sectionId": "sec-362S162-54",
      "start": { "x_mm": 1219.2, "y_mm": 0,    "z_mm": 0 },
      "end":   { "x_mm": 1219.2, "y_mm": 2743, "z_mm": 0 },
      "orientation_deg": 0,
      "panelId": "pan-001",
      "serviceHoleIds": ["hol-009"]
    },

    "opn-003": {
      "type": "cfs_opening",
      "id": "opn-003",
      "parentId": "frm-001",
      "openingType": "window",
      "positionAlongWall_mm": 2438.4,
      "roughDimensions": { "width_mm": 914.4, "height_mm": 1219.2 },
      "sillHeight_mm": 914.4,
      "headerTypeOverride": null,
      "generatedMemberIds": []
    },

    "pan-001": {
      "type": "cfs_panel",
      "id": "pan-001",
      "parentId": "frm-001",
      "label": "P-01",
      "sequenceNumber": 1,
      "startAlongWall_mm": 0,
      "endAlongWall_mm":   3657.6,
      "isManualBreak": false
    },

    "hol-009": {
      "type": "cfs_service_hole",
      "id": "hol-009",
      "parentId": "mem-042",
      "positionAlongMember_mm": 1371.6,
      "diameter_mm": 38.1,
      "shape": "round",
      "hasStiffener": false,
      "compliance": {
        "status": "compliant",
        "reasons": [],
        "checkedAt": "2026-04-29T14:32:11Z"
      }
    }
  }
}
```

This example would round-trip cleanly through `JSONExporter` and `JSONImporter` (build slice 9), reconstruct identically in the scene store, and pass every Zod schema check in this section.

## 3.12 Validation invariants

These rules cannot be expressed by Zod alone (they involve cross-schema or cross-node lookups) but are part of the data contract. They are checked by `packages/cfs/src/schema/invariants.ts`, run on every JSON import and as a debug assertion after each system update.

### Reference integrity

- `CFSMember.sectionId` must reference a `CFSSection.id` that exists in some library reachable from the active project's `libraries`.
- `CFSMember.panelId`, when not null, must reference a `CFSPanel.id` whose `parentId` equals the member's `parentId` (same framing).
- `CFSMember.parentId` must reference an existing `CFSWallFraming`.
- `CFSOpening.parentId` must reference an existing `CFSWallFraming`.
- `CFSPanel.parentId` must reference an existing `CFSWallFraming`.
- `CFSServiceHole.parentId` must reference an existing `CFSMember`.
- `CFSConnection.memberIds` entries must all reference existing `CFSMember`s, and all members must share the same `parentId`.
- `CFSProject.activeLibraryId` must appear in `CFSProject.libraries`.

### Geometric invariants

- `CFSMember.start` and `CFSMember.end` must not be coincident (length > 0).
- `CFSOpening.positionAlongWall_mm + roughDimensions.width_mm` must not exceed the parent wall's length.
- `CFSPanel.endAlongWall_mm > startAlongWall_mm`.
- `CFSPanel` instances under the same framing must not overlap, and their union should cover the wall length (gaps are allowed only at corners by explicit framing rule).
- `CFSServiceHole.positionAlongMember_mm + diameter_mm/2` must not exceed the parent member's length.

### Type-conditional invariants

- If `CFSOpening.openingType === 'window'`, `sillHeight_mm` must be present and positive.
- If `CFSServiceHole.shape === 'oblong'`, `oblongLength_mm` must be present and `> diameter_mm`.

### Deletion cascades (enforced by the scene store, not Zod)

- Deleting a `CFSWallFraming` deletes all its child members, openings, panels, and connections.
- Deleting a `CFSMember` deletes its child service holes and removes the member id from any `CFSConnection.memberIds`. If a connection is left with fewer than two members, the connection is deleted.
- Deleting a `CFSOpening` triggers `CFSFramingSystem` to delete the members listed in `generatedMemberIds`.
- Deleting a `CFSPanel` sets `panelId = null` on all members that referenced it.

These cascades are policy, not Zod validation. They live in the systems (build slices 3–7) and the deletion handlers in `useScene`. This subsection documents what those handlers must enforce so that the invariants above always hold post-mutation.
