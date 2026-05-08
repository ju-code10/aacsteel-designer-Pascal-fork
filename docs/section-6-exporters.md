# 6. Exporters

This section is the contract for every production output AACSteel-Designer produces. Each subsection defines, for one exporter: the library it uses, the file it produces, the column or page layout, the rules that govern aggregation and rounding, the edge cases it handles, and the test cases it ships with. Build slices 8 and 9 each consume one or more subsections at kickoff.

The audience is Claude Code reading this section at the start of build slices 8 and 9. Treat each contract as final unless explicitly noted. The exporters are downstream of every other system — they read the scene, they do not change it — so most of the work in this section is committing to libraries, column layouts, and page templates concretely enough that the build slices can transcribe rather than re-decide.

> Note on terminology and architecture: this section sits on top of sections 0–5. Data shapes are defined in section 3 and referenced by name. Mutation rules from section 4 do not apply here — exporters are read-only over `useScene` — but the read patterns from §4.11 do. Member layouts come from §5.1, panel partitioning from §5.5, geometry from §5.3, hole compliance from §5.4. If anything here contradicts sections 0–5, sections 0–5 win and this section must be reconciled in spec slice G.

## 6.0 Exporter contract conventions

Every exporter in 6.1 through 6.5 follows the same shape, in the same order, mirroring §5.0's layout for systems. The shape exists so that a build slice always finds the same information in the same place.

### The standard subsection layout

1. **Purpose.** One paragraph: what file this exporter produces, who consumes it, and what they do with it.
2. **Library choice.** The npm package committed to, with version constraint and one-paragraph justification.
3. **Inputs.** The scene state and configuration the exporter reads. Always read-only over `useScene`.
4. **Output specification.** The full layout of the produced file: columns, sheets, pages, layers, whatever the format demands. Stated explicitly enough that a build slice does not need to make layout decisions.
5. **Algorithm.** Pseudo-code for aggregation, transformation, and writing. TypeScript-like syntax for math and structure.
6. **Edge cases.** Enumerated as named subsections under the algorithm. Mirrors §5.0's pattern.
7. **What this exporter must not touch.** A do-not-write list. Exporters are read-only by contract; this list catches accidental writes at review time.
8. **Test cases.** A table — name, input, expected output, rule verified. Build slice writes the test code.

### Cross-cutting conventions

The following rules apply to every exporter in this section. They are the §5.0-equivalent shared rules, restated once here so each subsection does not repeat them.

**Read-only over the scene.** Exporters call `useScene.getState()` and read from `nodes`. They never call `createNode`, `updateNode`, or `deleteNode`. They never touch `dirtyNodes`. They never write to `useCFS` (the one exception is the JSON importer in §6.5, which is the inverse of an exporter and creates nodes; importers and exporters are kept distinct in this section even when they share a file).

**Client-side only.** Every export runs in the browser. Files are produced as `Blob` instances and offered to the user via a transient `<a href={URL.createObjectURL(blob)} download={...}>` link clicked programmatically. There is no server round-trip. This is a hard rule for v1: a deployment without a backend must still produce every output file.

**Units follow `CFSProjectSettings.units`.** When `units === 'imperial'`, length columns and dimensions are emitted in inches (decimal, four decimal places — typical practice in CFS shop drawings). When `units === 'metric'`, lengths are emitted in millimeters (integer). The xlsx BOM is the one exception: it always shows both columns side by side, because procurement workflows often mix systems. Conversion happens through `packages/cfs/src/lib/units.ts` (§0.5), which is the single source of truth for the factor `25.4 mm = 1 in`.

**Rounding.** Lengths in stored data are floating-point millimeters. Exporters round at the display boundary, never in stored data:

| Output | Rounding rule |
|---|---|
| BOM xlsx, length_mm column | Integer mm |
| BOM xlsx, length_in column | Four decimal places |
| BOM xlsx, weight_kg column | Two decimal places |
| Cut list csv, length column | Per `units`; integer mm or four decimal in |
| DXF coordinates | Per `units`; floating-point in DXF native units, four decimal places |
| PDF dimensions printed on drawings | Per `units`; integer mm or feet-and-inches with sixteenths |

**Shipping marks.** Every physical member ships with a shipping mark — a short string that uniquely identifies it on the panel, on the cut list, on the DXF, and on the PDF. The format is fixed across all exporters:

```
{panelLabel}-{roleCode}{sequence}
```

Where `panelLabel` is the panel's `label` field (e.g., `P-02`), `roleCode` is the two-letter code from the table below, and `sequence` is a one-based per-(panel, role) counter assigned in left-to-right (or bottom-to-top for tracks) order along the wall.

| Role | Code |
|---|---|
| `top-track` | `TT` |
| `bottom-track` | `BT` |
| `stud` | `S` |
| `chord-stud` | `C` |
| `king-stud` | `K` |
| `jamb-stud` | `J` |
| `header` | `H` |
| `sill` | `SL` |
| `sill-track` | `ST` |
| `cripple` | `CR` |

So `P-02-S05` is the fifth field stud in panel `P-02`. `P-03-K1` is the first king stud in panel `P-03`. The mark is computed once by `packages/cfs/src/lib/shipping-marks.ts` at the start of any export pass and written to each member via `member.shippingMark` (§3.5). This is **the only field exporters write back to the scene**, and it is written through `updateNode` like any other mutation, batched into a single Zundo step labeled `'compute shipping marks'`. The mark survives across exports unless a member is created or deleted; the function is idempotent.

**Preflight checks.** Every exporter runs the same preflight checks before producing any output. If any fail, the exporter throws a typed error and the UI surfaces a clear message:

| Check | Message on failure |
|---|---|
| Active library is loaded (§4.3) | "No member library is loaded. Refresh the page or check the SSMA catalog." |
| `CFSProject` exists | "No CFS project in this scene. Toggle CFS mode on first." |
| Every member's `sectionId` resolves in the active library | "N members reference unresolved sections. Open the inspector to fix." |
| At least one panel exists when the exporter requires panels (BOM, DXF, PDF) | "This scene has not been panelized. Click Panelize on each wall first." |
| Every panelized framing has every member's `panelId` non-null | "N members are not assigned to a panel. Re-run panelization." |

The cut list and JSON exporters skip the panel-required checks; they work on any scene state.

**File naming.** Downloads use a consistent naming scheme:

```
{projectName}-{kind}.{ext}
```

Where `projectName` is `CFSProject.name` slugified (`/[^a-z0-9-]/i` → `-`, collapsed to single dashes, trimmed) and `kind` is one of `BOM`, `CutList`, `Panels`, `ShopDrawings`, `Scene`. Example: `Riverside-Warehouse-BOM.xlsx`, `Riverside-Warehouse-Panels.zip`, `Riverside-Warehouse-Scene.json`. Slugification lives in `packages/cfs/src/lib/slugify.ts`.

**Multi-building scope.** v1 exports the entire scene as a single deliverable set. If the user has two `Building` nodes in one Pascal scene, the BOM aggregates across both, the panels zip contains every panel from every building, and the PDF includes every panel as a sequential page. Per-building exports are deferred to v2. The rationale: until the user has used v1 on a real multi-building project, we don't know whether per-building exports should split files or just split sheets within one file. v2 picks the right granularity based on real feedback.

**Stable iteration order.** Where order matters in a file (BOM rows, cut list rows, DXF panel sequence, PDF page sequence), the order is deterministic across re-runs of the same scene. The canonical sort key is:

1. Building creation order (Pascal node `createdAt`).
2. Within a building, level elevation low-to-high.
3. Within a level, wall creation order.
4. Within a wall, panel `sequenceNumber` ascending.
5. Within a panel, member shipping mark lexicographic.

This is what makes diffs between two BOMs (e.g., before and after a change) readable: the row order doesn't shuffle just because two members happened to have the same length.

### Forbidden patterns, summarized

- An exporter writing scene data other than `member.shippingMark`. Exporters are read-only with that one exception.
- An exporter pulling values from `useCFS.preferredHeaderType` or `useCFS.unitsDisplay`. Per-user preferences are not project artifacts. The project's settings (`CFSProject.settings.units`) win.
- A server-side render path for any exporter. v1 is client-only.
- Re-deriving member layout from scratch inside an exporter. Layout is `CFSFramingSystem`'s contract; exporters consume what's there.
- An exporter computing compliance verdicts. `CFSServiceHole.compliance` is `CFSServiceHoleSystem`'s contract; exporters render what's there or skip the column.

## 6.1 `BOMExporter` — Bill of Materials (xlsx)

The procurement deliverable. A multi-tab Excel workbook listing every section the project orders, by panel, with totals.

### Purpose

Hand a procurement officer the file they paste into their ordering system. One tab per panel so a fabricator can build panels independently, and a totals tab so the buyer can issue one purchase order per section across the whole project. Both views match by construction — the totals tab is the sum of the per-panel tabs.

### Library choice

**ExcelJS, pinned to `^4.4.0`.**

ExcelJS has been the de facto standard for browser-side xlsx generation for years, supports formulas, supports per-cell styling (which we use for headers and totals rows), and produces files Excel and LibreOffice both open without warnings. The alternatives (`xlsx`/SheetJS, `write-excel-file`) are either commercially licensed for our use case or lack styling features we need for the totals tab. ExcelJS is MIT-licensed and ships ESM and CJS builds — works directly in the editor's bundle.

### Inputs

```typescript
function exportBOM(scene: SceneState, library: CFSMemberLibrary, project: CFSProject): Blob;
```

Reads from `scene`: every `CFSPanel`, every `CFSMember`, every `CFSWallFraming`. From `library`: every `CFSSection` referenced by any member. From `project`: name (for the title), settings (for units).

### Output specification

A single `.xlsx` file. Tab structure, in order:

1. **`Cover`** — one tab with project metadata. Single column of label/value pairs.
2. **`P-01`, `P-02`, ... `P-NN`** — one tab per panel, in `sequenceNumber` order across all walls, scene-wide. Tab name is `panel.label`.
3. **`Totals`** — one tab aggregating across every panel.

#### Cover tab

| Cell | Content |
|---|---|
| A1 | `Project` |
| B1 | `project.name` |
| A2 | `Job number` |
| B2 | `project.metadata.jobNumber ?? '—'` |
| A3 | `Client` |
| B3 | `project.metadata.client ?? '—'` |
| A4 | `Generated` |
| B4 | ISO timestamp at export time |
| A5 | `Schema version` |
| B5 | `project.schemaVersion` |
| A6 | `Active library` |
| B6 | `library.name` + ` ` + `library.version` |
| A7 | `Units` | 
| B7 | `'metric'` or `'imperial'` per `project.settings.units` |
| A8 | `Total panel count` |
| B8 | scene-wide panel count |
| A9 | `Total member count` |
| B9 | scene-wide member count, post-built-up-header expansion (§6.1.5) |
| A10 | `Total weight` |
| B10 | sum across the totals tab; `kg` always shown, `lb` if imperial |

Column A is bold, right-aligned, 18 chars wide. Column B is left-aligned, 40 chars wide.

#### Per-panel tab

Every per-panel tab has the same column layout. Header row 1 is bold, frozen.

| Col | Header | Type | Notes |
|---|---|---|---|
| A | `Mark` | string | shipping mark, e.g. `P-02-S05` |
| B | `Designation` | string | section designation, e.g. `362S162-54` |
| C | `Role` | string | human-readable role, e.g. `Field stud`, not the enum value |
| D | `Length (mm)` | integer | always present |
| E | `Length (in)` | decimal, 4 dp | always present |
| F | `Length (ft-in-16)` | string | feet-inches-sixteenths, e.g. `9'-0 1/16"` |
| G | `Quantity` | integer | always 1 in this view (one row per physical member) |
| H | `Unit weight (kg)` | decimal, 2 dp | `length_mm * section.linearMass_kgPerM / 1000` |
| I | `Unit weight (lb)` | decimal, 2 dp | unit weight in kg × `2.20462` |
| J | `Total weight (kg)` | decimal, 2 dp | unit × quantity |
| K | `Notes` | string | non-empty only for built-up header components and for unresolved sections (see edge cases) |

Below the data rows, a totals row. Column A is `TOTAL`, column J is `=SUM(J2:JN)` as a real Excel formula, columns B–I are empty. Bold, top border.

The "always one row per physical member" rule is what makes the BOM and the cut list diff cleanly — they have the same row count, just different columns.

#### Totals tab

Aggregates rows across every panel by `(designation, length_mm)`. Two rows in the per-panel tabs at the same designation and same length collapse to one row here with combined quantity and combined weight.

| Col | Header | Type | Notes |
|---|---|---|---|
| A | `Designation` | string |  |
| B | `Length (mm)` | integer |  |
| C | `Length (in)` | decimal, 4 dp |  |
| D | `Length (ft-in-16)` | string |  |
| E | `Quantity` | integer | aggregated count |
| F | `Unit weight (kg)` | decimal, 2 dp |  |
| G | `Total weight (kg)` | decimal, 2 dp | `unit × quantity` |
| H | `Total weight (lb)` | decimal, 2 dp |  |
| I | `Panels` | string | comma-separated panel labels where this row appears, e.g. `P-01, P-02, P-04` |

Below the data rows: a totals row in column G (`=SUM(...)`) and column H (`=SUM(...)`). Sort order: by designation alphabetic, then by length ascending. This is the order procurement wants for a purchase order.

### Algorithm

```typescript
function exportBOM(scene, library, project): Blob {
  preflight(scene, library, project, { requirePanels: true });
  computeShippingMarks(scene);   // §6.0; one Zundo batch

  const panels = sortedPanelsScene(scene);            // §6.0 stable order
  const expandedRows = panels.flatMap(panel =>
    expandPanelToBOMRows(panel, scene, library, project.settings)
  );

  const wb = new ExcelJS.Workbook();
  writeCoverTab(wb, scene, library, project, expandedRows);
  for (const panel of panels) {
    writePanelTab(wb, panel, expandedRows.filter(r => r.panelId === panel.id), project.settings);
  }
  writeTotalsTab(wb, expandedRows, project.settings);

  return new Blob(
    [await wb.xlsx.writeBuffer()],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  );
}
```

`expandPanelToBOMRows` is where the built-up header expansion happens (next subsection).

### Built-up header expansion

§5.1 emits a single `header` member per opening, with the multi-piece nature of box / back-to-back / L-headers recorded only on the parent opening's `headerTypeOverride` (or the framing's default). The BOM exporter expands these into the right purchase rows here, via a fixed mapping table. No schema change.

The mapping table lives at `packages/cfs/src/exporters/header-components.ts`:

```typescript
type ComponentSpec = {
  role: 'header-c' | 'header-track';   // BOM-only sub-roles
  sectionRef:                           // how to pick a section for this piece
    | { kind: 'studSection' }
    | { kind: 'trackSection' }
    | { kind: 'fixed', sectionId: CFSSectionId };
  lengthFactor: number;                 // 1.0 = full header length; <1 = trimmed
  quantityPerHeader: number;            // how many of this piece per header member
};

export const HEADER_COMPONENTS: Record<CFSHeaderType, ComponentSpec[]> = {
  box: [
    { role: 'header-c',     sectionRef: { kind: 'studSection'  }, lengthFactor: 1.0, quantityPerHeader: 2 },
    { role: 'header-track', sectionRef: { kind: 'trackSection' }, lengthFactor: 1.0, quantityPerHeader: 2 },
  ],
  'back-to-back': [
    { role: 'header-c',     sectionRef: { kind: 'studSection'  }, lengthFactor: 1.0, quantityPerHeader: 2 },
  ],
  'L-header': [
    { role: 'header-c',     sectionRef: { kind: 'studSection'  }, lengthFactor: 1.0, quantityPerHeader: 1 },
    { role: 'header-track', sectionRef: { kind: 'trackSection' }, lengthFactor: 1.0, quantityPerHeader: 1 },
  ],
  'single-track': [
    { role: 'header-track', sectionRef: { kind: 'trackSection' }, lengthFactor: 1.0, quantityPerHeader: 1 },
  ],
  proprietary: [
    { role: 'header-c',     sectionRef: { kind: 'studSection'  }, lengthFactor: 1.0, quantityPerHeader: 1 },
  ],
};
```

`expandPanelToBOMRows` walks every `CFSMember` in the panel; for members with `role === 'header'`, it looks up the parent opening's effective header type, looks up the matching `ComponentSpec[]`, and emits one row per component (per piece). Each row gets a synthesized shipping mark of the form `{originalMark}-A`, `-B`, etc. The `Notes` column on the per-panel tab carries `built-up: box header component 1 of 4` (or similar) so a fabricator reading the BOM understands why two rows share a parent.

For `proprietary`, the v1 expansion is a single row matching the stud section, with a Notes value of `proprietary header — verify with manufacturer`. v2 will allow proprietary types to register their own component specs through the library.

This expansion is BOM-only. The cut list (§6.2) does not expand — it lists physical members, and a single header member is a single physical thing in the data model even when it represents two C-sections back-to-back. The DXF and PDF exporters draw the header as one outline with the header-type called out. Only the BOM, which feeds procurement, needs the piece-by-piece breakdown.

### Edge cases

**Panel with no members.** Empty per-panel tab with only the header row and a totals row of zero. Surfaces a problem (a panelization bug or an empty panel from a manual break with no studs in it) without crashing.

**Member with unresolved `sectionId`.** Preflight catches this case (per §6.0) and the export aborts. If preflight is somehow bypassed, the row's designation column shows `[UNRESOLVED: sec-???]`, length is shown but unit weight is blank, and the Notes column reads `section not in active library`. The totals row shows `[UNRESOLVED]` in the weight cells rather than a misleading partial sum.

**Member length zero.** Schema invariant 3.12 prohibits this; if it sneaks through (e.g., a corrupted import), the row is included with length 0 and a Notes value of `zero-length member — investigate`. Totals are unaffected (zero contribution).

**Two panels with the same label.** Should be impossible — `CFSPanel.label` is unique within a framing by construction (`P-${i+1}`), and tabs are scoped to scene-wide ordering — but if it occurs, the second tab is named `P-02 (2)`, `P-02 (3)`, etc. Excel does not allow duplicate tab names.

**Tab name collision with reserved names.** Excel reserves a few characters in tab names (`/ \ ? * [ ]`). Panel labels in v1 are `P-NN`, which is safe. If v2 introduces user-editable labels, slugification per `packages/cfs/src/lib/slugify.ts` runs on tab names too.

**More than 256 panels.** Excel supports far more, but the workbook becomes unwieldy. v1 emits all panels regardless of count; if a project legitimately has 256+ panels, the buyer is likely splitting purchasing by some other dimension anyway and the totals tab is what matters.

### What this exporter must not touch

- Any field other than `member.shippingMark` (the shared write from §6.0).
- Geometry on the registry.
- `useCFS` of any kind.
- `CFSServiceHole.compliance` — exporters do not validate.

### Test cases

| Name | Input | Expected | Rule verified |
|---|---|---|---|
| BOM-01 | Canonical wall (§1.2) panelized into one panel | 1 cover + 1 panel + 1 totals tab; 13 data rows on the panel tab | §1.2 worked example |
| BOM-02 | Two panels, same wall | 2 panel tabs in `sequenceNumber` order; totals tab combines | §6.0 stable order |
| BOM-03 | Box header in one opening | BOM row count for that header = 4 (2 C + 2 track); cut list still shows 1 member | §6.1 built-up expansion |
| BOM-04 | L-header in one opening | BOM row count = 2 | §6.1 mapping table |
| BOM-05 | Single-track header | BOM row count = 1 | §6.1 mapping table |
| BOM-06 | Sum of per-panel weight columns equals totals tab weight | Within 0.01 kg | §6.7 cross-exporter invariant |
| BOM-07 | Imperial project units | Cover tab shows 'imperial'; both length columns populated | §6.0 units |
| BOM-08 | Member with unresolved section | Preflight aborts with named error | §6.0 preflight |
| BOM-09 | Project with no panels | Preflight aborts with 'has not been panelized' | §6.0 preflight |
| BOM-10 | Two consecutive exports of unchanged scene | Byte-identical xlsx files except for the `Generated` timestamp | §6.0 stable order |
| BOM-11 | Open output in Excel and LibreOffice Calc | No warnings, all tabs render, totals formulas evaluate | manual verification |

### Performance budget

For a 200-wall, 5,000-member scene: under 5 seconds end-to-end on a modern laptop. ExcelJS's `writeBuffer` is the dominant cost; row construction is O(members + panel-aggregations) and well under one second.

## 6.2 `CutListExporter` — Cut list (csv)

The fabrication deliverable. One row per physical member, with everything the saw operator and the assembler need.

### Purpose

Hand a fabricator a flat file they import into their cutting workflow. Saw operators read the length column and the punchout positions; assemblers read the panel and shipping mark to know which member goes where. CSV is the right format because every saw-list system on earth reads CSV; xlsx would mean fewer compatible toolchains.

### Library choice

**Hand-rolled CSV writer at `packages/cfs/src/lib/csv.ts`.**

CSV is simple enough that pulling in a dependency is overkill. The custom writer handles the only thing CSV gets wrong if you wing it: quoting fields that contain commas, quotes, or newlines. The full implementation is around 30 lines:

```typescript
export function writeCSV(rows: (string | number)[][]): string {
  const escape = (v: string | number): string => {
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return rows.map(r => r.map(escape).join(',')).join('\r\n') + '\r\n';
}
```

CRLF line endings because that's what the Excel-importing world expects. Reserved: `papaparse` is not on the v1 dependency list but is the right pick for v2 if we add CSV *parsing* (importing a member library from a vendor's CSV catalog).

### Inputs

```typescript
function exportCutList(scene: SceneState, library: CFSMemberLibrary, project: CFSProject): Blob;
```

Reads from `scene`, `library`, `project`. Same as BOM but does not require panels — the cut list is meaningful even for a non-panelized project (one row per member, panel column empty). Preflight runs without the panel checks.

### Output specification

A single `.csv` file. One header row, then one row per physical `CFSMember` in the scene, sorted by §6.0 stable order. Built-up headers are not expanded — they remain one row per physical member.

| Col | Header | Type | Notes |
|---|---|---|---|
| 1 | `mark` | string | shipping mark; empty if no panel |
| 2 | `designation` | string | e.g. `362S162-54` |
| 3 | `role` | string | enum value (e.g. `chord-stud`), not display label |
| 4 | `length` | number | per `units`: integer mm or 4-dp inches |
| 5 | `length_unit` | string | `mm` or `in` |
| 6 | `quantity` | integer | always `1` in v1 |
| 7 | `weight_kg` | decimal, 2 dp | always kg, regardless of `units` |
| 8 | `panel` | string | panel label, e.g. `P-02`; empty if `panelId` is null |
| 9 | `wall` | string | parent Pascal wall id, abbreviated to last 8 chars |
| 10 | `building` | string | parent building id, abbreviated to last 8 chars |
| 11 | `level` | string | parent level id, abbreviated to last 8 chars |
| 12 | `header_type` | string | only populated for `role === 'header'`; the `CFSHeaderType` value |
| 13 | `punchouts` | string | semicolon-separated list of `pos@diameter` entries; see below |
| 14 | `punchout_count` | integer | count of punchouts; matches `punchouts` column |
| 15 | `notes` | string | reserved for future use; empty in v1 |

The `punchouts` column encodes every service hole on the member as a single string. Format: `pos1@dia1;pos2@dia2;...`. `pos` is in the project's units (mm or 4-dp in); `dia` likewise. Mill pre-punches are **not** included — the cut list is about detailer-placed holes. Empty string if no holes.

Example row, metric, for a stud with two service holes:

```
P-02-S05,362S162-54,stud,2743,mm,1,4.42,P-02,abc12345,bld11111,lvl22222,,1372@38;1829@38,2,
```

Same row, imperial:

```
P-02-S05,362S162-54,stud,108.0000,in,1,4.42,P-02,abc12345,bld11111,lvl22222,,54.0000@1.5000;72.0000@1.5000,2,
```

The `weight_kg` column is always kg even in imperial mode because mass on a saw list is most often used for shipping logistics, where kg is the global unit. The buyer who wants pounds reads the BOM (which has both columns).

### Algorithm

```typescript
function exportCutList(scene, library, project): Blob {
  preflight(scene, library, project, { requirePanels: false });
  computeShippingMarks(scene);

  const members = sortedMembersScene(scene);   // §6.0 stable order, applied member-level
  const settings = project.settings;
  const useImperial = settings.units === 'imperial';

  const headers = [
    'mark','designation','role','length','length_unit','quantity',
    'weight_kg','panel','wall','building','level','header_type',
    'punchouts','punchout_count','notes'
  ];
  const rows: (string | number)[][] = [headers];

  for (const m of members) {
    const section = library.sections.find(s => s.id === m.sectionId)!;
    const length_mm = cfsMemberLength_mm(m);
    const length    = useImperial ? round4(length_mm / 25.4) : Math.round(length_mm);
    const weight_kg = round2(length_mm * section.linearMass_kgPerM / 1000);

    const holes = (m.serviceHoleIds ?? []).map(id => scene.nodes[id] as CFSServiceHole)
      .filter(Boolean)
      .sort((a, b) => a.positionAlongMember_mm - b.positionAlongMember_mm);
    const punchouts = holes.map(h => {
      const pos = useImperial ? round4(h.positionAlongMember_mm / 25.4) : Math.round(h.positionAlongMember_mm);
      const dia = useImperial ? round4(h.diameter_mm / 25.4) : Math.round(h.diameter_mm);
      return `${pos}@${dia}`;
    }).join(';');

    const panel = m.panelId ? (scene.nodes[m.panelId] as CFSPanel).label : '';
    const wallNode = scene.nodes[(scene.nodes[m.parentId] as CFSWallFraming).parentId];
    const wall = shortId(wallNode.id);
    const building = shortId(buildingOf(wallNode, scene));
    const level = shortId(levelOf(wallNode, scene));
    const headerType = m.role === 'header' ? headerTypeFor(m, scene, settings) : '';

    rows.push([
      m.shippingMark ?? '', section.designation, m.role, length, useImperial ? 'in' : 'mm',
      1, weight_kg, panel, wall, building, level, headerType,
      punchouts, holes.length, ''
    ]);
  }

  const csv = writeCSV(rows);
  return new Blob([csv], { type: 'text/csv;charset=utf-8' });
}
```

`shortId` returns the last 8 chars of a UUID. Full ids would make the file unreadable in a saw-room printout; 8 chars are unique enough within a single project and fit a standard column width.

### Edge cases

**Member with `panelId === null`.** Panel column empty. The cut list still emits the row — see "preflight does not require panels."

**Member with no parent wall (corruption).** Preflight does not catch this case. The row is emitted with `wall`, `building`, `level` empty and a non-empty `notes` column reading `orphan member`. Diagnostic, not fatal.

**Mill pre-punches.** Not included in the `punchouts` column. The fabricator knows the SSMA pattern; the cut list documents only the additions the detailer made. v2 may add an opt-in column for full-pattern output if a fabricator workflow needs it.

**Unicode in project name or building id.** The CSV is UTF-8 encoded. Excel needs a BOM (`\uFEFF` at the start of the file) to read UTF-8 reliably; the writer prepends one. Without it, non-ASCII characters in (rare) custom material designations or notes get mojibaked.

**Header member with a missing parent opening.** `headerTypeFor` returns the framing default. This is the same fallback §5.1 step 6 uses when `headerTypeOverride` is null.

### What this exporter must not touch

- Anything other than `member.shippingMark` (shared write from §6.0).
- Geometry, registry, `useCFS`.
- The order of members in `useScene.nodes` — the sort is internal to the export.

### Test cases

| Name | Input | Expected | Rule verified |
|---|---|---|---|
| CUT-01 | Canonical wall, panelized | Row count = 13 (one per member) | §1.2 worked example |
| CUT-02 | Same scene, imperial vs metric | All length values convert with 4-dp accuracy | §6.0 units |
| CUT-03 | Stud with 2 holes | `punchouts` column has 2 entries; `punchout_count` = 2 | §6.2 punchout serialization |
| CUT-04 | Stud with 0 holes | `punchouts` column empty; `punchout_count` = 0 | §6.2 |
| CUT-05 | Member without panel assignment | `panel` column empty; row still emitted | §6.2 no-panel case |
| CUT-06 | Box header member | One row, `header_type = box`; not expanded into 4 | §6.2 vs §6.1 |
| CUT-07 | Project with non-ASCII name | File opens correctly in Excel with BOM | §6.2 unicode |
| CUT-08 | Sum of `weight_kg` column equals BOM totals tab weight | Match within 0.01 kg | §6.7 invariant |
| CUT-09 | Two consecutive exports | Byte-identical CSVs | §6.0 stable order |
| CUT-10 | Empty scene | Header row only, no data rows | §6.2 |

### Performance budget

For a 5,000-member scene: under 500 ms. CSV writing is allocation-bound; the dominant cost is string concatenation inside `writeCSV`. Sub-second is achievable without optimization.

## 6.3 `DXFExporter` — Per-panel DXF (zip of files)

The detailing deliverable. One DXF file per panel, ready for the panel shop's CAD or CNC-prep software. All DXFs bundled into a single `.zip` for download.

### Purpose

Hand a panel shop the drawing they need to fabricate one panel. DXF is the universal CAD interchange format — every CAD program from AutoCAD to LibreCAD reads it, and most CFS panel-shop CNC software expects it. One file per panel because each panel goes to one fabrication line; bundling into one DXF would force every shop to filter every layer.

### Library choice

**`@tarikjabiri/dxf`, pinned to `^1.6.0`.**

Three credible candidates considered:

| Library | License | TS support | Maintained | Verdict |
|---|---|---|---|---|
| `dxf-writer` | MIT | DefinitelyTyped only | last update 2021 | Older, JavaScript-first; works but the type story is shaky |
| `@tarikjabiri/dxf` | MIT | native TypeScript | active | Modern API, layers and dimensions first-class, good test coverage |
| `dxf-writer-ts` | MIT | native | sporadic | Smaller community, fewer entity types |

`@tarikjabiri/dxf` wins on TypeScript-native typing (matches our zero-`any`-in-schema rule), active maintenance, and first-class support for the entity types we need (LWPOLYLINE, LINE, CIRCLE, TEXT, MTEXT, INSERT for blocks, DIMENSION). If the library is abandoned or breaks at build-slice-8 time, `dxf-writer` is the fallback; the API surface this section commits to is library-agnostic enough that a swap would be local to `packages/cfs/src/exporters/dxf.ts`.

For zipping: **`fflate`, pinned to `^0.8.2`.** Tiny (8 KB), zero deps, browser-friendly, faster than JSZip on benchmarks. Used for one operation per export.

### Inputs

```typescript
function exportDXFs(scene: SceneState, library: CFSMemberLibrary, project: CFSProject): Blob;
```

Returns a `Blob` of zipped DXFs, one per panel scene-wide.

### Output specification

A `.zip` archive containing N `.dxf` files, one per panel. File naming inside the zip: `{panel.label}.dxf`, e.g. `P-01.dxf`, `P-02.dxf`. Files at the archive root, no subdirectory.

#### Per-panel DXF: coordinate system

DXF has a model space and a paper space. We use **model space in the project's units**:

- `units === 'metric'` → `$INSUNITS = 4` (millimeters), all entities in mm.
- `units === 'imperial'` → `$INSUNITS = 1` (inches), all entities in 4-dp inches.

The DXF's origin is the bottom-left corner of the panel as drawn (panel-local coordinates). The X axis runs along the wall length (left-to-right when looking at the panel from the room side), Y runs vertically. Members from §5.1 are in world coordinates — the exporter transforms them into panel-local coordinates by translating so that `panel.startAlongWall_mm` becomes `0` and the bottom of the wall becomes `0`. This is what makes opening multiple panel files in a CAD tool show each panel at the same origin.

#### Per-panel DXF: layer scheme

| Layer | Color (ACI) | Contents |
|---|---|---|
| `0` | white (7) | reserved AutoCAD default; empty |
| `MEMBERS_TRACK` | gray (8) | top-track and bottom-track outlines |
| `MEMBERS_STUD` | blue (5) | field studs |
| `MEMBERS_CHORD` | dark blue (4) | chord studs |
| `MEMBERS_KING` | cyan (4) | king studs |
| `MEMBERS_JAMB` | green (3) | jamb studs |
| `MEMBERS_HEADER` | red (1) | headers |
| `MEMBERS_SILL` | red (1) | sills and sill-tracks |
| `MEMBERS_CRIPPLE` | yellow (2) | cripples |
| `HOLES` | magenta (6) | service-hole outlines |
| `DIMENSIONS` | white (7) | dimension lines and text |
| `LABELS` | white (7) | shipping marks (MTEXT entities) |
| `TITLEBLOCK` | white (7) | title block geometry and text |
| `NOTES` | white (7) | fastener call-outs, header-type notes |

Layer-per-role (rather than one `MEMBERS` layer with per-entity colors) is what panel-shop software expects; many shops have automation that turns specific layers on or off (e.g., "show me only the studs while I program the cutter").

#### Per-panel DXF: entity layout

The drawing on each panel sheet has four regions:

```
+----------------------------------------------+
|                                              |
|   [ panel elevation — actual member outlines, dimensioned ]
|                                              |
|                                              |
+----------------------------------------------+
|   [ fastener schedule ]    [ title block ]   |
+----------------------------------------------+
```

The panel elevation is the entire DXF model-space content. The fastener schedule and title block are the bottom strip.

**Panel elevation:**

Every member is drawn as an LWPOLYLINE outline of its 2D projection on the wall plane. For a vertical stud or king, this is a thin rectangle of width = `flangeWidth_mm` and height = the member's length. For a horizontal track, header, or sill, this is a thin rectangle of width = the member length and height = `webDepth_mm`. The polyline closes; thickness is the section's wall thickness. Each member sits on its role's layer.

Each member also gets a label: an MTEXT entity at the member's mid-point, on the `LABELS` layer, showing the shipping mark in 3 mm tall (or 0.125 in tall) text. The label is rotated to match the member's axis (vertical for studs, horizontal for tracks) so it reads parallel to the member.

**Service holes:** A CIRCLE entity at each hole's position, on the `HOLES` layer. Diameter matches the hole. Mill pre-punches are not drawn — the panel shop knows the SSMA pattern. The circle is on the front-face projection of the member; if the user has placed two holes that overlap (a mistake the validator should catch), both circles render and the user sees the overlap.

**Dimensions:** A horizontal dimension chain along the bottom of the panel showing every stud spacing and every opening edge position. Vertical dimensions on the left side showing wall height, header height, and (for windows) sill height. Dimensions are aligned (running parallel to what they measure) and use DXF DIMENSION entities so CAD tools render them with arrows and text per the dim style. Style block: `STANDARD` style at 3 mm or 0.125 in text height, no tolerance, decimal precision matching the project units.

**Fastener schedule:** A small text block in the bottom-left of the bottom strip, on the `NOTES` layer:

```
FASTENER SCHEDULE (TYPICAL)
----------------------------
Stud-to-track:   #10 self-drilling, 2 per joint
Header-to-king:  #10 self-drilling, 4 per joint
Sheathing:       per project specifications
```

If the scene has populated `CFSConnection` records (Slice 9 may emit some implicitly), the schedule reads from them; otherwise it shows the defaults above. This matches §5.4's fallback pattern for unconfirmed AISI thresholds — defaults that are correct enough for v1 review, with a reconciliation note for v2.

**Title block:** A bordered rectangle in the bottom-right of the bottom strip. Standard fields:

```
+----------------------+--------------+
| PROJECT              | DATE         |
| {project.name}       | {ISO date}   |
+----------------------+--------------+
| PANEL                | SCALE        |
| {panel.label}        | NTS          |
+----------------------+--------------+
| WEIGHT               | MEMBERS      |
| {cachedWeight_kg} kg | {memberCount}|
+----------------------+--------------+
| TOOL                 | LIBRARY      |
| AACSteel-Designer    | {lib.name}   |
+----------------------+--------------+
```

Lines are LINE entities; text is TEXT entities. SCALE is `NTS` (not to scale) because most panel-shop software re-scales when printing; setting an explicit scale would just confuse the toolchain.

#### Per-panel DXF: sheet sizing

The DXF has no "sheet" in model space; sheet size is a paper-space concept. v1 emits model-space only and lets the consuming CAD tool handle paper-space layout. The bottom-strip region is positioned in model space at:

- Y from `-300 mm` (or `-12 in`) to `0 mm`, where `0` is the bottom of the wall.
- X spans the panel width.

This puts the title block and fastener schedule below the panel elevation, where they don't overlap any drawing content.

### Algorithm

```typescript
function exportDXFs(scene, library, project): Blob {
  preflight(scene, library, project, { requirePanels: true });
  computeShippingMarks(scene);

  const panels = sortedPanelsScene(scene);
  const files: Record<string, Uint8Array> = {};

  for (const panel of panels) {
    const dxf = buildPanelDXF(panel, scene, library, project);
    files[`${panel.label}.dxf`] = new TextEncoder().encode(dxf);
  }

  const zipped = fflate.zipSync(files, { level: 6 });
  return new Blob([zipped], { type: 'application/zip' });
}

function buildPanelDXF(panel, scene, library, project): string {
  const writer = new DXFWriter();
  writer.setUnits(project.settings.units === 'metric' ? 'mm' : 'in');
  defineLayers(writer);

  const members = membersInPanel(panel, scene);
  const transform = panelLocalTransform(panel, scene);

  for (const m of members) drawMember(writer, m, library, transform, project.settings);
  for (const m of members) drawHoles(writer, m, scene, transform, project.settings);
  drawDimensions(writer, panel, members, transform, project.settings);
  drawTitleBlock(writer, panel, project, library);
  drawFastenerSchedule(writer, panel, scene);

  return writer.stringify();
}
```

`drawMember` emits one LWPOLYLINE on the role's layer plus one MTEXT on `LABELS`. `drawHoles` walks `member.serviceHoleIds` and emits a CIRCLE per hole. `drawDimensions` emits DIMENSION entities for the horizontal stud-spacing chain and the vertical wall-height chain.

### Edge cases

**Panel with one member (e.g., a manual break with just a chord stud).** Drawing is sparse but valid. Title block and fastener schedule render; dimension chain is short.

**Panel with overlapping members (e.g., a chord that coalesced with a king per §5.1 step 7).** One outline drawn, on the higher-priority role's layer (chord). Both shipping marks would not normally be applied to one physical member; the coalesce produces one mark. If the spec drift means two marks did apply, the exporter labels with the chord's mark and adds a Notes call-out: `also serves as king for opening at x=0`.

**Imperial project with metric SSMA section data.** Conversions happen at the drawing boundary. A 91.95 mm web depth becomes 3.6201 in (4 dp) in the polyline coordinates. Round-trip back to metric would not bit-identically reproduce 91.95, but for shop use the difference is below the cut tolerance.

**Service hole at the very edge of a member.** A hole at `positionAlongMember_mm = 5` on a stud whose left flange is at x = 0 would draw a circle straddling the flange edge. This is what the geometry actually looks like (and is what the AISI 305 mm rule is designed to catch); the DXF draws it faithfully. The compliance verdict on the hole is non-compliant; the fabricator will reject the panel before cutting. The DXF showing the truth is correct behavior.

**Panel with a manual break that crosses no studs.** Empty panel space between studs. The drawing shows the panel boundaries (via the title block region) and an empty elevation. Surfaces a panelization issue without crashing.

**Special characters in project name.** DXF text entities encode as UTF-8 in the file; AutoCAD reads UTF-8 if the DXF version is R2010 or later. The writer outputs R2018 (`AC1032`).

### What this exporter must not touch

- Anything other than `member.shippingMark`.
- The geometry on the registry — DXF outlines are computed from data, not extracted from the 3D mesh.
- `useCFS`.

### Test cases

| Name | Input | Expected | Rule verified |
|---|---|---|---|
| DXF-01 | Single panel | One DXF in the zip; opens in LibreCAD without warnings | manual verification |
| DXF-02 | Multi-panel scene | One DXF per panel; archive contents sorted by `sequenceNumber` | §6.0 stable order |
| DXF-03 | Imperial project | Coordinates in inches, 4 dp; `$INSUNITS = 1` in DXF header | §6.0 units |
| DXF-04 | Metric project | Coordinates in mm, integer; `$INSUNITS = 4` | §6.0 units |
| DXF-05 | Service holes present | CIRCLE entities on `HOLES` layer at correct positions | §6.3 hole rendering |
| DXF-06 | Layer count | Exactly 14 layers per the §6.3 table | §6.3 layer scheme |
| DXF-07 | Title block populated | All 8 fields present and non-empty | §6.3 title block |
| DXF-08 | Open in AutoCAD, LibreCAD, BricsCAD | Each opens without warning; entity counts match | manual verification |
| DXF-09 | Empty panel (manual break with no members) | Valid DXF; title block + dimensions, empty elevation | §6.3 edge case |
| DXF-10 | Coalesced chord+king | One outline, on `MEMBERS_CHORD` layer, with a notes call-out | §5.1 coalescing |

### Performance budget

For a 100-panel scene: under 10 seconds end-to-end. DXF text generation is the dominant cost; zipping is negligible (`fflate` is fast). The bottleneck is dimension entity generation in `@tarikjabiri/dxf`, which is per-panel; parallelizing across panels via Web Workers is a v2 optimization if needed.

## 6.4 `ShopDrawingExporter` — Shop drawings (PDF)

The field deliverable. A multi-page PDF: cover, one page per panel, summary. For the field crew, the engineer of record, and project records.

### Purpose

Hand the field a printable book. Each panel page shows what one panel looks like, dimensioned, with a per-panel BOM in a corner so the erector can verify content on receipt. The cover indexes the pages; the summary aggregates project-wide. The PDF is the artifact that ends up in a project binder; the BOM xlsx is for the office, the DXF zip is for the shop, the PDF is for everyone else.

### Library choice

**`pdf-lib`, pinned to `^1.17.1`.**

Three candidates considered:

| Library | Browser-friendly | Layout primitives | Verdict |
|---|---|---|---|
| `pdf-lib` | yes (no Node deps) | low-level: pages, text, paths, images | Right granularity; we draw geometry directly |
| `pdfmake` | yes | high-level: declarative document model | Strong for text-heavy docs; weaker when you need pixel-precise vector drawings |
| `jsPDF` | yes | mid-level | Older API, less actively maintained; precision quirks in path drawing |

We need pixel-precise vector drawings of panels (the elevation has to match the DXF), so we want low-level path primitives. `pdf-lib` gives us that without imposing a layout DSL. Text layout is hand-rolled for the title block and BOM table, which is a few dozen lines. Active maintenance, broadly used, ESM-friendly.

### Inputs

```typescript
function exportShopDrawings(scene: SceneState, library: CFSMemberLibrary, project: CFSProject): Blob;
```

### Output specification

A single `.pdf` file with the following page structure:

1. **Cover / index page** (page 1)
2. **Per-panel pages** (pages 2 to N+1, where N = panel count)
3. **Summary page** (page N+2)

#### Page size

US Letter portrait, **8.5 in × 11 in**, regardless of project units. Letter is the dominant format for North American CFS shop drawings; A4 deferred to v2 with a project-level setting.

Margins: 0.5 in on all sides. Working area 7.5 in × 10 in.

#### Cover page

| Region | Content |
|---|---|
| Top header (1 in) | "AACSteel-Designer Shop Drawings" centered, 18-pt bold |
| Project block (left, 4 in tall) | Project name (16-pt), job number, client, date, schema version (10-pt each) |
| Library block (right, 4 in tall) | Active library name and version, total panel count, total member count, total weight (10-pt each) |
| Index table (bottom, fills remainder) | Two columns: panel label / page number, listing every panel in order |

#### Per-panel page

Layout:

```
+------------------------------------------------------+
| Title bar (0.5 in tall)                              |
|   "Panel P-02"   ... right-aligned: "Page 3 of N"    |
+------------------------------------------------------+
|                                                      |
|  Panel elevation (top 6 in of working area)          |
|    [ scaled drawing of the panel, dimensioned ]      |
|                                                      |
+------------------------------------------------------+
|                                                      |
|  Panel BOM (bottom 3 in)                             |
|  +----------------+   +-----------------------------+|
|  | Fastener block |   | Per-panel BOM mini-table    ||
|  | 1.5 in × 2.5 in|   | designation/length/qty/wt   ||
|  +----------------+   +-----------------------------+|
+------------------------------------------------------+
| Title block (0.5 in tall, full width)                |
|   project | panel | weight | date | sheet number     |
+------------------------------------------------------+
```

**Panel elevation:** Drawn with `pdf-lib`'s path primitives. Scale chosen automatically so the panel's longer dimension fits within the 7.5 in × 6 in elevation region with at least 0.25 in of margin. Members rendered as filled rectangles with role colors (matching the DXF layer colors but rendered as fills, not outlines, for better print legibility). Service holes rendered as filled circles with a contrasting outline. Dimensions: a horizontal chain along the bottom, vertical chain along the left, with arrows and text in 8-pt.

Member labels (shipping marks) overlaid on the elevation in 7-pt text, white text on a dark fill for studs, dark text on no fill for tracks. Labels for very short members (cripples) are placed above the member with a leader line.

**Per-panel BOM mini-table:** Same row structure as the BOM xlsx per-panel tab (post-built-up-header expansion), but condensed: columns are `Mark`, `Designation`, `Length`, `Qty`, `Weight`. Header row in 9-pt bold, data rows in 8-pt regular. Alternating row shading (very light gray every other row). Up to 30 rows fit; if a panel has more, the table continues onto a sub-page (page numbering becomes `3a, 3b, ...`).

**Fastener block:** Same content as the DXF fastener schedule (§6.3), formatted as a small text block with section header "FASTENERS" in 8-pt bold, items in 7-pt.

**Title block (per page):** Rectangular border, 6 fields:

| Field | Source |
|---|---|
| `Project` | `project.name` |
| `Panel` | `panel.label` |
| `Weight` | `panel.cachedWeight_kg` formatted with `kg` |
| `Date` | ISO date at export time |
| `Sheet` | `n of N` |
| `Tool` | `AACSteel-Designer v1.0.0` |

#### Summary page

Last page. Three regions stacked vertically:

1. **Project summary table.** Same columns as the BOM `Totals` tab, but truncated to the top 30 rows by weight. Header bold, totals row at the bottom.
2. **Panel index recap.** Every panel listed with sequence number, label, weight, member count.
3. **Notes section.** Any `project.metadata.notes` content if present, otherwise "No notes." Reserved for the engineer of record to write in margins on a printed copy.

Footer on every page (cover, panel pages, summary): page number centered, `Generated by AACSteel-Designer · {timestamp}` left-aligned, in 7-pt gray.

### Algorithm

```typescript
function exportShopDrawings(scene, library, project): Blob {
  preflight(scene, library, project, { requirePanels: true });
  computeShippingMarks(scene);

  const panels = sortedPanelsScene(scene);
  const pdf = await PDFDocument.create();
  const fonts = await loadFonts(pdf);   // Helvetica regular + bold; built into pdf-lib

  drawCoverPage(pdf, fonts, scene, library, project, panels);
  for (const panel of panels) {
    drawPanelPage(pdf, fonts, panel, scene, library, project);
  }
  drawSummaryPage(pdf, fonts, scene, library, project, panels);

  const bytes = await pdf.save();
  return new Blob([bytes], { type: 'application/pdf' });
}
```

`drawPanelPage` is the bulk of the work. The geometry rendering helper `drawPanelElevation(page, panel, scene, region)` projects each member onto the 2D wall plane (panel-local coordinates from §6.3), scales to fit the region, and emits filled rectangles via `page.drawRectangle({ x, y, width, height, color, borderColor, borderWidth })`. Service holes use `page.drawCircle(...)`. Dimensions are line + text combinations using `page.drawLine(...)` and `page.drawText(...)`.

The geometry rendering does **not** re-import the DXF or re-render the Three.js scene. It walks `useScene` directly and projects member endpoints into 2D the same way the DXF exporter does. This keeps the PDF and DXF visually consistent — same layout, same dimensions, same labels — without coupling the two exporters' code.

### Edge cases

**Panel BOM exceeds 30 rows.** Sub-paginate. Page 3 becomes 3a (elevation) and 3b (BOM continuation). Page numbering in the cover index reflects the primary page (3); sub-pages are inferred.

**Panel elevation aspect ratio extreme.** A 12 m × 2.7 m panel has a 4.4:1 aspect. Auto-scaling fits it into the 7.5 × 6 region; result is a thin band across the page with white space above and below. Acceptable. If a panel is taller than wide (rare for CFS walls), the same auto-scaling rotates the elevation 90° so its long axis runs across the page — an explicit rotation, with a small "ROTATED 90°" annotation in the top-right of the elevation region.

**Empty scene.** Cover page renders with zero panels in the index, summary page renders with empty tables and a note "No CFS panels in this project." Per-panel pages: zero. Total PDF: 2 pages. Useful when the user wants to verify the export pipeline before populating the scene.

**Missing or invalid section reference.** Preflight catches this case. If preflight is bypassed, the affected member's outline renders as a hatched red rectangle and the BOM mini-table row reads `[UNRESOLVED]` per §6.1.

**Project metadata with embedded fonts.** `pdf-lib` does not embed custom fonts in v1; we use built-in Helvetica. Non-Latin characters in project name fall back to placeholder glyphs. v2 may bundle a Unicode font (Noto Sans) at the cost of a few hundred KB per export; for v1 the Latin-only path is a documented constraint.

### What this exporter must not touch

- Anything other than `member.shippingMark`.
- The 3D scene or registry geometry.
- `useCFS`.

### Test cases

| Name | Input | Expected | Rule verified |
|---|---|---|---|
| PDF-01 | Single-panel project | 3 pages: cover, 1 panel page, summary | §6.4 page structure |
| PDF-02 | 5-panel project | 7 pages | §6.4 |
| PDF-03 | Per-panel weight on title block matches `cachedWeight_kg` | Match within 0.01 kg | §6.4 title block |
| PDF-04 | Index page lists every panel with correct page number | Linkage matches | §6.4 cover |
| PDF-05 | Service holes drawn at correct positions on elevation | Visual inspection | §6.4 elevation |
| PDF-06 | 35-row panel BOM | Sub-paginated to 3a + 3b | §6.4 sub-page edge case |
| PDF-07 | Open in Preview, Acrobat, Chrome PDF viewer | All render without warning | manual verification |
| PDF-08 | Imperial project | Dimensions in feet-and-inches; weights in kg + lb | §6.0 units |
| PDF-09 | Total weight on summary equals BOM totals | Match within 0.01 kg | §6.7 invariant |
| PDF-10 | Two consecutive exports | Byte-identical PDFs except for embedded timestamp | §6.0 stable order |

### Performance budget

For a 100-panel project: under 30 seconds. Page-by-page, pdf-lib's path emission is the dominant cost; pages are independent and could parallelize via Web Workers in a v2 optimization. Output PDF size: roughly 50 KB per panel page, so a 100-panel PDF is ~5 MB — within email-attachable range.

## 6.5 `JSONExporter` and `JSONImporter` — Project round-trip

The persistence and portability deliverable. Export the entire CFS-aware scene to a JSON file the user can save outside the browser; import it back to reconstruct the scene.

### Purpose

The other four exporters produce derived artifacts — files for downstream consumers. JSON round-trip is different: it is the **scene itself**, serialized so the user can save, share, version-control, or migrate their work. It is the artifact that closes the loop from §2.6's persistence story to a real, portable file. Every other exporter's output can be regenerated from this one file.

### Library choice

**Native `JSON.parse` and `JSON.stringify` plus the section-3 Zod schemas.**

JSON is in the standard library; nothing more is needed. The Zod schemas are the validator. This is the only exporter in section 6 with no third-party library, and that's deliberate: every dependency on the round-trip path is a future migration risk.

### Inputs

```typescript
function exportJSON(scene: SceneState, project: CFSProject): Blob;
function importJSON(json: unknown, useScene: SceneStore, useCFS: CFSStore): ImportResult;

type ImportResult = {
  status: 'success' | 'partial' | 'failure';
  messages: string[];
  importedNodeCount: number;
  rejectedNodeCount: number;
};
```

The importer is the only function in this section that writes to the scene. Per §4.0, scene mutations go through `useScene` mutators. The importer is the inverse of an exporter — it takes a file and produces nodes — and it lives in the same module (`packages/cfs/src/exporters/json.ts`) for symmetry.

### Output specification

A single `.json` file with the following top-level shape, matching §3.11's worked example:

```typescript
type AACSteelSceneFile = {
  schemaVersion: '1.0.0';
  generator: {
    tool: 'AACSteel-Designer';
    version: string;          // package version at export time
    exportedAt: string;       // ISO 8601 timestamp
  };
  pascalNodes: Record<string, PascalNode>;   // every non-CFS Pascal node
  cfsNodes:    Record<string, CFSNode>;      // every cfs_* node, keyed by id
};
```

The split between `pascalNodes` and `cfsNodes` is driven by the `cfs_` prefix on the type discriminator (§0.5). Pascal nodes have no prefix; CFS nodes do. Two separate dictionaries make the boundary explicit in the file (a reader can grep `cfsNodes` to find everything we own) and make incremental migrations easier (a v2 schema change to a CFS node type does not affect the Pascal nodes section).

The JSON is pretty-printed with 2-space indentation. File size is dominated by node count; a 5,000-member scene is roughly 2 MB, which gzips to ~150 KB on a server but is offered uncompressed for v1. v2 may add `.json.gz` as an alternative download.

### Importer protocol

The importer runs in this order:

1. **Parse and validate the file structure.** `JSON.parse` followed by a top-level Zod schema check. Failure → `status: 'failure'`, file is unchanged in the scene, message names the parse error.

2. **Check schema version.** If `schemaVersion !== '1.0.0'`, dispatch to the migration table:

   ```typescript
   const migrations: Record<string, (file: unknown) => AACSteelSceneFile> = {
     // v2 migrations populate this table; v1 has none
   };
   ```

   If no migration exists for the file's version, `status: 'failure'` with message `cannot import schema version X; current is 1.0.0`. v1 ships with an empty migrations table.

3. **Singleton check on `CFSProject`.** Walk `cfsNodes` for `type: 'cfs_project'`. Reject with `status: 'failure'` if more than one is present. Per §4.4.

4. **Validate every node.** For each entry in `pascalNodes` and `cfsNodes`, run the appropriate Zod schema's `.parse()`. Collect parse errors per node. A node that fails validation is **rejected**: omitted from the import, its id added to the rejection list. Rejection of one node does not abort the import.

5. **Build the import set.** The set of nodes that passed validation. Transitively check parent references: a node whose `parentId` references a rejected (or absent) node is itself rejected, recursively. This produces a parent-clean set.

6. **Library guard.** Walk every `CFSMember` in the import set and verify `sectionId` resolves in the currently-loaded `useCFS.memberLibraries`. Members with unresolved sections are **kept** (not rejected) but flagged for the inspector to surface. Per §4.4 "members whose `sectionId` resolves in any loaded library that contains a matching section render normally; if none does, those members render in a fallback 'unresolved section' state."

7. **Apply via `useScene` mutators.** Inside one `withBatchedUndo('import scene')` (§4.9), insert every node. Use a bulk insertion helper if Pascal provides one, otherwise iterate with `createNode`. Order: parents before children, top-down through the parent chain.

8. **Sync `useCFS`.** Per §4.4: `isCFSMode = (cfsProject !== null)`; `setActiveLibrary(project.activeLibraryId)` if that library is loaded.

9. **Return `ImportResult`.** `'success'` if no rejections; `'partial'` if any nodes were rejected but the project is otherwise loadable; `'failure'` if the import did not produce a usable scene.

### Algorithm — exporter

```typescript
function exportJSON(scene, project): Blob {
  preflight(scene, library, project, { requirePanels: false });

  const allNodes = scene.nodes;
  const pascalNodes: Record<string, PascalNode> = {};
  const cfsNodes:    Record<string, CFSNode> = {};

  for (const [id, node] of Object.entries(allNodes)) {
    if (typeof node.type === 'string' && node.type.startsWith('cfs_')) {
      cfsNodes[id] = node as CFSNode;
    } else {
      pascalNodes[id] = node as PascalNode;
    }
  }

  const file: AACSteelSceneFile = {
    schemaVersion: '1.0.0',
    generator: {
      tool: 'AACSteel-Designer',
      version: PACKAGE_VERSION,
      exportedAt: nowIso(),
    },
    pascalNodes,
    cfsNodes,
  };

  const text = JSON.stringify(file, null, 2);
  return new Blob([text], { type: 'application/json' });
}
```

The exporter does **not** validate before writing. The scene is assumed to be well-formed because every mutator goes through `Schema.parse`. If a corrupt node somehow exists, it is exported as-is and the importer will reject it on round-trip. This is the right behavior: don't lose data on the way out, validate on the way in.

### Algorithm — importer

```typescript
function importJSON(raw: unknown, useScene, useCFS): ImportResult {
  const messages: string[] = [];
  let parsed: AACSteelSceneFile;

  try {
    parsed = AACSteelSceneFileSchema.parse(raw);
  } catch (err) {
    return { status: 'failure', messages: [zodError(err)], importedNodeCount: 0, rejectedNodeCount: 0 };
  }

  // 2. Schema version
  if (parsed.schemaVersion !== '1.0.0') {
    const migrate = migrations[parsed.schemaVersion];
    if (!migrate) return failure(`unsupported schema ${parsed.schemaVersion}`);
    parsed = migrate(parsed);
  }

  // 3. Singleton
  const projects = Object.values(parsed.cfsNodes).filter(n => n.type === 'cfs_project');
  if (projects.length > 1) return failure('multiple cfs_project nodes in file');

  // 4. Per-node validation
  const validated = new Map<string, Node>();
  const rejected = new Set<string>();
  for (const [id, node] of [...Object.entries(parsed.pascalNodes), ...Object.entries(parsed.cfsNodes)]) {
    try {
      const schema = schemaFor(node.type);
      validated.set(id, schema.parse(node));
    } catch (err) {
      rejected.add(id);
      messages.push(`node ${id}: ${zodError(err)}`);
    }
  }

  // 5. Parent-chain transitive rejection
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, node] of validated.entries()) {
      if (node.parentId && !validated.has(node.parentId)) {
        const isPascalRoot = isPascalSiteOrBuilding(node);
        if (!isPascalRoot) {
          validated.delete(id);
          rejected.add(id);
          messages.push(`node ${id}: parent ${node.parentId} missing or rejected`);
          changed = true;
        }
      }
    }
  }

  // 6. Library guard
  const loadedLibs = useCFS.getState().memberLibraries;
  const allSections = Object.values(loadedLibs).flatMap(l => l.sections);
  for (const node of validated.values()) {
    if (node.type === 'cfs_member') {
      const found = allSections.find(s => s.id === node.sectionId);
      if (!found) messages.push(`member ${node.id}: section ${node.sectionId} not loaded`);
    }
  }

  // 7. Apply
  withBatchedUndo('import scene', () => {
    const sorted = topologicalSortByParent([...validated.values()]);
    for (const node of sorted) useScene.getState().createNode(node, node.parentId);
  });

  // 8. useCFS sync
  const project = projects[0] ?? null;
  if (project) {
    useCFS.getState().setCFSMode(true);
    if (loadedLibs[project.activeLibraryId]) {
      useCFS.getState().setActiveLibrary(project.activeLibraryId);
    }
  }

  return {
    status: rejected.size === 0 ? 'success' : 'partial',
    messages,
    importedNodeCount: validated.size,
    rejectedNodeCount: rejected.size,
  };
}
```

### Edge cases

**Pure-Pascal scene file.** No `cfs_*` nodes. `cfsNodes: {}`. Importer succeeds; `isCFSMode` left as-is per §4.4 (a scene without a `CFSProject` does not flip the toggle). The user can toggle CFS mode on after import to start adding framing.

**File from a future v2 with a known migration.** Migration runs (step 2). After migration, the file is structurally a v1 file and the rest of the import proceeds normally. Migrations are pure functions; they do not call into `useScene`.

**File from a future v2 with no known migration.** Hard fail with a clear message. The user is told to upgrade their tool.

**File with two `CFSProject` nodes.** Hard fail per §4.4 singleton invariant.

**File with a member referencing a section not in any loaded library.** Member is kept; flagged for the inspector. The fallback render state from §4.4 applies. The user can either load a library that contains the section, or update the project's active library, or accept the fallback rendering.

**File with circular parent references.** The topological sort in step 7 detects cycles and rejects every node in the cycle with a message naming the cycle members. This is a corruption case; clean exports cannot produce one.

**Concurrent edits during import.** The importer wraps every mutation in one batched-undo step (§4.9). If the user happens to be editing the scene while the file is parsing, those edits are undoable independently of the import. This is the correct behavior — the import is one user action.

**Very large file (>50 MB).** The browser can stall on `JSON.parse`. v1 accepts the stall; v2 may add a streaming parser. The 5,000-member target scene is well under this limit.

### Round-trip invariants

These properties must hold for any clean export-import cycle. They are added to `packages/cfs/src/exporters/json-invariants.ts` as a self-test that runs on save in development.

1. **Node count preserved.** Export-import-export produces the same node count.
2. **Node ids preserved.** Every imported node's id matches the exported id; no renumbering.
3. **Parent links preserved.** Every imported node's `parentId` matches.
4. **Schema-validated fields preserved.** Every field that passes Zod validation is bit-identical post-import. Floating-point values may have rounding-trip differences in the 15th decimal place; we accept that.
5. **`metadata` preserved.** The one `.passthrough()` field on `CFSProject` round-trips arbitrary keys without loss (§3.2).
6. **Compliance verdicts preserved.** `CFSServiceHole.compliance` round-trips per §3.8 design decision; the importer does not re-validate.
7. **Cached aggregates preserved.** `CFSWallFraming.cachedTotalWeight_kg`, `CFSPanel.cachedWeight_kg`, `cachedMemberCount` round-trip. They are denormalized; importer trusts them; the next dirty pass updates them if they drift from the new computation.
8. **`generatedMemberIds` preserved.** Opening's back-pointers to its framing members survive (§3.6).

### What this exporter must not touch

- The exporter writes nothing to the scene. The importer writes through `useScene.createNode` only and through `useCFS` setters; never directly to either store's state.

### Test cases

| Name | Input | Expected | Rule verified |
|---|---|---|---|
| JSON-01 | Empty CFS scene | Round-trip preserves node count = 0 (no `CFSProject` yet) | §6.5 round-trip |
| JSON-02 | Canonical wall scene | Export, import in fresh app, every member id matches | §6.5 invariant 2 |
| JSON-03 | Multi-panel scene | Round-trip preserves panel structure including `panelId` on every member | §6.5 invariant 4 |
| JSON-04 | Service holes with mixed compliance | Verdicts identical post-import; no re-validation | §3.8 |
| JSON-05 | Pascal-only scene file | Imports successfully; `isCFSMode` unchanged | §6.5 edge case |
| JSON-06 | File with one rejected node (corrupt schema) | `status: 'partial'`; rest of scene loads; messages name the node | §6.5 step 4 |
| JSON-07 | File with two `cfs_project` nodes | `status: 'failure'`; nothing imported | §4.4 singleton |
| JSON-08 | File with future schemaVersion '2.0.0' and no migration | `status: 'failure'`; clear message | §6.5 step 2 |
| JSON-09 | File with member referencing unknown section | `status: 'partial'`; member loaded with fallback render flag | §6.5 step 6 |
| JSON-10 | Round-trip 1000 times | Final file byte-identical to first export (timestamps excluded) | §6.5 invariants |
| JSON-11 | Import mid-edit | Existing scene replaced; one undo step reverts the entire import | §4.9 |
| JSON-12 | Export of scene with `metadata: { custom: { nested: { key: 'value' } } }` | Round-trips with deep nesting intact | §3.2 metadata passthrough |

### Performance budget

For a 5,000-member scene: under 2 seconds export, under 5 seconds import. Export is mostly `JSON.stringify`. Import is dominated by the Zod validation pass; if profiling shows it matters, a fast-path "validate-on-bulk" mode that defers per-node `parse` until after coarse structural checks can shave 30%.

## 6.6 File-naming and download trigger

A small subsection because the rules apply uniformly across every exporter, but consequential because they are user-facing.

### File names

Per §6.0, the pattern is `{projectName}-{kind}.{ext}`:

| Exporter | Kind | Extension |
|---|---|---|
| `BOMExporter` | `BOM` | `xlsx` |
| `CutListExporter` | `CutList` | `csv` |
| `DXFExporter` | `Panels` | `zip` |
| `ShopDrawingExporter` | `ShopDrawings` | `pdf` |
| `JSONExporter` | `Scene` | `json` |

`projectName` is `CFSProject.name` slugified per `packages/cfs/src/lib/slugify.ts`:

```typescript
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    || 'project';
}
```

The 60-character cap is to keep total filenames under common filesystem limits (255 chars) with safe headroom for the kind suffix and extension. Empty or all-special-character names fall back to `project`.

### Download trigger

The same helper is used by every exporter:

```typescript
// packages/cfs/src/lib/download.ts

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a tick so the download has time to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

This works in every browser AACSteel-Designer targets (Chrome, Edge, Firefox, Safari recent). The `setTimeout` revoke is a known browser quirk: revoking immediately can cancel the download in Safari.

### Why client-side

Two reasons:

1. **Privacy.** Project data never leaves the user's machine. CFS detailing involves contractual project information that customers may not want sent to a third-party server.
2. **Deployment simplicity.** v1 has no backend. The app is a static bundle; a user can self-host it on a file server, behind a corporate VPN, or run it offline.

The performance budgets in 6.1–6.5 are written for client-side execution. The largest output (a 100-panel PDF) takes 30 seconds; the user sees a progress indicator. Server-side rendering would be faster but costs the privacy and deployment story.

## 6.7 Cross-exporter invariants

Properties that must hold across multiple exports of the same scene. These are the integration tests that catch drift between exporters — if the BOM says total weight is 1850 kg and the cut list says 1920 kg, one of them is wrong.

The invariants are checked by `packages/cfs/src/exporters/cross-invariants.test.ts` against a reference scene fixture.

1. **Weight agreement.** The sum of `weight_kg` across all rows of the cut list equals the sum of `Total weight (kg)` on the BOM totals tab equals the sum of `panel.cachedWeight_kg` across all panels equals the value on the PDF summary page. All four within 0.01 kg.

2. **Member count agreement.** The cut list row count equals the sum of (panel BOM tabs' physical-member rows, before built-up expansion) equals the sum of `panel.cachedMemberCount` equals the per-panel member count on each PDF panel page.

3. **Length total agreement.** The sum of `Length (mm)` across all cut-list rows equals the sum of `Length (mm) × Quantity` on the BOM totals tab. No rounding tolerance — both are computed from the same `cfsMemberLength_mm` rounded to integer mm.

4. **Per-panel agreement.** For each panel: the cut list rows with that panel's label sum to the panel's `cachedWeight_kg`. The BOM tab for that panel's totals row matches. The PDF panel page's title block weight matches.

5. **Round-trip stability.** Export JSON, re-import, re-export every other format: the byte-for-byte output of BOM, cut list, DXF zip, and PDF is identical to the pre-round-trip exports (excluding embedded timestamps).

6. **Built-up expansion consistency.** For every header member of type `box`: the BOM has 4 rows for it (2 C + 2 track), the cut list has 1 row, the DXF has 1 outline, the PDF panel page has 1 elevation rectangle and 4 rows in the per-panel BOM mini-table.

7. **Shipping mark uniqueness.** Across all exporters: every shipping mark appears in exactly one panel's BOM tab, exactly one cut list row, exactly one DXF entity (with one MTEXT label), and exactly one PDF panel-page member. Marks are unique scene-wide.

8. **Stable order across re-runs.** Two consecutive exports of an unchanged scene produce identical files (excluding timestamps). The §6.0 stable-order rules guarantee this; this invariant is the runtime check.

These eight invariants together mean: if the user exports the BOM, then exports the cut list, then exports the DXF, the three files describe the same project. They cannot disagree without one of them being wrong, and the test suite catches it before the user does.

---

## Open items raised by spec slice E

Items surfaced while writing section 6. They are listed here for the appendix, to be resolved in the indicated slice.

1. **Built-up header schema vs mapping table.** §6.1's mapping table works for v1, but does not give the engineering analysis of slice 12 the per-component members it needs to compute load distribution within a built-up header. Spec slice G should either (a) document that slice 12 expands headers via the same mapping table at analysis time, accepting the same approximation as the BOM, or (b) revisit the §3.6 schema and add `headerComponents: CFSMemberId[]` so headers are first-class multi-piece assemblies. The decision belongs to the v2 planning, not v1.

2. **Proprietary header components.** The `proprietary` entry in `HEADER_COMPONENTS` falls back to a single stud-section row with a verification note. Real proprietary systems (SCAFCO Sigma, ClarkDietrich Steeler) have specific component patterns that vendors publish. Spec slice G should consider whether the `CFSMemberLibrary` schema should grow a `proprietaryHeaderRecipes` field that vendors populate, or whether v2 ships per-vendor library JSONs that include the recipes.

3. **A4 / metric paper sizes for PDF.** §6.4 hardcodes Letter. Spec slice G should add a `paperSize: 'letter' | 'a4'` field to `CFSProjectSettings`, default `letter` for `units: imperial` and `a4` for `units: metric`. Build slice 9 may implement; if not, v2.

4. **Fastener schedule defaults.** §6.3 and §6.4 ship with hardcoded fastener defaults (`#10 self-drilling, 2 per joint`). These are reasonable for v1 but are not domain-validated. Build slice 9 should confirm against AISI S240 and the relevant fastener-manufacturer guidelines; the defaults move into a constants file (`packages/cfs/src/lib/fastener-defaults.ts`) so they can be tuned without touching exporter code.

5. **Per-building exports.** §6.0 commits to scene-wide exports for v1. Real projects with multiple buildings will probably want per-building outputs. v2 spec planning should pick the right granularity — separate files per building, separate sheets per building within one file, or a project-level checkbox at export time.

6. **DXF dimension entity quality.** §6.3 emits DIMENSION entities trusting `@tarikjabiri/dxf` to render them correctly across CAD tools. Library quality varies by entity type; build slice 8 must verify in LibreCAD, AutoCAD, and BricsCAD that dimensions render with arrows and text, not as raw lines. If they don't, the workaround is to emit dimensions as LINE + TEXT primitives and skip the DIMENSION entity. Decision belongs in build slice 8's verification pass.

7. **CSV-vs-papaparse for v2.** §6.2 ships hand-rolled CSV. v2's library-importing-from-CSV use case (vendor catalogs in CSV) needs a real parser; papaparse is the right pick at that point. Spec slice G can note that the writer and parser will live in the same module then.

8. **Streaming JSON parsing for large files.** §6.5 accepts a parse stall on >50 MB files. Real-world CFS projects can exceed this in v2 (a 1000-member commercial building). Streaming JSON via a library like `clarinet` or via `JSONStream` is the v2 path. Recorded for v2 planning.

9. **Compression on JSON download.** §6.5 outputs uncompressed JSON. A 2 MB file is trivially gzippable to ~150 KB; offering `.json.gz` as an alternative is a half-day's work. Deferred to v2 or to a v1 polish pass at build slice 9's discretion.

---

*End of output for spec slice E — exporters. Section 6 is complete. Section 7 (UI contract) and the appendix sweep are produced by spec slices F and G.*
