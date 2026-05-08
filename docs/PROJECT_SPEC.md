# PROJECT_SPEC.md

> AACSteel-Designer — architecture and build contract.
> Read this file at the start of every build session. It is the single source of truth.
> This document is built in slices. Sections 0, 1, and 2 below are the output of Spec Slice A — Foundation.

---

## 0. Preamble and conventions

### 0.1 Purpose of this document

This document is the contract that every build session reads before it writes a line of code. It exists to make the project's vocabulary, architecture, data model, behavior, and outputs unambiguous to a reader who has never seen the codebase.

There are three audiences for this file, in priority order:

1. **Claude Code, at the start of every build session.** The kickoff prompt for every slice in the Execution Plan begins with "Read CLAUDE.md and docs/PROJECT_SPEC.md." The wording, ordering, and worked examples in this document are calibrated for that reader. Where this document and a verbal instruction in chat disagree, the verbal instruction wins for that session, but the conflict should be resolved by editing this document before the next session.
2. **The human maintainer reviewing a slice.** Every section is meant to be skimmable so that "did the slice match the spec" is a fast question to answer.
3. **A future contributor onboarding to the project.** Sections 0, 1, and 2 should be enough to understand what this project is, what it does, and how it is layered.

This document is versioned in git alongside the code. Changes to it are commits, with messages of the form `spec: <change>`. Commits that change the spec and the code together are not allowed; spec changes ship in their own commit so that the diff is reviewable.

If a slice is in flight when the spec needs to change, finish the slice first, then ship the spec change, then start a new slice for the spec-driven changes. Mixing a spec change with a feature slice is the fastest way to introduce drift between what the document says and what the code does.

### 0.2 Scope of v1

v1 of AACSteel-Designer is the output of Slices 1 through 9 in the Execution Plan. v1 is considered complete when:

- A user can draw walls and place openings in CFS mode.
- The framing (studs, tracks, headers, jambs, sills, cripples) is generated automatically.
- Members render as real C, U, or Z extruded cross-sections.
- Service holes can be placed and validated against industry placement rules in real time.
- Walls can be panelized automatically with manual override.
- The user can export a Bill of Materials (xlsx), a cut list (csv), per-panel DXF drawings, and a PDF shop drawing set.
- A scene exported to JSON and re-imported reproduces the original framing exactly.

**Explicitly deferred to v2 or later:**

- IFC4 export (Slice 10).
- CNC outputs: DSTV NC1, FRAMECAD, Scottsdale (Slice 11).
- Engineering analysis per AISI S100 — load generation, member utilization, deflection, shear wall design (Slice 12).

**Non-goals — things v1 is not and should not try to be:**

- A structural analysis program. v1 produces detailing geometry and bills of materials. It does not check whether a stud is strong enough for the load it carries. That is Slice 12.
- A replacement for Tekla Structures, Revit, or any production BIM authoring tool. The output of v1 is fabrication and procurement information, not a federated BIM model.
- A general-purpose 3D modeler. The user is constrained to drawing walls and placing openings; CFS framing is generated from those primitives. The user does not place individual studs by hand.
- A multi-user real-time collaboration tool. Single user, local-first, browser-based.

### 0.3 Relationship to Pascal Editor

AACSteel-Designer is a fork of Pascal Editor (https://github.com/pascalorg/editor), a 3D building editor built on React Three Fiber and WebGPU. Pascal provides everything we need for the architectural primitives — walls, slabs, openings as architectural objects, level management, scene serialization, undo/redo, selection, and the rendering pipeline.

We extend Pascal with one new package and editor-side additions. We do not modify the Pascal packages.

**Inviolable rule: do not modify the upstream Pascal packages.**

The following packages are read-only from this project's perspective:

- `@pascal-app/core` — node schemas, scene store, systems, registries.
- `@pascal-app/viewer` — 3D canvas, renderers, viewer-state store.
- `@pascal-app/auth` — authentication.
- `@pascal-app/db` — database layer.
- `@pascal-app/ui` — shared React UI components.

If a real upstream change is required, it goes through a pull request to Pascal, not a local edit. Local edits to upstream packages are forbidden because they make rebase impossible and turn every Pascal release into a manual merge.

**Where our code lives:**

- `packages/cfs/` — the new package, published as `@pascal-app/cfs` to match Pascal's naming convention. Schemas, the `useCFS` store, CFS systems, exporters, the SSMA member library.
- `apps/editor/cfs/` — editor-side CFS additions: tools, inspector panels, the mode toggle, keyboard shortcuts.

The viewer-isolation rule that Pascal enforces on `@pascal-app/viewer` extends to our package: **`@pascal-app/cfs` must not import from `apps/editor`.** Editor-only state and tools are injected through props or composed at the editor level, never imported upward into the package.

### 0.4 Terminology

This glossary is the definitive vocabulary for the project. Every later section of this document, every kickoff prompt, and every code comment uses these words with these meanings. If a term needed during a build slice is not in this list, add it to this list before using it elsewhere.

**CFS domain terms:**

- **CFS** — cold-formed steel. Steel sheet rolled cold (without heat) into structural shapes. The framing material we are detailing.
- **Stud** — a vertical CFS member running floor to ceiling. Carries axial load and resists lateral pressure on the wall.
- **Track** — a horizontal CFS U-channel that anchors stud ends. The top track sits at the head of the wall; the bottom track at the base.
- **Jamb** — the vertical member at the side of an opening, immediately adjacent to the rough opening edge. Carries the load redirected around the opening.
- **King stud** — the vertical member outside the jamb that runs the full wall height. Together with the jamb, it forms the load path around an opening.
- **Header** — the horizontal member spanning the top of an opening, carrying the load that would otherwise travel through the opening.
- **Sill** — the horizontal member at the bottom of a window opening.
- **Cripple stud** — a short vertical member filling the space above a header (door or window) and below a sill (window only) up to the wall's top or bottom track. Maintains stud spacing for sheathing and finishes.
- **Chord stud** — a stud at the end of a wall, often built up from multiple sections, that anchors the wall to its neighbors and carries concentrated end-of-wall load.
- **Punchout** — a hole in a stud's web for routing services (plumbing, electrical, HVAC). Often pre-punched at the mill in standard locations.
- **Service hole** — a punchout placed by the detailer (us) for a specific service routing, in addition to the mill-pre-punched ones. The thing Slice 6 lets the user place.
- **Web** — the flat central portion of a C, U, or Z section. The dimension perpendicular to the flanges.
- **Flange** — the part of a C, U, or Z section perpendicular to the web. The "legs" of the section.
- **Lip** — a small return at the end of each flange of a C section that increases buckling resistance. Tracks (U sections) have no lips.
- **Section** — a specific cross-section profile, identified by a designation like `362S162-54`.
- **SSMA** — Steel Stud Manufacturers Association. Publishes the catalog of standard CFS sections used as the default member library.
- **Designation** — the SSMA identifier string, e.g., `362S162-54`. Decoded in 1.3.
- **Mil** — one thousandth of an inch (0.001 in ≈ 0.0254 mm). The canonical thickness unit for SSMA sections.
- **Panel** — a prefabricated wall segment shipped to site as a unit. Walls longer than the maximum panel width are split into multiple panels.
- **Panel break** — the line dividing two adjacent panels along the same wall.

**Pascal and system terms:**

- **Node** — the data primitive in Pascal's scene. Every wall, slab, level, building, item, and (in our extension) every CFS member, panel, opening, and service hole is a node.
- **Scene** — the full collection of nodes plus their parent-child relationships. Stored as a flat dictionary keyed by node id.
- **Renderer** — a React component that creates a Three.js mesh or group for a node. Pascal pattern: renderers create empty placeholders and register them; systems mutate them.
- **System** — a piece of logic that runs in the render loop and updates geometry or transforms for a set of nodes. Systems read from the store and write through the registry. They never own UI.
- **Dirty node** — a node that has been mutated and is awaiting system processing. Stored as a `Set<string>` of node ids on `useScene`. Systems consume and clear it.
- **Registry** — `sceneRegistry`: a `Map<id, THREE.Object3D>` plus a `byType` index, populated by renderers via the `useRegistry` hook. Lets systems jump from id to live 3D object without traversing the scene graph.
- **Store** — a Zustand state container. Pascal has three: `useScene` (scene data), `useViewer` (viewer state), `useEditor` (editor state). We add a fourth: `useCFS`.
- **Zundo** — the Zustand temporal middleware that gives the project undo/redo. It is wired into `useScene` and tracks the last 50 mutations.
- **Phase** — `useEditor.phase`: the current high-level editing mode. Pascal's values are `site | structure | furnish`. The CFS mode toggle's relationship to `phase` is an open question (see Appendix).

### 0.5 Units and conventions

**Internal storage: SI.**

All numeric values stored in nodes, schemas, and the scene serialization are in SI units:

- Length: millimeters (mm).
- Mass: kilograms (kg).
- Yield strength and stress: megapascals (MPa).
- Angles: degrees, unless explicitly noted as radians at the API boundary with Three.js.

**Display: localized.**

Inspector panels and exports may show imperial units (inches, pounds, ksi) when the user's project is set to imperial. Conversion happens at the display boundary, never in stored data. There must be exactly one source of truth for the conversion factors, in `packages/cfs/src/lib/units.ts`.

**Designation strings are not measurements.**

SSMA designations like `362S162-54` are catalog identifiers. They are stored as strings, decoded into numeric SI values for computation, and never re-encoded back into a designation by the application. The string travels with the section as its name; the numbers travel with the section as its properties.

**Coordinate system.**

Inherits from Pascal: Three.js right-handed, Y-up. Walls are vertical (along Y); their length runs along their local x-axis. The wall's local x = 0 is the start point.

**Naming conventions.**

- Types and Zod schemas: `PascalCase` (e.g., `CFSWallFraming`).
- Fields: `camelCase` (e.g., `webDepth_mm`).
- Numeric fields with units include the unit suffix: `_mm`, `_kg`, `_MPa`. This is non-negotiable. Field names without unit suffixes for numeric quantities are a bug.
- Node type discriminators: `cfs_` prefix, snake_case after, e.g., `cfs_member`, `cfs_wall_framing`, `cfs_opening`, `cfs_panel`, `cfs_service_hole`.
- File names: `kebab-case.ts` for files, matching Pascal's existing convention.
- React component files: `PascalCase.tsx`, matching Pascal's existing convention.
- Folder layout under `packages/cfs/src/`: `schema/`, `store/`, `systems/`, `lib/`, `data/`, `library/`, `exporters/`. Matches `@pascal-app/core` shape.

**No `any` in schema files.**

`packages/cfs/src/schema/` is `any`-free. Anywhere else, `any` requires a comment explaining why and a TODO for removal.

**File size soft cap: 300 lines.**

If a system file or schema file exceeds 300 lines, split it. Smaller files mean smaller per-edit context and faster reads.

**Agent instruction file convention.**

Pascal stores its agent guidance in `AGENTS.md` and symlinks `CLAUDE.md` to it. We follow the same pattern: project-wide agent instructions live in `AGENTS.md`, with `CLAUDE.md` as a symlink. Slice-specific or build-flow guidance lives in this `PROJECT_SPEC.md` document.

### 0.6 Document conventions

**Volatility ordering.**

Sections are ordered top to bottom from most stable to most volatile. Section 0 (this one) and Sections 1, 2 should rarely change after they are written. Section 3 (data model) changes when the data contract evolves. Sections 5 and 6 (systems and exporters) grow as slices are completed. The Appendix is the living tail.

**How to read this document.**

- **First read, top to bottom.** When you start the project, read sections 0, 1, 2 in order. They establish vocabulary and architecture before showing schemas or behaviors.
- **Debugging, bottom to top.** When the spec and the code disagree, suspect the most volatile section first. Inconsistencies usually live in Section 5 or in the Appendix, not Section 0.
- **Slice kickoff, targeted.** When starting a build slice, re-read the section(s) the slice consumes. The mapping from slice to section is the table below.

| Build slice | Sections consumed |
|---|---|
| 1 | 0, 2, 4, 7 |
| 2 | 1, 3, 4 |
| 3 | 1, 2, 3, 5 (Framing) |
| 4 | 1, 3, 5 (Opening, Framing), 7 |
| 5 | 1, 3, 5 (Geometry) |
| 6 | 1, 3, 5 (ServiceHole), 7 |
| 7 | 1, 3, 5 (Panelization) |
| 8 | 3, 6 |
| 9 | 3, 6, 7 |

**Contradictions are bugs.**

If two sections of this document disagree, that is a bug, not an interpretation question. Open it as an Appendix item and resolve it in the next spec slice. Do not silently pick one interpretation in code.

**Forward-pointers are explicit.**

Where one section needs to refer to a concept defined later, the reference is explicit: "See Section 4." This document does not assume a reader is reading top to bottom.

---

## 1. CFS domain primer

### 1.1 What cold-formed steel framing is

Cold-formed steel framing (CFS) is a structural system that uses thin sheet steel — typically between 0.5 mm and 2.5 mm thick — rolled cold into C, U, or Z cross-sections, then assembled with screws into walls, floors, and roofs. It is the steel cousin of light wood framing: same logic of repeated members at regular spacing, sheathed on both faces, but using steel sections instead of wood studs.

It is not the same thing as structural (hot-rolled) steel. Hot-rolled steel uses thick sections produced at high temperature — wide-flange beams, HSS columns, the kind of steel found in office tower frames. CFS members are an order of magnitude thinner and are designed to a different code (AISI S100 for the strength calculations, AISI S200-series for the framing-specific construction rules), with different failure modes (local and distortional buckling dominate, where hot-rolled cares about overall stability).

This project produces detailing geometry and fabrication outputs for CFS framing of walls. A reader who knows wood framing should think of CFS as the same craft with steel instead of wood, screw guns instead of nail guns, and pre-printed industry catalogs (SSMA) instead of nominal lumber sizes.

### 1.2 Member types and their roles

A CFS wall is built from a small set of repeating part types. Every member generated by the framing system has a `role` field; this is the canonical list of roles.

**Tracks.**
- **Top track** — horizontal U-section running the full length of the wall at the head. Receives the top of every stud.
- **Bottom track** — horizontal U-section at the base. Receives the bottom of every stud and is fastened to the floor structure.

**Studs.**
- **Field stud** — a regular vertical stud at the project-wide spacing (typically 400 mm or 600 mm o.c.). The default member.
- **Chord stud** (also called end stud) — a stud at the end of a wall, often at corners or wall-to-wall intersections. May be a single stud, a built-up pair (back-to-back), or a box (boxed studs welded or screwed together).
- **King stud** — a full-height stud immediately outside the jamb of an opening. Carries the load that travels around the opening.
- **Jamb stud** — a stud immediately inside the king, between the king and the rough opening. Supports the end of the header.

**Opening framing.**
- **Header** — a horizontal member spanning the top of an opening, supported by the jambs. Several header types exist (see below).
- **Sill** — at windows only: a horizontal member at the bottom of the rough opening.
- **Sill track** — a U-section above the sill that anchors the bottom of cripples below the window.
- **Cripple, above** — a short stud filling between the header and the top track.
- **Cripple, below** — at windows only: a short stud filling between the bottom track and the sill.

**Header types** (selectable per opening in Slice 4):
- **Box header** — a header built from two C-sections facing each other and capped with track top and bottom, forming a closed box. Strong; deeper sizes for wide spans.
- **L-header** — a single C-section with a track turned to form an L. Lighter; for shorter spans.
- **Back-to-back** — two C-sections connected web-to-web. Common; medium spans.
- **Single-track** — one track section used as a header for the lightest cases.
- **Proprietary** — a manufacturer-specific section (e.g., SCAFCO Sigma stud as a header). Treated as a section in the library; the framing system does not need to understand the details.

**Worked example — the canonical wall.**

This example is referenced throughout the document. Where any later section says "the canonical wall," it means this one.

> **The canonical wall:** 3.6 m long, 2.7 m tall, in 362S162-54 studs at 600 mm on center, with one door of rough opening 900 mm wide × 2100 mm tall placed 600 mm from the wall's start. Top and bottom tracks are 362T125-54 (a track sized to receive the 362-series stud).

For this wall, the framing system produces:

- 1 top track running the full 3.6 m.
- 1 bottom track running the full 3.6 m.
- 2 chord studs, one at each wall end.
- Field studs at 600, 1200, 1800, 2400, 3000 mm from the start, except where displaced by the opening.
- Around the door: 2 king studs (full height, both sides of the rough opening), 2 jamb studs (inside the kings), 1 header (default box-header) spanning the rough opening, and 2 cripple studs above the header.
- No sill or below-cripples (because it is a door, not a window).

Total member count for this wall: roughly 13 members. This number is referenced in Section 5 tests.

### 1.3 Section shapes and the SSMA catalog

CFS members come in three cross-section shapes:

- **C-section (lipped channel)** — used for studs and most structural members. Has a web, two flanges, and a small lip at the end of each flange. Open shape that looks like the letter C.
- **U-section (track)** — used for tracks. Web with two flanges, no lips. Looks like the letter U; opens inward to receive studs.
- **Z-section** — occasional use for purlins and specific structural roles. Web with two flanges going opposite directions, like the letter Z.

**The SSMA catalog.**

The Steel Stud Manufacturers Association publishes a catalog of standard CFS sections. Almost every commercial CFS supplier in North America produces SSMA-compliant sections, so the SSMA catalog is the de facto interchange standard. We ship it as the default member library in Slice 2.

**Decoding an SSMA designation.**

The designation `362S162-54` decodes as:

| Part | Value | Meaning |
|---|---|---|
| 362 | 3.62 in | Web depth, in 1/100 inch. 3.62 in = 91.95 mm. |
| S | stud | Style code. `S` = stud (lipped channel, C-section). Other codes: `T` = track, `U` = unlipped channel, `F` = furring. |
| 162 | 1.62 in | Flange width, in 1/100 inch. 1.62 in = 41.15 mm. |
| 54 | 54 mil | Design thickness, in mils (thousandths of an inch). 54 mil = 0.054 in = 1.37 mm. |

For sections at 54 mil and above, the steel is typically 50 ksi yield strength (345 MPa). At 33 and 43 mil, it is typically 33 ksi (228 MPa). The yield strength is a property of the section in the catalog, not encoded in the designation. The schema must store yield strength explicitly.

**Important caveats about the designation system.**

- **Mil is the canonical thickness unit, not gauge.** The legacy gauge system (16 ga, 18 ga, etc.) is ambiguous: there are two different products labeled "20 ga" — one at 30 mil and one at 33 mil. SSMA fixed this by switching to mil. Our schema keys members by mil (and by full designation string), never by gauge. A `gauge` field, if shown to the user, is a derived display value computed from mil.
- **The four-part designation is the catalog identifier.** It is unique within the SSMA catalog and unique within our member library. We use the full string as the primary key for sections in `packages/cfs/src/data/ssma.json`.
- **Section properties are tabulated, not computed at runtime.** SSMA publishes section moduli, moments of inertia, radii of gyration, and other section properties for every catalog entry. We store them in the JSON as tabulated values. The schema defines fields for the properties Slice 12 (engineering analysis) will eventually need; v1 does not compute them.
- **SSMA stock arrives pre-punched.** Standard structural studs ship with web holes already punched, typically 38 mm × 102 mm, on the centerline of the web, at 610 mm on center. The detailer's service holes (Slice 6) are placed *in addition to* these factory punchouts, and must respect them when checking spacing.

### 1.4 Wall framing layout rules

These are the rules the framing system implements in Slice 3 and extends in Slice 4. They are stated here as domain rules; the algorithmic translation is in Section 5.

**Stud spacing.**

Studs are placed at a fixed on-center spacing for the wall, set on the project (typical: 400 mm or 600 mm). Spacing is measured center-to-center along the wall's local x-axis. The first field stud sits at one spacing from the wall's start; the last field stud sits at one spacing from the wall's end, as long as the gap to the end is greater than half the spacing. Otherwise, the last field stud is omitted because the chord stud at the wall end already covers the load.

**End-of-wall conditions.**

Every wall has a chord stud at each end. If a corner or T-intersection exists, the chord stud may be shared with the adjacent wall, doubled up (back-to-back chords), or boxed, depending on the corner condition.

**Corner conditions.**

There are three corner cases the framing must handle:

- **L-corner** — two walls meet at right angles forming an L. The corner stud belongs to one wall; the other wall butts into it.
- **T-intersection** — one wall meets another in the middle of its run. The "stem" wall butts into a chord stud at the matching position on the "cap" wall.
- **Cross intersection** — four walls meet. Rare in residential CFS but possible in commercial work. Treated as two T-intersections that share a corner stud.

Slice 3 implements L-corners and T-intersections at the level of "the chord stud is present and at the right position." It does not yet implement the screw-down and clip details, which belong to a fabrication-detail slice in v2.

**Opening framing pattern.**

For every opening on a wall:

1. A king stud is placed full-height at each side of the opening, outside the rough opening edges by half the king-stud flange width.
2. A jamb stud is placed full-height at each side of the rough opening, immediately inside the king.
3. A header spans between the two jambs, sitting on top of the rough opening.
4. Cripples fill above the header up to the underside of the top track, at the wall's stud spacing.
5. For windows only: a sill spans between the two jambs at the bottom of the rough opening; a sill track sits above the sill; cripples fill below the sill down to the bottom track, at the wall's stud spacing.

**Stud-role coalescing.**

When two roles fall on the same physical position, the higher-priority role wins and the field stud is removed. Priority order (highest wins):

1. Chord stud (wall end).
2. King stud (outside an opening).
3. Jamb stud (inside an opening).
4. Field stud.

Two important coalescing cases:

- **Opening at the wall's edge.** The chord stud and the king stud collapse into one member, given the role of king (the structurally more demanding role).
- **Two adjacent openings.** Two openings with their kings closer together than one stud spacing share a single king between them. The shared king's role remains "king."

**Worked example — the canonical wall, layout walked through.**

Using the canonical wall from 1.2 (3.6 m long, 600 mm spacing, door from 600 to 1500 mm with 2100 mm height):

- Chord studs at x = 0 and x = 3600.
- Opening occupies x = 600 to x = 1500.
- King studs at x = 600 minus half the king flange and x = 1500 plus half the king flange.
- Jamb studs immediately inside the kings.
- Hypothetical field studs at x = 600, 1200, 1800, 2400, 3000.
- The field stud at x = 600 collides with the left king position; the field at x = 1200 falls inside the opening; both are removed.
- The field stud at x = 1800 is just past the right jamb; kept as a field stud.
- Net field studs: x = 1800, 2400, 3000.
- Header spans x = 600 to x = 1500, sitting at y = 2100 (the door head height).
- Cripples above the header at the wall's stud spacing.

This is the worked output the test for Slice 3 + 4 should reproduce.

### 1.5 Service holes, AISI placement rules, and the SSMA pre-punched pattern

A **service hole** is a hole through the web of a CFS member, used to route plumbing, electrical, or HVAC services from one stud bay to the next. Service holes come from two sources:

1. **Mill-pre-punched holes (factory).** SSMA stock structural studs typically arrive pre-punched with rectangular holes of 38 mm × 102 mm (1.5 in × 4 in) on the centerline of the web, at 610 mm (24 in) on center. These holes exist whether or not the detailer wants them.
2. **Detailer-placed service holes.** The user, in our tool, places additional holes for specific service routings. This is what Slice 6 builds.

**Standards governing placement.**

The placement rules live primarily in the **AISI S200-series standards** (S200, S220, S230, S240) — the framing-specific construction standards. AISI S100 is the underlying design specification that governs how strength is reduced when a member has a hole; S100 itself does not say where holes can be placed.

The single most-cited rule, applicable from Slice 6:

> **The distance from the center of the last punchout to the end of the member shall not be less than 305 mm (12 in) unless otherwise specified.**

This rule, paraphrased here, comes from AISI S220 and is also reproduced in S240 for structural framing. It applies to all studs and joists. It is the first check our compliance validator runs.

Other placement rules the validator must consider (full citations to be confirmed during Slice 6 implementation):

- **Maximum hole width** as a fraction of the web depth — typically holes wider than 65% of the flat web are not permitted without reinforcement.
- **Maximum hole length** — typically capped at a value that scales with the web depth.
- **Minimum spacing between holes** along the member — typically twice the hole length, center-to-center.
- **Hole shape** — rectangular holes have rounded corners with a minimum radius. Circular holes are also accepted.
- **Reinforcement requirements** — holes outside these limits require web stiffeners or steel patches; the geometry is permitted but the member is flagged for additional fabrication.

**Important: the precise clause numbers and numeric thresholds in the Slice 6 implementation must be cited against the current edition of the relevant AISI standard, not paraphrased from this primer.** This document gives the framing for understanding; the build slice does the citation work.

**Interaction with mill pre-punches.**

When the detailer adds a service hole, the validator must consider all holes on the member — both detailer-placed and mill-pre-punched. The pre-punched holes are not user-editable but they count for spacing rules. A model of the SSMA pre-punch pattern is part of every section in the member library: position of first hole, spacing, hole size.

### 1.6 Panelization

A **panel** is a section of wall that is fabricated as a unit and shipped to the construction site. Walls longer than the maximum panel width are split into multiple panels along their length.

**Why panelize.**

- **Shipping.** A flat-bed truck has a maximum bed width (commonly 4.0 m or 12 ft). A wall longer than that has to be split.
- **Erection.** A panel must be liftable and maneuverable on site. Maximum panel weight is set by the available crane or by manual handling limits.
- **Fabrication.** Many panel shops have a maximum jig length. Panels longer than the jig cannot be built in one shot.

Project settings establish the constraints:
- `panelMaxWidth_mm`
- `panelMaxWeight_kg`

**Forbidden break zones.**

Panel breaks cannot fall through certain features of the wall:
- **Through openings.** A break that splits a window or door is impossible to fabricate as a single header per panel.
- **Within a clearance distance of corners.** A break too close to a corner produces a panel that cannot be braced or shipped sensibly. Default clearance: one stud spacing.

**Panel-to-member relationship.**

Every CFS member belongs to exactly one panel via `member.panelId`. When the panelization system runs, it reassigns `panelId` on every affected member. Members on the same wall that span a break are split (a top track running across two panels becomes two top tracks, one per panel) — but this is a Slice 7 implementation concern, noted here so the data model in Section 3 can express it.

**Manual override.**

Even with a good auto-panelizer, a detailer often wants to force a break at a specific position — usually because of a sheathing seam, a service riser, or a coordination constraint not visible to the algorithm. Slice 7 ships a `CFSPanelBreakTool` that places a manual break at a user-clicked position; the auto-panelizer respects manual breaks as inviolable.

### 1.7 Outputs the industry expects

A v1 CFS detailing tool is judged by what it can hand to the next person in the value chain — procurement, fabrication, the field. The v1 outputs map to those audiences:

- **Bill of Materials (BOM)** — for procurement. An xlsx file. One tab per panel plus a totals tab. Lists every section ordered, by length, by quantity, by weight.
- **Cut list** — for fabrication. A csv file. One row per physical member. Lists the section, the cut length, the punchouts to add, the panel it belongs to, the shipping mark.
- **Per-panel DXF** — for the panel shop. A 2D drawing per panel, ready for the cutter and assembler. Members shown in elevation with dimensions, screw patterns, and a title block.
- **Shop drawing PDF set** — for the field and the engineer of record. An indexed PDF with one page per panel, dimensions, fastener schedule, and a panel BOM.

The Slice 8 and Slice 9 specs in Section 6 fix the column layouts and library choices. This subsection establishes only that those four outputs are what v1 produces.

**Forward-pointer to v2 outputs (deferred):**

- **IFC4 Reference View** — for BIM federation with the architectural and MEP models.
- **DSTV NC1** — for general CNC steel cutting.
- **FRAMECAD-native and Scottsdale KFS/KFD** — for the dominant CFS roll-formers' CNC lines.

---

## 2. Pascal architecture inheritance

This section documents the Pascal Editor patterns we extend. Everything described here exists in upstream Pascal and is non-modifiable from this project (per 0.3). The purpose of the section is to make the patterns explicit so our additions follow the same shapes.

The authoritative references on the Pascal side are the repository's `README.md` and `AGENTS.md`. Where this section paraphrases them, the upstream files are the source of truth; if a contradiction arises, fix this section, not Pascal.

### 2.1 The dirty-node pattern

Pascal does not walk the scene graph every frame. It marks nodes dirty when they change, and systems consume only those dirty nodes per frame.

The dirty set lives on `useScene` as a `Set<string>` of node ids:

```ts
useScene.getState().dirtyNodes // Set<string>
```

The lifecycle of a dirty node:

1. A mutation calls `useScene.getState().updateNode(id, updates)` (or `createNode`, or `deleteNode`).
2. The mutation adds `id` to `dirtyNodes` automatically. Other ids may also be added (a dirty wall typically dirties its child openings; this is implemented in the mutator).
3. Manual marking is allowed: `useScene.getState().dirtyNodes.add(id)`.
4. On the next frame, every system iterates `dirtyNodes`, processes the ids it cares about, and **deletes those ids from the set itself**.
5. Frame ends with `dirtyNodes` containing only ids that no system claimed (which should be empty in a healthy build).

Pseudo-code for a system following this pattern:

```ts
useFrame(() => {
  const { dirtyNodes, nodes } = useScene.getState()
  for (const id of dirtyNodes) {
    const node = nodes[id]
    if (node?.type !== 'cfs_wall_framing') continue
    const obj = sceneRegistry.nodes.get(id)
    if (!obj) continue
    updateFraming(obj, node)
    dirtyNodes.delete(id)
  }
})
```

**The non-negotiable rule for our systems:** never iterate over all nodes of a type in a `useFrame`. Always iterate `dirtyNodes`. Walking the full scene every frame defeats the entire pattern and tanks the frame rate. If you find yourself wanting to walk all nodes of a type, instead mark them all dirty and let the standard pattern handle the rest.

### 2.2 Stores

Pascal has three Zustand stores. We add a fourth.

| Store | Package | Owns |
|---|---|---|
| `useScene` | `@pascal-app/core` | Scene data: nodes, root ids, dirty set, CRUD mutators. Persisted to IndexedDB. Wrapped with Zundo for undo/redo. |
| `useViewer` | `@pascal-app/viewer` | Viewer state: selection (building/level/zone ids), level display mode (stacked/exploded/solo), camera mode. |
| `useEditor` | `apps/editor` | Editor state: current `phase` (`site | structure | furnish`), active tool, structure layer visibility, panel UI states. |
| `useCFS` | `@pascal-app/cfs` (new) | CFS-specific editor state: mode toggle, member libraries, active library, project settings (spacing, panel limits), inspector mode. |

The four-store layout means **scene data goes through `useScene` and only `useScene`**. Anything stored elsewhere (in `useEditor`, `useViewer`, or `useCFS`) is editor-local state that does not need to round-trip through serialization or undo/redo.

This is the single most consequential rule of the architecture. Section 4 (produced by Spec Slice C) will define the boundary precisely. The preview here:

- **Scene data → `useScene`.** All node creation, mutation, deletion. CFS members, walls, openings, panels, service holes — every persistent thing the user creates or that is derived from what they create — is a node, and nodes live here.
- **Editor-local state → the other three stores.** Selection, the active tool, which inspector tab is open, whether CFS mode is on, which member library is active, what the current project settings are.

If we put scene data in `useCFS`, we lose undo/redo and persistence for that data. If we put editor-local state in `useScene`, we pollute the undo history with cosmetic changes. The rule prevents both bugs.

### 2.3 Scene registry

`sceneRegistry` is the bridge between node ids (data) and Three.js objects (scene graph). It is a `Map<id, THREE.Object3D>` plus a `byType` index:

```ts
sceneRegistry = {
  nodes: Map<id, THREE.Object3D>
  byType: {
    wall: Set<id>
    item: Set<id>
    zone: Set<id>
    cfs_member: Set<id>           // ours
    cfs_wall_framing: Set<id>     // ours
    cfs_opening: Set<id>          // ours
    cfs_panel: Set<id>            // ours
    cfs_service_hole: Set<id>     // ours
  }
}
```

Renderers register themselves on mount via the `useRegistry` hook:

```ts
const ref = useRef<THREE.Mesh>(null!)
useRegistry(node.id, 'cfs_member', ref)
```

The hook handles unregistration on unmount.

Systems read from the registry to find the live 3D object for a given id:

```ts
const obj = sceneRegistry.nodes.get(id)
```

This pattern means systems never traverse the scene graph and never call `scene.getObjectById`. The cost of finding a 3D object for a node is `O(1)`.

### 2.4 Renderers and systems — the split

Pascal enforces a strict split between renderers and systems. We follow the same split for our additions.

**Renderers** are React components, one per node type. They:
- Mount when the node is created and unmount when it is deleted.
- Create a placeholder Three.js mesh or group with empty geometry.
- Register themselves with `useRegistry`.
- Render their children by recursing through `<NodeRenderer nodeId={childId} />`.
- **Never touch geometry beyond the empty initial state.** They do not compute extrusions, do not run CSG, do not lay out studs.

**Systems** are React components that mount once at the app level. They:
- Run `useFrame` callbacks every frame.
- Iterate `dirtyNodes`, filter by type, and process matching ids.
- Read the node from `useScene.getState().nodes[id]`.
- Look up the 3D object from `sceneRegistry.nodes.get(id)`.
- Mutate geometry, transforms, materials on the 3D object directly.
- Clear the id from `dirtyNodes` when done.
- **Never own UI.** They do not render React elements; their return value is `null`.

The rule for our additions:

- **Every CFS node type gets a renderer.** `CFSMemberRenderer`, `CFSWallFramingRenderer`, `CFSOpeningRenderer`, `CFSPanelRenderer`, `CFSServiceHoleRenderer`. Renderers create empty meshes and register them.
- **Every behavior of those nodes gets a system.** `CFSFramingSystem`, `CFSGeometrySystem`, `CFSServiceHoleSystem`, `CFSPanelizationSystem`. Systems mutate the meshes in `useFrame`.

Mixing the two — a renderer that computes its own geometry, or a system that returns JSX — is a bug. The split is what makes the dirty-node pattern work.

### 2.5 Node creation conventions

Pascal mandates a specific pattern for creating nodes:

```ts
// Right
const node = CFSMemberSchema.parse({
  type: 'cfs_member',
  parentId: framingId,
  // ... fields
})
useScene.getState().createNode(node, framingId)

// Wrong — bypasses validation, not allowed
useScene.getState().createNode({ type: 'cfs_member', /* ... */ }, framingId)
```

The `Schema.parse({...})` step validates at construction time. The `createNode(node, parentId)` call inserts into the store, sets up the parent-child relationship, marks the node and its parent dirty, and triggers Zundo.

**Always parse before creating. No exceptions.**

This rule pulls validation to the point of insertion, so a malformed node never lives in the store. It is also why we cannot use `any` in schema files — a sloppy schema lets a malformed node through, which then crashes systems silently in a `useFrame` loop where the error is hard to trace.

### 2.6 Zundo and undo/redo invariants

Pascal wraps `useScene` with the Zundo temporal middleware. Undo and redo are global and operate on the entire scene state. The history depth is **50 steps**.

Three things must be true for undo/redo to work for our CFS features:

1. **All scene data goes through `useScene` mutators** (`createNode`, `updateNode`, `deleteNode`). Direct mutation of `useScene.getState().nodes` bypasses Zundo.
2. **Editor-local state stays out of `useScene`.** Toggling the active tool should not be undoable; if "tool" lived on `useScene`, it would be.
3. **Computed derived state is derived, not stored.** If a CFS member's position is computed from its parent wall plus the framing rules, it lives in the scene as a node *with its computed values stored*, but the recomputation must be triggered by dirty propagation, not by writing to `useScene` from a `useFrame`. (Systems mutate the *3D object via the registry*; the node data only changes when the framing system runs in response to an upstream change, and that change goes through `updateNode`.)

If undo stops working after a feature is added, the cause is almost always one of these three rules being broken.

### 2.7 Event bus

Pascal uses **mitt** as a typed event emitter for inter-component communication, particularly for pointer events on nodes. The pattern:

```ts
emitter.on('wall:click', (event: NodeEvent) => { /* ... */ })
emitter.on('cfs_member:click', (event: NodeEvent) => { /* ours */ })
```

`NodeEvent` carries the node, the world position of the event, the local position on the node, an optional surface normal, and a `stopPropagation` function.

We follow the same conventions for our nodes:
- `cfs_member:click`, `cfs_member:enter`, `cfs_member:leave`
- `cfs_opening:click`, `cfs_opening:context-menu`
- `cfs_panel:click` (selecting a whole panel)
- `cfs_service_hole:click`

Event names use `node_type:event_name` with snake_case for the type and kebab-case for the event.

### 2.8 Spatial grid

Pascal has a `spatialGridManager` for collision queries — "can I place an item at this position on this floor?", "what is the slab elevation at this point?", "which walls are within radius R of this point?". It is a 2D spatial index, not a full collision detection engine.

For v1 our use of the spatial grid is incidental — Pascal's existing wall-and-opening interaction already uses it, and we benefit transparently. Our framing math does not need to query the grid directly because we work in wall-local coordinates.

The grid is mentioned here because future panel-collision work (does a panel break collide with a wall-hosted item?) will plug into it. Slice 7 does not require it; later v2 work might.

### 2.9 File and folder conventions

Our package mirrors the shape of `@pascal-app/core`:

```
packages/cfs/
  package.json          # name: "@pascal-app/cfs"
  tsconfig.json
  src/
    index.ts            # public exports
    schema/             # Zod schemas, one file per node type
      index.ts
      cfs-project.ts
      cfs-member.ts
      cfs-wall-framing.ts
      cfs-opening.ts
      cfs-panel.ts
      cfs-service-hole.ts
      cfs-connection.ts
      cfs-member-library.ts
    store/
      use-cfs.ts        # the useCFS Zustand store
    systems/
      framing-system.tsx
      opening-system.tsx
      geometry-system.tsx
      service-hole-system.tsx
      panelization-system.tsx
    library/
      load-ssma.ts      # loader + Zod validation
    data/
      ssma.json         # default member library
    exporters/
      bom.ts
      cut-list.ts
      dxf.ts
      shop-drawings.ts
      json.ts
    lib/
      units.ts          # unit conversion (single source of truth)
      ssma-decode.ts    # designation parser
```

Editor-side additions live in `apps/editor/cfs/`:

```
apps/editor/cfs/
  components/
    tools/
      OpeningTool.tsx
      ServiceHoleTool.tsx
      PanelBreakTool.tsx
    panels/
      InspectorPanel.tsx
      ShortcutsPanel.tsx
    toolbar/
      ModeToggle.tsx
  renderers/
    CFSMemberRenderer.tsx
    CFSWallFramingRenderer.tsx
    CFSOpeningRenderer.tsx
    CFSPanelRenderer.tsx
    CFSServiceHoleRenderer.tsx
```

The renderers live in `apps/editor` rather than `packages/cfs` because they are React components that depend on `apps/editor`'s rendering tree. The package stays UI-free, matching the rule that `@pascal-app/cfs` does not import from `apps/editor`.

### 2.10 Workspace tooling

Pinned by upstream Pascal as of this writing:

- **Bun** as the package manager and dev runner. `npm` and `yarn` are forbidden in this repo (per CLAUDE.md).
- **Turborepo** as the monorepo orchestrator. New packages register in the root `package.json` workspaces field and in `turbo.json`.
- **TypeScript 5.9.** Strict mode on. `any` not allowed in schema files.
- **Biome** for linting and formatting. Replaces ESLint + Prettier.
- **React 19, Next.js 16.**
- **Three.js with the WebGPU renderer.** WebGL fallback is automatic but performance-degraded.
- **React Three Fiber + Drei** for the React-Three integration.
- **Zustand** for state, **Zundo** for temporal middleware (undo/redo), **Zod** for schema validation.
- **three-bvh-csg** for Boolean geometry operations. Used by Pascal's `WallSystem` for door/window cutouts and by us in Slice 6 for service-hole CSG.
- **Tailwind CSS 4 + Radix UI** for editor UI components. Inspector panels and toolbar additions use these.
- **Supabase + Drizzle ORM** for persistence (`@pascal-app/db`). v1 of our work does not interact with this layer; we persist scene data through the same IndexedDB path Pascal already uses.

Always run `bun dev` from the repo root. This builds `@pascal-app/core` and `@pascal-app/viewer` (and now `@pascal-app/cfs`), starts the watchers, and starts the Next.js editor on port 3000. Running from a sub-package skips the watchers and the in-package edits do not propagate.

---

## Open items raised by Spec Slice A

The following questions were surfaced while writing Sections 0–2. They are listed here for the appendix, to be resolved in Spec Slice G or in the relevant build slice.

1. **AISI clause numbers.** Section 1.5 cites the 305 mm rule by paraphrase. The exact clause references in the current edition of AISI S220 and S240 must be resolved during Slice 6 before validator messages quote them.
2. **Mode toggle implementation: `useEditor.phase` vs. `useCFS.isCFSMode`.** Pascal's `useEditor.phase` already has values `site | structure | furnish`. The Execution Plan Slice 1 specifies a separate `useCFS.isCFSMode` boolean. There is a real design question here: should CFS be a fourth phase value (e.g., `cfs_detail`), composing with the existing phase machinery, or a parallel toggle? Slice 1 should pick one and document the choice; this section currently uses the parallel-toggle wording from the Execution Plan.
3. **Renderer location.** Section 2.9 places CFS renderers in `apps/editor/cfs/renderers/` rather than `packages/cfs/src/renderers/`, on the grounds that renderers are app-tree-coupled. This may need revisiting if the intent is for `@pascal-app/cfs` to be publishable as an npm package (the way `@pascal-app/core` and `@pascal-app/viewer` are). Slice 1 should confirm.
4. **`useScene` mutator signatures.** Sections 2.1 and 2.5 describe `createNode(node, parentId)`, `updateNode(id, updates)`, `deleteNode(id)` from the upstream README. Exact TypeScript signatures must be confirmed against `packages/core/src/store/use-scene.ts` during Slice 1 and any deviations corrected in this document.

---

*End of output for Spec Slice A — Foundation. Sections 3 through 7 and the full appendix are produced by Spec Slices B through G.*
