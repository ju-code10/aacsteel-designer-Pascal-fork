# Appendix

This appendix is the closing matter of PROJECT_SPEC.md, produced by spec slice G.
It is the single canonical place where the document records what was reconciled
during the close-out sweep, which open items remain, where each one is owed a
resolution, and what the changelog of the document looks like going forward.

The appendix is a living document. Sections A.1 through A.7 below describe its
structure and how to maintain it. Every commit that changes the spec after
slice G appends a row to A.7 and may add or move items in A.3 through A.5. The
top of the document (sections 0 through 7) does not record version history; the
appendix does.

## A.1 How to read this appendix

The appendix has six parts after this introduction.

**A.2** is a single-page audit of the in-place edits slice G applied to sections
0 through 7. If you are reviewing the slice-G commit, A.2 is what to read first.

**A.3** is the list of open items raised by earlier spec slices that slice G
*resolved* — that is, the answer is now present in the body of the document, and
the appendix entry just points to where. If a question feels familiar from
reading section 5 or section 7, A.3 is where to confirm it has been answered.

**A.4** is the list of open items that have been *routed* to a specific build
slice. These are not yet resolved at the spec level, but they have a clear owner:
build slice 6 owns AISI clause numbers, build slice 9 owns Pascal-shortcut
conflict verification, and so on. A build slice's kickoff prompt should cross-
reference A.4 to find every spec-level question it inherits.

**A.5** is the v2 backlog. Items here are not v1 work and will not be resolved
during the v1 build. They are recorded so they are not lost.

**A.6** documents the conventions for editing this document after slice G.

**A.7** is the changelog. Every commit that touches the spec gets a row.

The appendix uses the same voice as sections 0 through 7 — explicit, terse,
tables where they help, prose where they don't. Where an entry references a
section, it uses that section's number. Where an entry references a build slice,
it uses the slice number from the Execution Plan's slice table.

## A.2 Cross-section reconciliations applied in slice G

The slice-G sweep made ten in-place edits to sections 0 through 7 to remove
contradictions, attach loose ends, and update self-referential wording that
pre-dated the closing pass. Each row below names the section affected, the
reconciliation in one line, and the rationale.

The full edit log lives in the slice-G commit `spec: slice G — cross-section
reconciliations` and was pre-staged as `docs/slice-g-reconciliations.md` for
review.

| ID | Section | Edit | Reason |
|---|---|---|---|
| R-01 | §1.4 | Coalescing wording reconciled to match §5.1 step 7: chord-wins with a cached-aggregate flag, not king-wins | §5.1 is the implementation contract; §1.4 was the loose wording |
| R-02 | §2.9 | Removed `opening-system.tsx` from the systems file list | §5.1 consolidated framing and opening into one system |
| R-03 | §3.3 | Added `prePunchPattern` (optional) to `CFSSection` schema | §5.4 references the field; the schema needed to grow to match |
| R-04 | §1.5 | Strengthened the relationship between §1.5 framing and §5.4 placeholder thresholds | Avoids the appearance that §1.5 numbers are normative |
| R-05 | §3.6 | Added a forward-pointer note about built-up header BOM expansion | Three sections (§3.6, §5.1, §6.1) each carried part of the story; §3.6 now connects them |
| R-06 | Top of `PROJECT_SPEC.md` | Updated preamble to reflect document completion at slice G | Document was mid-build language; now it is whole |
| R-07 | §4.6 | Updated closing note from imperative-future to descriptive-present | Slice G has done what §4.6 asked for |
| R-08 | §4.9 | Removed the implicit commitment to edit the Execution Plan | The Execution Plan is outside this project's edit scope |
| R-09 | §5.1 | Reworded the worked-coalescing note to reflect that R-01 has landed | Consistency with R-01 |
| R-10 | All sections | Added a "historical record" note to each section's "Open items raised by spec slice X" block | These lists are now history, not active TODOs |

None of these edits change the meaning of any section. They are textual
reconciliations: the document was written in pieces, and the pieces had drifted in
small ways that slice G aligned. A reader of any single section who skips slice G
sees the same architecture and the same contracts.

## A.3 Resolved open items

These items were raised by earlier spec slices and have been resolved during the
v1 spec build. The resolution is in the body of the document; this table is the
index from "where the question was raised" to "where the answer now lives."

| Item | Raised by | Resolution | Now lives in |
|---|---|---|---|
| AISI clause-number paraphrase in §1.5 | Slice A | §1.5 frames the rules; §5.4 holds the validator's shape (final) and placeholder thresholds (pending build slice 6 confirmation). The R-04 reconciliation makes the relationship explicit. | §1.5 (framing), §5.4 (validator shape); thresholds routed to build slice 6 (see A.4) |
| Mode toggle: `useEditor.phase` vs. parallel `useCFS.isCFSMode` | Slice A | Parallel boolean wins. Reasons: upstream non-modification rule, composition with Pascal phases, Execution Plan match. | §4.6 (decision), §7.1 (UI) |
| Renderer location: `apps/editor/cfs/renderers/` vs. `packages/cfs/src/renderers/` | Slice A | Renderers live in `apps/editor/cfs/renderers/` because they are React components that depend on the editor's render tree; this keeps `@pascal-app/cfs` UI-free. | §2.9 |
| `useScene` mutator signatures and Zundo wrapper presence | Slice A, restated by Slice C | Routed to build slice 1 — the spec describes the surface; build slice 1 confirms against `packages/core/src/store/use-scene.ts` and adjusts §4.7/§4.9 if reality differs. | Routed to build slice 1 (see A.4) |
| Spec slice A's mode-toggle question, restated for UI | Slice F | Same resolution: parallel boolean. Spec slice F's §7.1 includes the resolution explicitly. | §7.1 |
| Cross-store dirty propagation for `setActiveLibrary` performance | Slice C | Specified shape is correct; build slice 2 profiles and may introduce a more targeted dirty set if the sweep is slow. The schema and contract do not change. | §4.8; performance refinement routed to build slice 2 (see A.4) |
| Persistence of `unitsDisplay` between projects with different `units` settings | Slice C | Per-user `unitsDisplay` wins for display; `CFSProjectSettings.units` is the project's stored value. The display preference does not mutate stored data. | §4.5, §4.10, §7.4.2 |
| Forms and dirty-state UX | Slice C | Specified by §7.4. Each editable inspector body has its fields, validation, and immediate-write semantics defined. Dirty-form indicators and explicit confirm/cancel flows are not v1 — fields are committed on change with one Zundo step per change. | §7.4 |
| Naming: `useCFS` vs. `useCFSStore` | Slice C | `useCFS` (no Store suffix), matching Pascal's `useScene` convention. Build slice 1 confirms upstream naming has not shifted. | §4.2; final check routed to build slice 1 (see A.4) |
| `CFSSection.prePunchPattern` schema gap | Slice D | Added to §3.3 in slice G via R-03. Optional field. SSMA `ssma.json` populates it for stud sections; tracks omit it. | §3.3 |
| §1.4 vs. §5.1 coalescing direction (chord-wins vs. king-wins) | Slice D | §5.1's chord-wins is correct. §1.4 reconciled in slice G via R-01. The coalesced member retains the chord role with a cached-aggregate flag. | §1.4, §5.1 |
| §2.9 file-list reconciliation (`opening-system.tsx`) | Slice D | Slice G removed `opening-system.tsx` from §2.9 via R-02. Framing and opening logic live in `framing-system.tsx`. | §2.9 |
| Mount-point gating on `isCFSMode` for §5.3 (geometry) | Slice D | Geometry system gates on `isCFSMode` and skips work when off. Build slice 5 measures toggle-on latency and revisits if user-perceptible. | §5.0; latency check routed to build slice 5 (see A.4) |
| `CFSWallFraming` "has panels" denormalization | Slice D | Specified shape is correct as-is. Build slice 7 measures the cost; if the 200-wall sweep matters, cache as a denormalized boolean. | §5.5; cost check routed to build slice 7 (see A.4) |
| Built-up header schema vs. mapping table | Slice D, restated by Slice E | Slice G locks v1 to the mapping-table approach (§6.1) and adds the forward-pointer note in §3.6 via R-05. v2 may revisit by adding a `headerComponents` field; either path is forward-compatible. | §3.6 (note), §6.1 (table); v2 schema decision in A.5 |
| Proprietary header components | Slice E | v1 falls back to a single stud-section row with a verification note. v2 may extend `CFSMemberLibrary` with `proprietaryHeaderRecipes` per vendor. | §6.1 (v1 fallback); v2 in A.5 |
| Fastener schedule defaults | Slice E | Hardcoded defaults in §6.3 and §6.4 are v1 placeholders. Build slice 9 confirms against AISI S240 and moves them into a constants file. | §6.3, §6.4; routed to build slice 9 (see A.4) |
| DXF dimension entity quality | Slice E | Build slice 8 verifies in LibreCAD, AutoCAD, and BricsCAD; falls back to LINE+TEXT primitives if the DIMENSION entity does not render cross-tool. | Routed to build slice 8 (see A.4) |
| Pascal toolbar component path for CFS additions | Slice F | Build slice 1 locates the integration point. Spec commits to the placement contract ("right of Pascal's tools, separated by a divider") implementation-agnostic. | §7.2; routed to build slice 1 (see A.4) |
| Pascal inspector swap mechanism | Slice F | Build slice 1 implements the swap. Spec commits to the behavior (Pascal inspector hidden when `isCFSMode === true`), not the mechanism. | §7.0; routed to build slice 1 (see A.4) |
| Pascal shortcut conflicts | Slice F | Build slice 9 verifies. CFS shortcuts win when `isCFSMode === true`; Pascal wins when off. | §7.6.3; routed to build slice 9 (see A.4) |
| Mode toggle visual treatment (icons) | Slice F | Build slice 1 picks icons from Pascal's existing icon library or renders text-only. | §7.1; routed to build slice 1 (see A.4) |
| Confirmation dialog component | Slice F | Build slice 4 (first destructive action) makes the call: reuse Pascal's confirm dialog if one exists, else create `apps/editor/cfs/components/ConfirmDialog.tsx`. | §7.10; routed to build slice 4 (see A.4) |
| Tooltip-and-shortcut sync mechanism | Slice F | Build slice 9 commits to the `SHORTCUTS` map structure when implementing the shortcuts panel. The shape falls out naturally from rendering both surfaces from one source. | §7.6.5; routed to build slice 9 (see A.4) |
| Welcome callout dismissal persistence | Slice F | Session-only is the v1 default. Cross-session via localStorage is build slice 9's discretion. | §7.8.1; build slice 9 discretion |

## A.4 Active open items routed to build slices

These are the items that are not resolved at the spec level but have been
assigned to a specific build slice. A build slice's kickoff prompt should
cross-reference this table to find every spec-level question it inherits. When
a build slice resolves an item, the row moves to A.3 with a "now lives in"
pointer to the build slice's commit or to the section the spec was updated to
match.

### Build slice 1 (CFS package skeleton + mode toggle)

| Item | What slice 1 must do |
|---|---|
| `useScene` mutator signatures | Read `packages/core/src/store/use-scene.ts`. Confirm `createNode(node, parentId)`, `updateNode(id, updates)`, `deleteNode(id)` signatures. If they differ, update §2.5, §4.7, and §4.9 in the spec post-slice-1. |
| Zundo batched-undo helper | Confirm whether Pascal already provides a batched-undo helper. If yes, document its name and use it. If no, implement `with-batched-undo.ts` per the §4.9 pseudo-code. |
| `useCFS` vs. `useCFSStore` naming | Final check against upstream Pascal naming. Adjust §4.2 if upstream has shifted. |
| Pascal toolbar integration point | Locate the integration point. If it requires an upstream change to expose a slot, raise the change with Pascal upstream rather than editing upstream files. |
| Pascal inspector swap mechanism | Implement: portal slot, sibling render, or upstream change. Document the choice in a slice-1 commit comment. |
| Mode toggle icons | Pick icons from Pascal's existing library, or render text-only. Document the choice in §7.1. |

### Build slice 2 (schemas + useCFS store + member library)

| Item | What slice 2 must do |
|---|---|
| `setActiveLibrary` dirty-set scope | Profile the cross-store dirty propagation in a 200-wall scene. If the full sweep is slow, introduce a more targeted dirty set. The contract does not change. |
| `prePunchPattern` for SSMA sections | Populate the `prePunchPattern` field for every shipped stud section in `packages/cfs/src/data/ssma.json`. Standard pattern: 38 × 102 mm at 610 mm o.c. starting at 305 mm. Track sections leave the field absent. |

### Build slice 4 (`CFSOpeningTool` + openings)

| Item | What slice 4 must do |
|---|---|
| Confirmation dialog component | Reuse Pascal's confirm dialog if one exists. If not, create `apps/editor/cfs/components/ConfirmDialog.tsx` as a small Radix-based component. First destructive action is `Delete opening`. |
| `flagOpeningInvalid` storage | Per §5.1 step 5 the framing system flags invalid openings. Build slice 4 picks the storage location: an inspector-visible side-channel on `useCFS` or a `validationErrors` field on the framing's cached aggregates. The field name is finalized during this slice and documented in a follow-up edit to §5.1. |

### Build slice 5 (real C-section geometry)

| Item | What slice 5 must do |
|---|---|
| Toggle-on latency for `CFSGeometrySystem` | Measure the latency of switching from architectural to CFS mode in a populated scene. If user-perceptible (>100 ms), revisit the gating decision in §5.0 and consider keeping geometry up-to-date even when invisible. |

### Build slice 6 (service holes + AISI compliance)

| Item | What slice 6 must do |
|---|---|
| AISI clause numbers | Confirm the current edition of AISI S100 / S220 / S240 numeric values for the four placeholder rules in §5.4 (R1: 305 mm; R2: 65% web; R3: 2× length spacing; R4: 50% stiffener threshold). Update the validator's `reasons` strings to quote exact clauses. The validator's *shape* is final. |

### Build slice 7 (panelization + manual breaks)

| Item | What slice 7 must do |
|---|---|
| `CFSWallFraming.hasPanels` denormalization | Measure the cost of the "framing has panels" query in a 200-wall scene during a settings change. If 200 queries-per-change is observable, cache as a denormalized boolean on `CFSWallFraming`. |

### Build slice 8 (BOM, cut list, DXF)

| Item | What slice 8 must do |
|---|---|
| DXF dimension entity rendering | Verify `@tarikjabiri/dxf` DIMENSION entities render correctly in LibreCAD, AutoCAD, and BricsCAD. If not, fall back to LINE + TEXT primitives. Document the choice in a slice-8 commit. |

### Build slice 9 (shop drawings + JSON round-trip + polish)

| Item | What slice 9 must do |
|---|---|
| Pascal shortcut conflicts | Verify no Pascal shortcut blocks a CFS shortcut while `isCFSMode === true`. Resolve conflicts by changing the CFS letter (preferred) or coordinating an upstream Pascal change. |
| Fastener schedule defaults | Confirm v1 defaults against AISI S240 and fastener-manufacturer guidelines. Move the constants into `packages/cfs/src/lib/fastener-defaults.ts`. |
| Tooltip-and-shortcut source map | Implement the `SHORTCUTS` map keyed by action id. Both `ShortcutsPanel` and toolbar tooltips render from it. |
| Welcome callout dismissal persistence | Decide session-only vs. localStorage-persisted. Session-only is the v1 default unless the slice has time. |
| Toast positioning vs. Pascal | Verify Pascal does not already use the bottom-right corner. If it does, coordinate or move CFS toasts to a non-conflicting corner. |
| WCAG AA contrast verification | Verify every text-on-color combination in the CFS UI surfaces. Record any failures as v2 items. |
| Cross-tool DXF/xlsx/PDF visual verification | Open one DXF in LibreCAD, AutoCAD, and BricsCAD; one xlsx in Excel and LibreOffice Calc; one PDF in Preview, Acrobat, and Chrome. Per the test-case tables in §6. |

## A.5 v2 backlog

Items recorded here are not v1 work. They are recorded so the v2 planning
exercise has a starting list rather than re-deriving from build feedback.
Group headings reflect themes that emerged across the spec slices.

### Schema and data model evolution

- **`headerComponents` on `CFSOpening`.** v1 represents built-up headers as a
  single `header` member with the multi-piece nature recorded only on the parent
  opening's `headerTypeOverride`. The §6.1 BOM expansion uses a fixed mapping
  table. Slice 12 (engineering analysis) may require sub-pieces as first-class
  scene nodes; v2 considers adding a `headerComponents: CFSMemberId[]` field to
  `CFSOpening` so headers become first-class multi-piece assemblies. Either path
  is forward-compatible with v1.
- **Built-up chord studs.** v1 emits a single non-built-up chord stud at every
  wall end. v2 adds back-to-back and boxed chord configurations for higher-load
  conditions.
- **`proprietaryHeaderRecipes` on `CFSMemberLibrary`.** v1 falls back proprietary
  headers to a single stud-section row. v2 lets vendors register per-product
  component patterns in their library JSON.
- **HAT section support.** v1 schema includes `'HAT'` in `CFSProfileShape` but
  the geometry system throws on it. v2 implements the polygon and ships hat
  sections in expanded library catalogs.
- **Multi-library SSMA + vendor-specific catalogs.** v1 ships SSMA only. v2
  enables loading additional libraries (ClarkDietrich, SCAFCO, MarinoWare) at
  runtime from JSON files. The store already accommodates the map shape.

### Systems and rendering

- **Wall corner detail completeness.** v1 implements L-corners and T-intersections
  at the level of "the chord stud is present and at the right position." v2 adds
  the screw-down patterns, clip details, and built-up corner configurations.
- **Member geometry pooling.** v1 allocates fresh member geometries per dirty
  pass. If profiling shows allocation pressure in v2 scenes (1000+ walls), pool.
- **CSG performance refinement.** v1 re-runs CSG on every dirty pass for members
  with holes. v2 may incremental-CSG (cache the cut-only delta and apply on
  geometry change) or move CSG to a Web Worker.
- **Web-Worker parallelization for exporters.** v1 generates DXF, PDF, and BOM
  on the main thread. For very large projects (100+ panels) v2 parallelizes
  per-panel work via Workers.

### UI and accessibility v2

- **Multi-selection editing.** v1 reads multi-selection but edits are
  single-selection only. v2 adds bulk operations (select all openings, change
  header type to L-header).
- **Inspector search (`/`).** Reserved in §7.6.2 for v2. Jumps to a node by id,
  shipping mark, or designation.
- **ARIA roles for the canvas region.**
- **Live region for status banner announcements.**
- **Skip-links for keyboard navigation past the toolbar.**
- **Reduced-motion preference honoring** for toast slide-in animation.
- **Welcome callout cross-session persistence** via localStorage.
- **Reset-preferences command** that clears `useCFS` `localStorage` keys.
- **Clear-all-data command** that clears both IndexedDB scene and `useCFS`
  preferences.

### Slice 9 carry-forwards (added 2026-05-12)

Items deliberately deferred during the Slice 9 polish pass. Recorded here so the v2 plan inherits them with their original context.

- **One-undo-step JSON import.** `withBatchedUndo` in `packages/cfs/src/store/with-batched-undo.ts` currently *suppresses* Zundo history rather than collapsing batched mutations into one entry, so JSON-11 ("Import mid-edit: existing scene replaced; one undo step reverts the entire import") is skipped. Requires the full §4.9 pre-/post-frame `pendingBatchLabel` machinery to be implemented in Pascal upstream or worked around with a CFS-owned batcher.
- **AISI clause numbers in compliance reasons.** Slice 6 carry-over; the validator reasons still reference rules R1–R4 by name rather than by cited clause numbers from AISI S220/S240. Citation sourcing remains a separate task.
- **Box-header BOM reconciliation.** Spec §6.1 contracts that the framing pass emits *one* `header` `CFSMember` per opening and the BOM expander then explodes it into the per-piece row set (4 rows for a box header). Today the framing pass emits one `CFSMember` per physical piece — so a real-editor box-header BOM shows 4× the row count the §6.1 contract calls for. Reconciliation requires changes to `packages/cfs/src/systems/framing-pass.ts`; deferred to keep Slice 9 scoped to PDF + JSON + polish.
- **WCAG AA light-theme contrast failures.** Three role swatches in the inspector fail the 3:1 UI threshold against the editor's light-theme background:
  - `top-track` / `bottom-track` / `sill-track` (`#9ca3af`) — ratio 2.35:1.
  - `header` / `sill` (`#f59e0b`) — ratio 1.96:1.
  - `cripple` (`#22d3ee`) — ratio 1.66:1.
  All three pass comfortably in the dark theme. v2 fix: bump the saturated colors darker and the gray slightly darker, retested per theme.
- **LocalStorage-persisted welcome callout dismissal.** v1 ships session-only dismissal (A.4 default). A user preference flag in `useCFS.persist`'s partialize block would persist across reloads.
- **Per-vertical-member dimension tick marks (DXF + PDF).** §6.3 + §6.4 both call for per-stud tick marks on the bottom dimension chain. v1 emits the overall panel-width dimension only; the tick-mark loop in `dxf.ts:drawDimensions` is currently a no-op.
- **Cold mode-toggle latency.** Slice 5 carry-over; first toggle into CFS mode takes ~333 ms because the panel-projection / extrusion caches warm lazily. Pre-warming on app load would fix it.
- **`Tab` cycle through inspector controls.** §7.6.2 lists `Tab` as a binding; relies on default browser focus order which is mostly correct but has not been explicitly verified across every inspector body.
- **Cross-level corner detection.** `packages/cfs/src/lib/corner-detect.ts` compares chord positions by `(x_mm, z_mm)` only — y is dropped. Two stacked walls on different levels that share the same `(x, z)` endpoints are falsely treated as corner-shared, so one of them may skip its chord stud. Surfaced by the multi-story fix (commit `fix: multi-story CFS framing renders at level elevation`). v2: include y in the coincidence predicate, or scope peer collection to same-level framings only.

### Exports v2

- **Per-building exports.** v1 emits scene-wide deliverables. v2 picks granularity
  based on real feedback — separate files per building, separate sheets per
  building within one file, or a project-level checkbox at export time.
- **A4 paper size for shop drawings PDF.** Add `paperSize: 'letter' | 'a4'` to
  `CFSProjectSettings`. Default `letter` for `units: imperial`, `a4` for
  `units: metric`.
- **PDF Unicode font embedding.** v1 uses built-in Helvetica only. v2 may bundle
  Noto Sans (a few hundred KB per export) for non-Latin project names.
- **Streaming JSON parsing.** v1 stalls on >50 MB files. v2 uses `clarinet` or
  `JSONStream` for streaming parse.
- **JSON gzip option.** Offer `.json.gz` as an alternative download. Half-day
  work; deferred to v2 unless build slice 9 picks it up as polish.
- **CSV import** (parsing). v1 ships a hand-rolled CSV writer. v2 adds
  `papaparse` for parsing vendor catalogs from CSV. Writer and parser live in
  the same module.
- **Library JSON import for users.** The `useCFS.loadLibrary` action exists; v2
  surfaces a UI affordance for users to load their own library JSON files.

### Roadmap slices (10–12)

These are not v2 backlog items per se — they are the Execution Plan's named
roadmap slices that come after v1. They are recorded here so the appendix lists
them in one place.

- **Slice 10 — IFC4 Reference View exporter.** Each CFS member maps to
  `IfcMember` or `IfcPlate` with a steel profile. Walls map to `IfcWall` with
  framing as aggregated members. Validated against buildingSMART tools.
- **Slice 11 — CNC outputs.** DSTV NC1, FRAMECAD, Scottsdale KFS/KFD. Three
  exporters sharing a common `CFSMember → machine-instruction` translator core.
- **Slice 12 — Engineering analysis per AISI S100.** Wind and seismic load
  generation, load paths, member utilization checks, deflection, shear wall
  design. A separate package (`packages/cfs-analysis`) that depends on
  `packages/cfs` but lives cleanly apart. The biggest and most delicate
  post-v1 effort. The decision about `headerComponents` on `CFSOpening` (above)
  is most likely forced by this slice.

### Architectural revisits

- **CFS as a Pascal phase value.** Spec slice A's question (parallel boolean vs.
  fourth phase) was resolved as parallel boolean for v1. v2 may revisit if a
  use case emerges where CFS and a Pascal phase need to compose in a way the
  parallel boolean cannot express.
- **Renderer location: `apps/editor/cfs/renderers/` vs.
  `packages/cfs/src/renderers/`.** v1 places renderers in the editor app
  because they depend on the editor render tree. If `@pascal-app/cfs` becomes
  publishable as an npm package in v2, renderers move into the package and the
  editor-tree dependencies become props or React contexts.

## A.6 Document conventions for future slices

The following rules apply to every commit that changes the spec after slice G.
They are the operational continuation of the conventions in §0.6.

**One commit per intent.** Spec changes ship in their own commits, never mixed
with build-slice code commits. Commit messages are of the form `spec: <change>`
or `spec: slice N — <reason>` for build-slice-driven spec updates.

**Updates to a section update the changelog.** Every spec-changing commit
appends a row to A.7. The row names the sections changed and the reason in
one line.

**Adding open items.** New open items raised after slice G are added directly
to A.3, A.4, or A.5 — not to a section's "Open items" block (which is
historical and frozen at slice G). The decision tree:

1. Is the answer already in the document body? → A.3, with a pointer.
2. Does it have a clear build-slice owner? → A.4, under that slice.
3. Is it a v1 spec question that needs decision? → Resolve it in a spec
   commit, then add to A.3.
4. Is it not v1 work? → A.5.

**Updating §1.5, §5.4 thresholds.** When build slice 6 confirms AISI clause
numbers, the §5.4 placeholders are replaced with confirmed values *and* the §1.5
"Important" callout is updated to reflect that confirmation has happened. Both
edits are one commit.

**Changing a section's contract.** If a contract in section 5 or section 6
changes (a system's owned types, an exporter's column layout), the change is a
spec commit *first*, then the build-slice code commit second. The two commits
have descriptive messages so the audit trail shows the spec changed before the
code did.

**Changing the schema.** Any change to a `cfs_*` Zod schema is a spec commit to
section 3 *and* an `schemaVersion` bump on `CFSProject` *and* a migration entry
in the §6.5 importer's migration table. All three are one commit. The
build-slice code commit follows.

**Tag releases.** When the spec is at a stable point ready for a build phase,
tag it: `git tag spec-v1.0`, `git tag spec-v1.1`, etc. Tags are independent of
the codebase's `v1.0.0` tag and live only on the spec branch.

## A.7 Spec changelog

Every commit that changes the spec gets a row. The rows are append-only;
mistakes are corrected with a new row, not by editing prior rows.

| Date | Slice | Sections | Change |
|---|---|---|---|
| (TBD by committer) | A | 0, 1, 2 | Foundation: preamble, CFS domain primer, Pascal architecture inheritance |
| (TBD by committer) | B | 3 | Data model: every CFS Zod schema with fields, types, constraints, examples |
| (TBD by committer) | C | 4 | State management: `useCFS`/`useScene` boundary, library hydration, persistence |
| (TBD by committer) | D | 5 | Systems contracts: framing, geometry, service-hole, panelization |
| (TBD by committer) | E | 6 | Exporters: BOM xlsx, cut list csv, DXF, PDF, JSON round-trip |
| (TBD by committer) | F | 7 | UI contract: toolbar, tools, inspector, export menu, shortcuts, accessibility |
| 2026-04-30 | G | All | Polish & sweep: ten cross-section reconciliations (R-01 through R-10) and this appendix. Document tagged `spec-v1.0`. |
| 2026-05-12 | build 9 | §0.2, A.5 | Slice 9 carry-forwards recorded; §0.2 marked v1 code-complete pending manual verification + `v1.0.0` tag. |

After tag `spec-v1.0`, future rows take this shape:

| Date | Slice | Sections | Change |
|---|---|---|---|
| YYYY-MM-DD | (build slice or "patch") | (sections affected) | (one-line description) |

Examples of likely first post-v1.0 rows, projected from the A.4 routing table:

| Date | Slice | Sections | Change |
|---|---|---|---|
| (when build slice 1 completes) | build 1 | §2.5, §4.7, §4.9 | Confirmed `useScene` mutator signatures; updated to match upstream Pascal |
| (when build slice 6 completes) | build 6 | §5.4, §1.5 | Confirmed AISI clause numbers; replaced placeholder thresholds with cited values |
| (when v2 planning starts) | v2 plan | A.5 | Re-grouped v2 backlog by priority after first real-project usage |

The changelog is the audit trail. A reader six months from now should be able
to read it top-to-bottom and understand how the document arrived at its
current state.

---

*End of appendix. End of `PROJECT_SPEC.md` for spec version 1.0.*
