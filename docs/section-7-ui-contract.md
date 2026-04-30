# 7. UI contract

This section is the contract for everything the user touches. Sections 5 and 6 define what happens when a button is pressed; this section defines where the buttons live, what they are called, what state drives their visibility and disabled-ness, and how the keyboard reaches them.

The audience is Claude Code reading this section at the start of build slices 1 (mode toggle and editor scaffolding), 4 (`OpeningTool` and the opening branch of the inspector), 6 (`ServiceHoleTool` and compliance badges), 7 (`PanelBreakTool` and panel inspector), 8 (export menu wiring), and 9 (shortcuts pass and polish). Each of those slices needs to find a complete, unambiguous placement and interaction contract here so it does not re-decide UX in chat.

> Note on terminology and architecture: this section sits on top of sections 0–6. Vocabulary is from §0.4. The package vs. editor split is from §0.3. The store layout (`useScene`, `useViewer`, `useEditor`, `useCFS`) is from §2.2 and §4. System ownership of nodes is from §5.6. Exporter behavior is from §6. If anything here contradicts sections 0–6, sections 0–6 win and this section must be reconciled in spec slice G.

The non-goals of this section, called out so we do not waste tokens here:

- Section 7 does not specify visual design beyond the role-color table fixed in §1.2 and §6.3 and the badge-color rule in §7.7. Tailwind class lists, exact spacing values, font weights, and border radii are build-slice concerns and live in code.
- Section 7 does not redefine state shapes. Every field referenced here exists in §3 (schemas) or §4 (stores).
- Section 7 does not redefine system behavior. Where a tool emits a mutation, this section names the mutation; the system that consumes it is in §5.

## 7.0 UI contract conventions

### Where editor-side code lives

Per §2.9, every UI surface produced by this section lives under `apps/editor/cfs/`. The package `@pascal-app/cfs` is UI-free; nothing here adds files to `packages/cfs/src/`.

The folder map for this section:

```
apps/editor/cfs/
  components/
    toolbar/
      ModeToggle.tsx              # §7.1
      CFSToolbarGroup.tsx         # §7.2
      ExportMenu.tsx              # §7.5
    tools/
      OpeningTool.tsx             # §7.3.1
      ServiceHoleTool.tsx         # §7.3.2
      PanelBreakTool.tsx          # §7.3.3
    panels/
      InspectorPanel.tsx          # §7.4 root, dispatches to body components
      bodies/
        ProjectSettingsBody.tsx   # §7.4.2
        WallFramingBody.tsx       # §7.4.3
        OpeningBody.tsx           # §7.4.4
        PanelBody.tsx             # §7.4.5
        MemberBody.tsx            # §7.4.6
        ServiceHoleBody.tsx       # §7.4.7
      ShortcutsPanel.tsx          # §7.6
      StatusBanner.tsx            # §7.7
  hooks/
    use-cfs-selection.ts          # selection bridge §7.4.1
    use-cfs-shortcuts.ts          # global shortcut binding §7.6
    use-export.ts                 # export trigger + progress §7.5
  lib/
    role-display.ts               # role enum -> display label
    badge-style.ts                # compliance verdict -> badge variant
```

Renderers (`CFSMemberRenderer`, etc.) are registered separately per §2.9 and are not the concern of this section.

### Mount points

Every UI component in this section mounts inside the editor application tree, gated on `useCFS.isCFSMode`. Three mount points:

| Mount point | What mounts there | Gated on |
|---|---|---|
| Top toolbar | `ModeToggle`, `CFSToolbarGroup` (which contains the three tool buttons), `ExportMenu` | `ModeToggle` always; the rest only when `isCFSMode === true` |
| Right sidebar | `InspectorPanel` (CFS) | `isCFSMode === true` |
| Document root | Tool overlay surfaces (cursor pointers, drag rectangles, ghost previews); `StatusBanner` for global errors | `isCFSMode === true`, plus the relevant tool being active |

Pascal's existing inspector panel is hidden while `isCFSMode === true`. The CFS inspector takes the same screen position. The architectural-mode inspector returns when the user toggles back. This swap is implemented at the editor level via a conditional render — neither inspector edits the other.

### The headless-systems / interactive-UI rule

Per §5.0, systems return `null` from React render and never own UI. Every interactive surface — every button, every cursor, every input, every menu — is a UI component in `apps/editor/cfs/`. Tools dispatch scene mutations; systems consume them; UI components observe results.

The full dataflow for one user action:

```
User clicks tool → tool emits useScene.createNode(...) inside withBatchedUndo
                → system sees dirty node next frame, runs algorithm
                → system writes through useScene mutators
                → renderer's mesh updates from registry mutation by §5.3
                → inspector observes new field values via Zustand subscription
```

UI never short-circuits any step. UI never reads from the registry. UI never writes to the registry. UI reads from `useScene`, `useViewer`, `useEditor`, `useCFS` and writes through the documented mutators.

### State binding conventions

Every UI component in this section binds to state through the Zustand selector pattern, never via prop drilling from the editor root. Examples used throughout this section:

```ts
const isCFSMode = useCFS(s => s.isCFSMode);
const settings  = useScene(s => getProjectSettings(s));
const selected  = useViewer(s => s.selection);
```

The selector pattern matches Pascal's existing convention and gives us per-field re-render granularity. A component that displays a single number subscribes to that number only; a settings change to an unrelated field does not re-render it.

### User-visible text

Every user-visible string in this section is fixed by the relevant subsection. Build slices may not paraphrase. The fixed strings live in `apps/editor/cfs/lib/strings.ts` as a single export so they are translatable in v2 without touching components.

The reasoning is the same as section 6's commitment to fixed column headers: variation between what the spec promises and what the user sees is a bug, and a one-word change ("Panelize" vs. "Generate Panels") in a button label cascades into every shortcut tooltip, every screenshot, every help string, and every test.

## 7.1 Mode toggle

The single switch that turns the entire CFS subsystem on. Off, the user sees Pascal Editor unchanged. On, every CFS tool, panel, system, and exporter becomes available.

### Placement

Top toolbar, **right side**, separated from Pascal's existing tool group by a vertical divider. The toggle is the first CFS-specific element on the toolbar; everything else in §7.2 sits to the right of it.

The toggle is a two-state segmented control, not a checkbox or a button:

```
┌───────────────┬───────────┐
│ Architectural │  CFS      │
└───────────────┴───────────┘
```

Selected segment is filled; unselected is outlined. Width is fixed; the segment widths do not change with selection. The control is always visible — it is the one CFS surface that does not disappear when CFS mode is off, because the user needs it to turn CFS on.

### Labels

Fixed:

| Segment | Label |
|---|---|
| Off | `Architectural` |
| On | `CFS` |

Tooltip on hover:

| State | Tooltip |
|---|---|
| Off | `Switch to CFS mode for cold-formed steel framing.` |
| On | `Switch back to architectural mode.` |

### State binding

The toggle binds to `useCFS.isCFSMode` with the setter `useCFS.setCFSMode`:

```ts
const isCFSMode = useCFS(s => s.isCFSMode);
const setCFSMode = useCFS(s => s.setCFSMode);
// Architectural segment click:
setCFSMode(false);
// CFS segment click:
setCFSMode(true);
```

`setCFSMode` is not undoable. Per §2.6 and §4, mode is editor-local state on `useCFS`, not scene data on `useScene`. Toggling CFS on or off does not appear in the undo stack. This is intentional: toggling is a navigation action, not a content change.

### Gating semantics

When `isCFSMode === false`:

- The CFS toolbar group (§7.2) is not mounted.
- The CFS inspector (§7.4) is not mounted; Pascal's inspector renders normally.
- The CFS export menu (§7.5) is not mounted.
- Every CFS system (`CFSFramingSystem`, `CFSGeometrySystem`, `CFSServiceHoleSystem`, `CFSPanelizationSystem`) is mounted but early-returns from its `useFrame` body. Per §5.0, systems are gated on `isCFSMode`.
- CFS keyboard shortcuts (§7.6) are not bound.
- Any `CFSMember` mesh in the scene continues to render — geometry was already built — but no new framing is generated and no system reacts to scene changes. Toggling architecture mode is read-only on the CFS data; the user can switch back at any time and pick up exactly where they were.

When `isCFSMode === true`:

- Every gating above flips. The CFS toolbar appears, the inspector appears, systems run, shortcuts bind.
- The first time CFS mode is toggled on in a scene with no `CFSProject`, the `useCFS` initialization runs the empty-state flow described in §7.8.

### First-toggle behavior

The first transition from `false → true` in a session does three things, in order, atomically inside one `withBatchedUndo('enable CFS mode')` step:

1. If no `CFSProject` exists in the scene, create one with `useScene.createNode(...)` populated from `useCFS.defaultProjectSettings`. Per §4.4, `CFSProject` is a singleton; the importer or a previous session may already have created one, in which case this step is skipped.
2. Set `isCFSMode = true`.
3. Hydrate `useCFS.activeLibrary` from the project's `activeLibraryId` if not already set, falling back to SSMA per §4.3.

Steps 1 and 3 are not undoable from the toggle's perspective — they are setup. The undoable artifact is the `CFSProject` node itself; if the user undoes past the toggle action, the toggle returns to `false` and the project node is removed by Zundo, which is the correct behavior.

### Resolution of the spec-slice-A open item

Spec slice A surfaced the question of whether CFS mode should be a fourth value in `useEditor.phase` (composing with `site | structure | furnish`) or a parallel boolean on `useCFS`. v1 commits to the **parallel boolean on `useCFS`** for the reasons recorded in the Execution Plan and §2.2:

- The toggle is a CFS-package concern; living on `useCFS` keeps the package's editor-side coupling local to its own store.
- `useEditor.phase` carries semantics around level visibility, slab editing, and item placement that do not compose cleanly with "draw studs into walls."
- A boolean is reversible at any time; a fourth phase value would force a decision about which Pascal phase the user returns to when CFS mode turns off.

The open item is therefore closed for v1. v2 may revisit if a use case emerges where CFS mode and a Pascal phase need to be active simultaneously in different ways.

## 7.2 Toolbar layout

The complete toolbar contract for both modes. Pascal's portion is unchanged; this section pins the placement of CFS additions and the rules that govern visibility.

### The full toolbar in CFS mode

Left to right, with separators marked `│`:

```
[Pascal architectural tools]  │  [Mode toggle]  │  [CFS tools]  │  [Export ▾]
```

`[Pascal architectural tools]` is whatever Pascal Editor renders in architectural mode — wall, opening, item, level controls. v1 does not modify this group. In CFS mode, Pascal's tools remain visible and active; the user can still draw a wall while in CFS mode, and the framing system reacts to it (§5.1). Disabling Pascal tools in CFS mode is **out of scope** for v1.

`[Mode toggle]` is the segmented control from §7.1. Always visible.

`[CFS tools]` is `CFSToolbarGroup`, mounted only when `isCFSMode === true`. It contains three tool buttons in this order:

| Button | Activates | Shortcut |
|---|---|---|
| Opening | `OpeningTool` (§7.3.1) | `T` |
| Service hole | `ServiceHoleTool` (§7.3.2) | `H` |
| Panel break | `PanelBreakTool` (§7.3.3) | `B` |

A fourth button to the right of the tools, separated by a small spacer:

| Button | Action |
|---|---|
| Panelize | Triggers `runPanelization(framingId)` for the currently selected wall framing, or for every framing in the scene if nothing is selected. Shortcut: `P`. Disabled when no `CFSWallFraming` exists in the scene. |

Panelize is a button rather than a tool because it is a one-shot action, not a modal interaction — there is nothing to click on the canvas after pressing it.

`[Export ▾]` is `ExportMenu` (§7.5), the dropdown trigger. Only visible when `isCFSMode === true`.

### Tool button states

Every tool button has four visual states:

| State | When |
|---|---|
| Inactive | Tool is not active; cursor is default. Hover shows tooltip. |
| Hover | Pointer is over the button; cursor remains default; button highlights subtly. |
| Active | Tool is the current active tool; button is filled. The cursor on the canvas changes per §7.3 specifics. Shortcut text in the tooltip is hidden in active state — the user already knows what they pressed. |
| Disabled | Tool's preconditions are not met. Hover shows the reason. |

Disabled rules per tool:

| Tool | Disabled when | Reason text |
|---|---|---|
| Opening | No `Wall` exists in the scene | `Draw a wall first to place an opening.` |
| Service hole | No `CFSMember` exists in the scene | `Add framing to a wall first to place a service hole.` |
| Panel break | No `CFSWallFraming` with at least one `CFSPanel` exists | `Run Panelize on a wall first.` |
| Panelize | No `CFSWallFraming` exists | `Add framing to a wall first.` |

The disabled rules are observable from `useScene` via small selectors:

```ts
const hasWalls       = useScene(s => Object.values(s.nodes).some(n => n.type === 'wall'));
const hasMembers     = useScene(s => Object.values(s.nodes).some(n => n.type === 'cfs_member'));
const hasFraming     = useScene(s => Object.values(s.nodes).some(n => n.type === 'cfs_wall_framing'));
const hasPanels      = useScene(s => Object.values(s.nodes).some(n => n.type === 'cfs_panel'));
```

These selectors are `O(nodes)` per call but called once per render and memoized; for v1 scene sizes (≤ 10,000 nodes) they are sub-millisecond.

### Tool exclusivity

Only one tool is active at a time, including Pascal's tools. Activating a CFS tool deactivates whatever was active before. The active tool is held on `useEditor.activeTool` (a Pascal-owned field per §2.2), with our additions registered as values:

```ts
type ActiveTool =
  | 'select' | 'wall' | 'opening' | 'item'   // Pascal's existing values
  | 'cfs_opening' | 'cfs_service_hole' | 'cfs_panel_break';   // ours
```

When `isCFSMode` toggles to `false` while a CFS tool is active, `activeTool` resets to `'select'`. This prevents a hidden CFS tool from remaining active and capturing pointer events.

### Escape to deactivate

Pressing `Esc` while any tool is active resets `activeTool` to `'select'`. This includes both Pascal tools and CFS tools. Escape during an in-progress drag or click sequence cancels the drag and emits no scene mutation (§7.3 details per tool).

## 7.3 Tools

Three CFS tools, one subsection each. Every tool follows the same documentation shape:

1. **Activation** — how the tool becomes active.
2. **Cursor and feedback** — what the user sees on the canvas while the tool is active.
3. **Interaction flow** — the click/drag sequence and what mutates when.
4. **Modifier keys** — what `Shift`, `Alt`, `Ctrl`/`Cmd` do.
5. **Cancellation** — what `Esc` and clicking off-target do.
6. **Mutation emitted** — the `withBatchedUndo` label and the mutator calls that result.
7. **Inspector behavior** — what the inspector shows while the tool is active.

The three tools share a `CFSToolBase` hook (`apps/editor/cfs/hooks/use-cfs-tool.ts`) that handles activation, cursor styling, and `Esc` listening. Each tool implements its own click/drag handlers on top.

### 7.3.1 `OpeningTool`

Build slice 4 ships this. The tool that places `CFSOpening` nodes on walls and triggers `CFSFramingSystem` to generate kings, jambs, header, sill, and cripples (§5.1 steps 5–7).

#### Activation

| Source | Effect |
|---|---|
| Toolbar button | `useEditor.activeTool = 'cfs_opening'` |
| Shortcut `T` | Same |
| Programmatic (deselection of all and direct call from a future macro) | Same |

#### Cursor and feedback

The canvas cursor switches to a crosshair while `cfs_opening` is the active tool. On hover over a Pascal `Wall`, the wall's outline highlights in the role-colored "selectable wall" style. On hover over anything else (slab, item, empty space, another tool's surface), the cursor remains crosshair but no highlight appears and the click does nothing.

While dragging to size the opening (see flow), a ghost rectangle in the wall's local coordinate system shows the in-progress rough opening, with live dimensions text near the cursor in the project's units.

#### Interaction flow

The flow is a click-drag-release pattern, modeled after Pascal's existing wall tool to preserve muscle memory:

1. **Hover.** User moves the cursor onto a wall. Wall highlights.
2. **Click and hold.** User presses pointer down on the wall. The position becomes the rough opening's start corner, snapped to the wall's local x-axis at the click point and projected to y = `clickY`. A ghost rectangle starts forming.
3. **Drag.** As the user moves the cursor along the wall, the rectangle grows. Width tracks horizontal cursor movement along the wall's x. Height tracks vertical cursor movement, clamped to the wall's height.
4. **Release.** The pointer is released. A modal-less popover appears anchored to the rectangle, asking the user to choose `Door` or `Window`. The popover has two buttons; until the user picks, the rectangle is shown as a dashed outline (committed but type-pending).
5. **Type chosen.** On click of `Door` or `Window`, the popover closes; a `CFSOpening` node is created with `openingType` set, `roughDimensions` set from the rectangle, `positionAlongWall_mm` set from the start corner, `sillHeight_mm` set to the rectangle's bottom for windows or `null` for doors. The inspector switches to the opening body (§7.4.4).

If the user releases the pointer with the rectangle smaller than 50 mm on either axis, no opening is created and a transient toast reads `Opening too small. Drag wider to place.` Per §7.7, transient toasts auto-dismiss after 4 seconds.

#### Modifier keys

| Modifier | Effect |
|---|---|
| `Shift` while dragging | Snaps the rectangle's edges to multiples of 50 mm in the wall's local x. Vertical y is unsnapped. |
| `Alt` while dragging | Constrains the rectangle to a standard door size (900 × 2100 mm metric, 36 × 84 in imperial); only the start position tracks the cursor, the size is fixed. Releasing creates a door directly without the type popover. |

`Ctrl`/`Cmd` is not bound during dragging; it is reserved for selection extension in the inspector.

#### Cancellation

| Action | Effect |
|---|---|
| `Esc` during drag (before release) | Cancels the drag; no rectangle, no node created. |
| `Esc` during type popover | Closes the popover; no node created. The committed dashed rectangle disappears. |
| Click off-target during type popover | Treated as `Esc`. |

#### Mutation emitted

```ts
withBatchedUndo('place opening', () => {
  const opening = CFSOpeningSchema.parse({
    type: 'cfs_opening',
    parentId: framingId,
    openingType,                        // 'door' | 'window'
    positionAlongWall_mm: startX_mm,
    roughDimensions: { width_mm, height_mm },
    sillHeight_mm: openingType === 'window' ? bottomY_mm : null,
    headerTypeOverride: null,
    generatedMemberIds: [],
  });
  useScene.getState().createNode(opening, framingId);
});
```

`framingId` is the `CFSWallFraming` child of the clicked Pascal `Wall`. If no framing exists yet (the user was in CFS mode but the wall had not yet been picked up by `CFSFramingSystem`), the tool waits one frame for the framing to be auto-created (§5.1 dirty trigger on Pascal `Wall`) before placing the opening. This wait is invisible to the user; the framing is always present by the time the click resolves.

#### Inspector behavior

While the tool is active and no opening has been placed yet, the inspector shows a hint body: `Click on a wall and drag to size an opening, then choose Door or Window.` Per §7.8 empty states.

After an opening is placed, the inspector switches to the opening body (§7.4.4) with the new opening selected. The tool remains active for further placements; the user must press `Esc` or click another tool to deactivate.

### 7.3.2 `ServiceHoleTool`

Build slice 6 ships this. Places `CFSServiceHole` nodes on members and triggers `CFSServiceHoleSystem` to validate them (§5.4).

#### Activation

| Source | Effect |
|---|---|
| Toolbar button | `useEditor.activeTool = 'cfs_service_hole'` |
| Shortcut `H` | Same |

#### Cursor and feedback

Cursor is a small ring shape suggesting "place hole here." On hover over a `CFSMember`, the member highlights in its role color brightened, and a ghost circle appears at the projected position along the member's web with the current diameter setting. The ghost circle is colored green if the hypothetical hole would be compliant (R1–R4 from §5.4) and red if it would not, with the same logic as the actual badge. This is real-time validation on hover, before any click.

The ghost circle's diameter is the user's last-used diameter, defaulted to 38 mm (or 1.5 in imperial) — the typical SSMA pre-punch size. The diameter is shown as a small label at the cursor.

#### Interaction flow

The simplest of the three tools — a single click:

1. **Hover.** User moves cursor onto a member. Member highlights; ghost circle appears.
2. **Click.** A `CFSServiceHole` is created at the projected position with the current diameter.
3. **Validation runs next frame.** The hole's badge appears in the inspector with the verdict.

Click on empty space, on a wall, on a slab, on anything that is not a `CFSMember`: nothing happens; no toast, no error.

#### Modifier keys

| Modifier | Effect |
|---|---|
| Mouse wheel scroll while tool is active | Adjusts the ghost circle's diameter in 5 mm increments (or 0.25 in imperial), clamped to a minimum of 12 mm and a maximum equal to the member's web depth. The new value becomes the user's last-used diameter for subsequent placements. |
| `Shift` while clicking | Forces the hole's `shape` field to `'oblong'` (per §3.8). The default is `'round'`. The oblong's length is the diameter setting; the width is 38 mm fixed for v1, matching SSMA pattern conventions. |
| `Alt` while hovering | Snaps the position along the member to the nearest multiple of 50 mm. Useful for aligning service holes to mechanical chase grids. |

#### Cancellation

| Action | Effect |
|---|---|
| `Esc` | Deactivates the tool; resets `activeTool` to `'select'`. |
| Click off-target | No mutation; tool remains active. |

There is no in-progress drag to cancel — service hole placement is atomic.

#### Mutation emitted

```ts
withBatchedUndo('place service hole', () => {
  const hole = CFSServiceHoleSchema.parse({
    type: 'cfs_service_hole',
    parentId: memberId,
    positionAlongMember_mm,
    shape,                              // 'round' or 'oblong'
    diameter_mm,
    oblongLength_mm: shape === 'oblong' ? diameter_mm : null,
    hasStiffener: false,
    compliance: { status: 'unchecked', reasons: [], checkedAt: null },
  });
  useScene.getState().createNode(hole, memberId);
});
```

The initial `compliance.status` is `'unchecked'`; `CFSServiceHoleSystem` overwrites it on the next frame. The inspector renders an `unchecked` badge in gray for one frame, which is invisible to the user.

#### Inspector behavior

While the tool is active and no hole has been placed yet, the inspector body for whatever was previously selected remains visible — the user is often placing multiple holes on the same member and wants to see the running list. After each click, the inspector adds the new hole to the parent member's hole list and flashes the new badge briefly to draw the eye.

### 7.3.3 `PanelBreakTool`

Build slice 7 ships this. Places manual `CFSPanel` break positions (§5.5).

#### Activation

| Source | Effect |
|---|---|
| Toolbar button | `useEditor.activeTool = 'cfs_panel_break'` |
| Shortcut `B` | Same |

The tool is disabled if no `CFSWallFraming` has been panelized yet (no `CFSPanel` exists). Hovering shows the disabled tooltip from §7.2.

#### Cursor and feedback

Cursor is a vertical line shape suggesting "split here." On hover over a wall that has been panelized, a vertical guide line appears along the wall at the projected x position, color-coded:

- **Green** if a manual break at this position would be valid (not in a forbidden zone per §5.5).
- **Red** if the position is inside a forbidden zone (through an opening, within corner clearance, or violates a constraint). Hovering shows a small label naming the violation: `Inside opening`, `Too close to corner`, `Violates max width from previous break`.

The color logic uses `latestNonForbiddenPositionBefore` from §5.5 in dry-run mode — no mutation, just the validity check.

#### Interaction flow

A single click at a green position:

1. **Hover green.** Vertical guide is green.
2. **Click.** A new `CFSPanel` is created with `isManualBreak: true` and a re-panelization runs immediately.
3. **Result visible.** The panel layout updates; affected members reassign `panelId`; the inspector switches to the panel body for the newly created panel.

Click on red: nothing happens. The label remains visible until the user moves to a green position.

#### Modifier keys

| Modifier | Effect |
|---|---|
| `Shift` while hovering | Snaps the guide to the nearest multiple of `studSpacing_mm`. Useful for aligning manual breaks to stud columns. |
| `Alt` while clicking on an existing manual break's guide | Removes that manual break instead of creating a new one. Re-panelization runs and the auto-panelizer takes over that segment. |

#### Cancellation

| Action | Effect |
|---|---|
| `Esc` | Deactivates the tool. |
| Click off any wall | No mutation; tool remains active. |

#### Mutation emitted

The mutation goes through `CFSPanelizationSystem`'s manual-break entry point, not directly:

```ts
withBatchedUndo('place panel break', () => {
  // 1. Create the manual break sentinel panel node first.
  const breakPanel = CFSPanelSchema.parse({
    type: 'cfs_panel',
    parentId: framingId,
    label: 'pending',                   // Re-panelization renames it
    sequenceNumber: -1,                 // Re-panelization renumbers
    isManualBreak: true,
    startAlongWall_mm: clickX_mm,
    endAlongWall_mm: clickX_mm,         // Zero-width sentinel; system splits panels around it
    cachedWeight_kg: 0,
    cachedMemberCount: 0,
  });
  useScene.getState().createNode(breakPanel, framingId);

  // 2. Mark the framing dirty for CFSPanelizationSystem to re-run.
  useScene.getState().dirtyNodes.add(framingId);
});
```

The two-step pattern (sentinel insert plus framing dirty) is what makes panelization re-run with the new manual break in scope. Per §5.5, manual breaks are inviolable; the algorithm will produce a panel layout that respects this break and renumber labels. The sentinel's `label` and `sequenceNumber` are overwritten in the system pass.

#### Inspector behavior

While the tool is active, the inspector shows the parent framing's panel body (§7.4.5) with all current panels listed. After a click, the new panel is highlighted in the list with a brief flash.

## 7.4 Inspector panel

The right-side panel that surfaces every cached aggregate, every editable field, and every validation message produced by sections 3, 5, and 6. The single most information-dense surface in the editor.

### 7.4.1 Layout and selection bridge

The inspector is a column with three regions, top to bottom:

```
┌─────────────────────────────┐
│ Header (40 px)              │  Selection breadcrumb + close button
├─────────────────────────────┤
│ Body                        │  Switches on selection type
│                             │
│ (scrollable)                │
│                             │
├─────────────────────────────┤
│ Footer (32 px, optional)    │  Action buttons relevant to the body
└─────────────────────────────┘
```

The body component is chosen by the selection type, resolved via `use-cfs-selection.ts`:

```ts
type CFSSelectionKind =
  | 'none'
  | 'wall_framing'
  | 'opening'
  | 'panel'
  | 'member'
  | 'service_hole';

function useCFSSelection(): { kind: CFSSelectionKind; nodeId: string | null }
```

The hook reads from `useViewer.selection` (Pascal-owned per §2.2) and joins it against `useScene.nodes` to determine the selected node's CFS-relevant kind. If multiple nodes are selected, the hook returns the kind of the most recently selected node and the body shows a small notice that multi-selection is read-only — editing fields requires single selection. v2 may add multi-edit.

The body-to-kind mapping:

| Selection kind | Body component | Reference |
|---|---|---|
| `none` | `ProjectSettingsBody` | §7.4.2 |
| `wall_framing` | `WallFramingBody` | §7.4.3 |
| `opening` | `OpeningBody` | §7.4.4 |
| `panel` | `PanelBody` | §7.4.5 |
| `member` | `MemberBody` | §7.4.6 |
| `service_hole` | `ServiceHoleBody` | §7.4.7 |

The header shows a breadcrumb of the selection's parent chain: e.g., `Building 1 / Level 1 / Wall 3 / Framing / Opening`. Each segment is clickable and changes the selection to that node, providing easy navigation up the tree.

The footer holds 0 to 3 action buttons. Bodies that don't define footer actions render a 0-height footer.

### 7.4.2 `ProjectSettingsBody` — Nothing selected

Shown when nothing is selected. The catch-all body for project-level configuration. Most users will spend more time here than in any other body, because the project settings drive every other system.

#### Sections

The body is divided into collapsible sections, top to bottom:

| Section | Contents |
|---|---|
| `Project info` | Name, job number, client, schema version (read-only). |
| `Defaults` | Stud section, track section, stud spacing, wall height, default header type. Editable. |
| `Panel constraints` | `panelMaxWidth_mm`, `panelMaxWeight_kg`, corner clearance. Editable. |
| `Units` | `metric` / `imperial` segmented control. |
| `Active library` | Library name + version, read-only. Switcher button. |
| `Statistics` | Scene-wide counts: walls, openings, panels, members, total weight. Read-only. |

#### Field details — Defaults

| Field | Schema source | Control type | Validation |
|---|---|---|---|
| `defaultStudSection` | `CFSProjectSettings.defaultStudSection` | Section dropdown (filtered to studs in active library) | Required; must resolve in active library |
| `defaultTrackSection` | `CFSProjectSettings.defaultTrackSection` | Section dropdown (filtered to tracks) | Required; must resolve |
| `defaultStudSpacing_mm` | `CFSProjectSettings.defaultStudSpacing_mm` | Numeric stepper, increment 50 mm | 200 ≤ x ≤ 1200; warning if not 400 or 600 |
| `wallHeight_mm` | `CFSProjectSettings.wallHeight_mm` | Numeric stepper, increment 100 mm | 1500 ≤ x ≤ 6000 |
| `defaultHeaderType` | `CFSProjectSettings.defaultHeaderType` | Segmented control: Box, L-header, Back-to-back, Single-track, Proprietary | Required |

A change to any of these dirties the relevant `CFSProject.settings`, which per §4.8 propagates to every framing in the scene. The user sees re-layout happen on the next frame; for a 200-wall scene, the propagation is one frame on target hardware (§5.5 budget).

The section dropdowns are populated from `useCFS.activeLibrary.sections`, filtered by style code (`S` for studs, `T` for tracks per §1.3). Each option shows the designation and a small swatch with the cross-section silhouette.

#### Field details — Panel constraints

| Field | Schema source | Control type | Validation |
|---|---|---|---|
| `panelMaxWidth_mm` | `CFSProjectSettings.panelMaxWidth_mm` | Numeric stepper, increment 100 mm | 1500 ≤ x ≤ 12000 |
| `panelMaxWeight_kg` | `CFSProjectSettings.panelMaxWeight_kg` | Numeric stepper, increment 50 kg | 100 ≤ x ≤ 5000 |
| `cornerClearance_mm` | derived: 1 × `defaultStudSpacing_mm` | Read-only display | Computed |

Per §5.5, changing `panelMaxWidth_mm` or `panelMaxWeight_kg` re-runs panelization for every framing that already has panels. The body shows a warning callout above the section if at least one framing has panels: `Changing these will re-panelize N walls.` where N is the count of framings with panels.

#### Field details — Units

The units control is the segmented `Metric` / `Imperial` switch. Changing it does not change stored data — per §0.5, storage is always SI. It changes display format throughout the inspector, the dimensions in tools (live ghost labels), and the units used in the next export.

#### Field details — Active library

Shows the active library's name and version. A `Switch library...` button opens a small modal listing every loaded library with a select control. v1 ships only SSMA, so this modal typically shows one option; the modal is in place for v2 when proprietary libraries can be loaded.

If a library load failed (per §4.3), this section shows the error inline with the offered retry button.

#### Statistics

Read-only counts, computed lazily from `useScene`:

```ts
const stats = useScene(s => ({
  walls:     count(s, 'wall'),
  openings:  count(s, 'cfs_opening'),
  framings:  count(s, 'cfs_wall_framing'),
  panels:    count(s, 'cfs_panel'),
  members:   count(s, 'cfs_member'),
  serviceHoles: count(s, 'cfs_service_hole'),
}));
const totalWeight = useScene(s => sumCachedWeights(s));
```

The total weight is the sum of `framing.cachedTotalWeight_kg` across all framings. Per §6.7 invariants, this matches the BOM totals tab.

#### Footer

| Button | Action | Disabled when |
|---|---|---|
| `Panelize all walls` | Runs panelization on every framing that doesn't already have panels | No framings exist or all already panelized |

### 7.4.3 `WallFramingBody` — Framing or its parent wall selected

Selected when the user clicks a `CFSWallFraming` directly or clicks a Pascal `Wall` whose framing exists. Both select the framing for inspector purposes; the wall remains the geometric selection in the viewer.

#### Sections

| Section | Contents |
|---|---|
| `Wall info` | Length, height, position. Read-only — these come from the Pascal wall. |
| `Framing config` | Override fields for stud section, track section, spacing, header type, wall height. All optional; null means "use project default." |
| `Aggregates` | Member count, total weight, opening count. Read-only. |
| `Members` | Collapsible list of every member on this wall, grouped by role. |
| `Openings` | Collapsible list of every opening on this wall. |
| `Panels` | Collapsible list of panels (if panelized). |

#### Framing config field details

Every field is `<override> ?? <default>` from `CFSProjectSettings`. The control shows the effective value with a subtle `using project default` badge when null, or the override value with a `clear override` button when set:

| Field | Override slot | Effective binding |
|---|---|---|
| `studSection` | `framing.studSectionId` | `framing.studSectionId ?? settings.defaultStudSection` |
| `trackSection` | `framing.trackSectionId` | similarly |
| `studSpacing` | `framing.studSpacing_mm` | similarly |
| `headerType` | `framing.defaultHeaderType` | similarly |
| `wallHeight` | `framing.wallHeight_mm` | similarly |

Changing an override field dirties the framing per §4.8 and triggers `CFSFramingSystem` re-layout next frame.

#### Aggregates

| Display | Source | Notes |
|---|---|---|
| `Member count` | `framing.cachedMemberCount` | Updated by §5.1 step 8 |
| `Total weight` | `framing.cachedTotalWeight_kg` | Imperial mode: shown as kg (X lb) |
| `Opening count` | length of `cfs_opening` children | Computed at render time |

If the framing has an unresolved-section error (per §5.1 step 1 abort), this section shows it as a banner: `Section sec-???? could not be found in the active library.` with a `Switch to default` button that nulls the override.

#### Members list

Grouped by role. Each group is collapsible:

```
▼ Tracks (2)
   P-01-TT1   362T125-54   3600 mm   2.41 kg
   P-01-BT1   362T125-54   3600 mm   2.41 kg
▼ Studs (5)
   ...
▶ Chord studs (2)
▶ Header (1)
▶ Cripples (2)
▶ ...
```

Each row is selectable; clicking switches the inspector to `MemberBody` for that member. The role colors from §1.2 / §6.3 are used as left-border accents on each row.

#### Openings list

```
▶ Door — 900 × 2100 mm at x = 600 mm — Box header
▶ Window — 1200 × 1000 mm at x = 2400 mm, sill 900 mm — L-header
```

Each row clickable to switch to `OpeningBody`.

#### Panels list

Visible only when panels exist. Each panel row shows label, width, weight, member count. Clicking switches to `PanelBody`.

If the framing has not been panelized, this section shows a single button: `Panelize this wall`. Clicking runs `runPanelization(framingId)` per §5.5.

#### Footer

| Button | Action | Disabled when |
|---|---|---|
| `Panelize` | Runs panelization on this framing | Already panelized |
| `Clear all overrides` | Sets every override field to null | No overrides set |
| `Delete framing` | Deletes the framing and cascades all members, openings, panels | Always shown but requires confirm dialog |

### 7.4.4 `OpeningBody` — Opening selected

Shown when a `CFSOpening` is selected.

#### Sections

| Section | Contents |
|---|---|
| `Opening info` | Type (door/window), dimensions, position along wall. Editable. |
| `Header` | Header type override + effective type. Editable. |
| `Window-only` | Sill height. Visible only when `openingType === 'window'`. |
| `Generated framing` | List of king studs, jamb studs, header, sill, sill track, cripples this opening produced. Read-only navigation. |
| `Issues` | Any `flagOpeningInvalid` messages from §5.1 step 5. Visible only when issues exist. |

#### Field details — Opening info

| Field | Source | Control | Validation |
|---|---|---|---|
| `openingType` | `opening.openingType` | Segmented Door/Window | Switching to Door clears `sillHeight_mm`; switching to Window prompts for sill height |
| `roughDimensions.width_mm` | `opening.roughDimensions.width_mm` | Numeric stepper, increment 50 mm | 300 ≤ x ≤ wall length |
| `roughDimensions.height_mm` | similarly | similarly | 300 ≤ x ≤ `wallHeight_mm - sillHeight_mm` for windows; ≤ `wallHeight_mm` for doors |
| `positionAlongWall_mm` | `opening.positionAlongWall_mm` | Numeric stepper, increment 50 mm | 0 ≤ x ≤ wall length − width |

Edit propagation: changes dirty the opening (§4.8), which dirties the parent framing, which re-runs the framing pass next frame. The user sees the opening framing snap to the new position within one frame.

#### Field details — Header

| Field | Source | Control |
|---|---|---|
| `headerTypeOverride` | `opening.headerTypeOverride` | Segmented Box / L-header / Back-to-back / Single-track / Proprietary, with a `Use default` button |

The effective header type is shown as a small label below the control: `Effective: Box (from project default)` or `Effective: L-header (override)`.

#### Field details — Window-only

Visible only when `openingType === 'window'`:

| Field | Source | Control | Validation |
|---|---|---|---|
| `sillHeight_mm` | `opening.sillHeight_mm` | Numeric stepper, increment 50 mm | 100 ≤ x ≤ `wallHeight - height` |

#### Generated framing

Read from `opening.generatedMemberIds`. Each id is resolved to its member; the member's role and shipping mark are displayed. Clicking a row navigates to `MemberBody` for that member.

If `generatedMemberIds` is empty (the opening was just placed and the framing pass has not yet run), this section shows a placeholder: `Framing pending...` for at most one frame.

#### Issues

Driven by `flagOpeningInvalid` (§5.1 step 5). When the opening exceeds wall length or otherwise fails opening-creation rules, the framing system flags the opening; the inspector shows the flag here as a red banner with the reason. Per §5.1, the rest of the wall continues to frame normally; the opening produces no kings/jambs/header until the user fixes it.

#### Footer

| Button | Action | Disabled when |
|---|---|---|
| `Delete opening` | Deletes the opening; framing reverts to plain layout | Never |

### 7.4.5 `PanelBody` — Panel selected

Shown when a `CFSPanel` is selected.

#### Sections

| Section | Contents |
|---|---|
| `Panel info` | Label, sequence number, manual/auto, position along wall, dimensions. |
| `Aggregates` | Member count, weight, member list grouped by role. |
| `Members` | Collapsible list, same structure as `WallFramingBody`'s members list but scoped to this panel. |

#### Panel info

| Field | Source | Editable |
|---|---|---|
| `label` | `panel.label` | No (auto-generated `P-NN`) |
| `sequenceNumber` | `panel.sequenceNumber` | No |
| `isManualBreak` | `panel.isManualBreak` | Indicator only |
| `startAlongWall_mm` | `panel.startAlongWall_mm` | No (driven by panelization or manual break tool) |
| `endAlongWall_mm` | `panel.endAlongWall_mm` | No |
| `width` | `endAlongWall_mm - startAlongWall_mm` | Computed |

#### Aggregates

| Display | Source |
|---|---|
| `Member count` | `panel.cachedMemberCount` |
| `Weight` | `panel.cachedWeight_kg` |

#### Footer

| Button | Action | Disabled when |
|---|---|---|
| `Remove this break` | Deletes this panel as a manual break; re-runs panelization | `isManualBreak === false` (auto-panels can't be removed individually) |

### 7.4.6 `MemberBody` — Member selected

Shown when a `CFSMember` is selected.

#### Sections

| Section | Contents |
|---|---|
| `Member info` | Role, section, length, weight, shipping mark, panel. Read-only except section. |
| `Position` | Start point, end point, orientation. Read-only — driven by §5.1 layout. |
| `Service holes` | List of every hole on this member with compliance badges. |
| `Built-up notes` | Visible only for headers; shows the BOM expansion mapping (§6.1). |

#### Member info

| Field | Source | Editable |
|---|---|---|
| `role` | `member.role` | No (driven by §5.1) |
| `sectionId` | `member.sectionId` | Yes (override; see below) |
| `length` | computed from `start` / `end` | No |
| `weight_kg` | `length * section.linearMass_kgPerM / 1000` | Computed |
| `shippingMark` | `member.shippingMark` | No (computed by §6.0 on first export) |
| `panelId` | `member.panelId` | No (driven by §5.5) |

The section override is per-member and is rare in v1 — most users let the framing's defaults drive sections. The override exists to support v2 cases like "this header needs a heavier section than the project default." Changing it dirties the member; §5.3 rebuilds geometry next frame.

#### Service holes list

```
▼ Service holes (3)
   ✓ pos 1372 mm   ⌀ 38 mm   compliant
   ✗ pos 200 mm    ⌀ 38 mm   non-compliant — within 305 mm of member end
   ✓ pos 1829 mm   ⌀ 38 mm   compliant
```

The badges use the rule from §7.7 — green check, red cross, plus high-contrast text — so users with color vision deficiency can distinguish status. Clicking a hole row switches to `ServiceHoleBody`.

A `+ Add service hole` link at the bottom of the list activates `ServiceHoleTool` and pre-targets this member, so the next click on the canvas places a hole on this member specifically.

#### Built-up notes (headers only)

Visible only when `member.role === 'header'`. Shows the BOM expansion mapping for the parent opening's effective header type:

```
Box header expands to 4 BOM rows on export:
  • 2 × 362S162-54  (C-section)
  • 2 × 362T125-54  (track)
```

Read directly from `HEADER_COMPONENTS` (§6.1). Read-only; informational. Helps the user understand why their BOM has more rows than they have header members.

#### Footer

| Button | Action | Disabled when |
|---|---|---|
| `Reset section override` | Sets `sectionId` back to the framing default | No override set |

`Delete member` is **not** offered. Members are owned by `CFSFramingSystem` and `CFSPanelizationSystem` (§5.6); deleting one directly would cause the framing pass to recreate it next frame. The user deletes members by deleting their parent (opening, framing, panel) or by editing the structure that produced them.

### 7.4.7 `ServiceHoleBody` — Service hole selected

Shown when a `CFSServiceHole` is selected.

#### Sections

| Section | Contents |
|---|---|
| `Hole info` | Position, shape, diameter, oblong length, stiffener flag. Editable. |
| `Compliance` | Verdict, reasons. Read-only — driven by §5.4. |
| `Member context` | Parent member section, length, other holes on the member. |

#### Hole info

| Field | Source | Control | Validation |
|---|---|---|---|
| `positionAlongMember_mm` | `hole.positionAlongMember_mm` | Numeric stepper, increment 25 mm | 0 ≤ x ≤ member length |
| `shape` | `hole.shape` | Segmented Round / Oblong | — |
| `diameter_mm` | `hole.diameter_mm` | Numeric stepper, increment 5 mm | 12 ≤ x ≤ member's web depth |
| `oblongLength_mm` | `hole.oblongLength_mm` | Numeric stepper, increment 10 mm | Visible only when `shape === 'oblong'`; diameter ≤ x ≤ 4 × diameter |
| `hasStiffener` | `hole.hasStiffener` | Toggle | — |

Any change dirties the hole, triggering re-validation by `CFSServiceHoleSystem` (§5.4) on the next frame. The user sees the badge update one frame later.

#### Compliance

The verdict block:

```
[●] COMPLIANT
Last checked 2 seconds ago.

— or —

[●] NON-COMPLIANT
• Hole within 305 mm of member end (AISI S220, paraphrased)
• Hole width 100 mm exceeds 65% of web depth 92 mm

Last checked just now.
```

The leading badge dot is large and high-contrast. The reasons are bullet-listed, each one verbatim from `compliance.reasons`. The "last checked" timestamp is the relative human form of `compliance.checkedAt`.

If `compliance.status === 'unchecked'` (one-frame transient), the block shows `[●] CHECKING...` in gray.

#### Member context

```
Parent member: P-02-S05 (field stud, 362S162-54)
Member length: 2743 mm
Other holes on this member:
  ✓ pos 1372 mm
  ✓ pos 1829 mm
Mill pre-punches: 4 holes at 610 mm o.c. starting at 305 mm
```

Read-only navigation: clicking the parent member navigates to `MemberBody`. Clicking another hole navigates to that hole's `ServiceHoleBody`. The mill pre-punch line is rendered from the section's `prePunchPattern` (§5.4 open item resolved by spec slice G).

#### Footer

| Button | Action | Disabled when |
|---|---|---|
| `Delete hole` | Deletes the hole; member's geometry rebuilds next frame | Never |

## 7.5 Export menu

The dropdown that triggers the five exporters from section 6. The single most important control after the mode toggle: it is what turns the user's work into deliverables.

### Placement

Top toolbar, **far right**. Triggered by a button labeled `Export ▾`. Click opens the dropdown; click outside closes it.

### Menu items

In order:

| Item | Triggers | Section |
|---|---|---|
| `Bill of Materials (.xlsx)` | `BOMExporter` | §6.1 |
| `Cut list (.csv)` | `CutListExporter` | §6.2 |
| `Panel DXFs (.zip)` | `DXFExporter` | §6.3 |
| `Shop drawings (.pdf)` | `ShopDrawingExporter` | §6.4 |
| `Scene (.json)` | `JSONExporter` | §6.5 |
| `─────────────` | (separator) | |
| `Import scene...` | Opens file picker, runs `JSONImporter` on selection | §6.5 |

The import option lives in the export menu rather than a separate menu because it is the same conceptual operation in reverse — file in/out — and a separate menu would duplicate placement decisions.

### Disabled state per item

Each item runs the relevant preflight from §6.0 in a dry-run mode at render time and disables itself if preflight would fail. The disabled item shows a tooltip with the preflight failure message.

| Item | Disabled when (per §6.0 preflight) |
|---|---|
| BOM | No CFS project, no library, unresolved sections, no panels, or members without panel assignment |
| Cut list | No CFS project, no library, unresolved sections (panel checks skipped) |
| Panel DXFs | Same as BOM |
| Shop drawings | Same as BOM |
| Scene JSON | No CFS project (the only required check; everything else is optional) |
| Import | Always enabled when `isCFSMode === true` |

The dry-run preflight check is cheap — it walks `useScene` once, performing the same tests as the real preflight, and returns the first failure or null. Same code path, no side effects.

### Click flow

1. User clicks `Export ▾` → dropdown opens.
2. User clicks an item → dropdown closes, the export starts.
3. A progress indicator appears as a small banner anchored to the top of the editor: `Exporting BOM...` with an indeterminate spinner.
4. On success: banner replaces with `BOM downloaded as Riverside-Warehouse-BOM.xlsx`. The browser's native download UI shows the file. Banner auto-dismisses after 6 seconds.
5. On failure: banner replaces with the error message in error styling. Dismiss is manual (`✕` button on the banner).

Per §6.6 the download is triggered via `triggerDownload(blob, filename)`. The filename is shown in the success banner so the user knows what to look for.

### Concurrent exports

Two exports cannot run simultaneously. Clicking a second item while one is in progress queues the second; the banner updates to `Exporting BOM... (Cut list queued)`. The queue is FIFO and depth 1 — a third click while two are queued replaces the queued one and shows a transient toast: `Replaced queued export.` This is a deliberate simplification; v2 may add a real export queue UI.

### The `useExport` hook

The dropdown items dispatch through a single hook:

```ts
function useExport(): {
  exportBOM:           () => Promise<void>;
  exportCutList:       () => Promise<void>;
  exportDXFs:          () => Promise<void>;
  exportShopDrawings:  () => Promise<void>;
  exportJSON:          () => Promise<void>;
  importJSON:          (file: File) => Promise<ImportResult>;
  status: ExportStatus;
}

type ExportStatus =
  | { kind: 'idle' }
  | { kind: 'in_progress'; label: string }
  | { kind: 'success';    label: string; filename: string }
  | { kind: 'error';      label: string; message: string };
```

The hook is the single source of truth for export progress and feedback. The dropdown items, the success banner, and any future export-trigger surface (e.g., a keyboard shortcut bar) all subscribe to `status`.

## 7.6 Keyboard shortcuts

Every action exposed via the toolbar or inspector has a keyboard shortcut. The shortcut table is the user's reference; the `ShortcutsPanel` (§7.6.3) is the in-app reference.

### 7.6.1 Modifier key conventions

The convention follows platform standards:

| Modifier | macOS | Windows / Linux |
|---|---|---|
| Primary | `Cmd` | `Ctrl` |
| Secondary | `Option` / `Alt` | `Alt` |
| Tertiary | `Ctrl` | (none typical) |

In the table below, `Cmd/Ctrl` means "primary modifier on this platform." The platform detection lives in `apps/editor/cfs/lib/platform.ts` (single export `IS_MAC`); shortcut binding chooses the right key per platform.

### 7.6.2 Shortcut table

| Shortcut | Action | Section |
|---|---|---|
| `M` | Toggle CFS mode (Architectural ↔ CFS) | §7.1 |
| `T` | Activate `OpeningTool` | §7.3.1 |
| `H` | Activate `ServiceHoleTool` | §7.3.2 |
| `B` | Activate `PanelBreakTool` | §7.3.3 |
| `P` | Run `Panelize` on selected framing or all framings | §7.2 |
| `Esc` | Deactivate active tool / dismiss popover | §7.2, §7.3 |
| `Cmd/Ctrl + Z` | Undo (Pascal-owned, works through CFS mutations per §2.6) | §2.6 |
| `Cmd/Ctrl + Shift + Z` | Redo (Pascal-owned) | §2.6 |
| `Cmd/Ctrl + E` | Open Export menu | §7.5 |
| `Cmd/Ctrl + Shift + E` | Quick-export Scene JSON | §7.5 |
| `Cmd/Ctrl + Shift + B` | Quick-export BOM | §7.5 |
| `Cmd/Ctrl + Shift + D` | Quick-export Panel DXFs | §7.5 |
| `Cmd/Ctrl + Shift + P` | Quick-export Shop drawings PDF | §7.5 |
| `?` | Open `ShortcutsPanel` | §7.6.3 |
| `/` | Focus inspector search (v2; reserved) | — |
| `Tab` | Cycle focus through inspector controls | §7.9 |

Single-key shortcuts (`T`, `H`, `B`, `P`, `M`) only fire when no input element has focus. The shortcut binding listens on `document` and bails out if `event.target` is an `<input>`, `<textarea>`, `<select>`, or has `contenteditable`. This prevents typing the letter `t` in a project name field from activating the opening tool.

### 7.6.3 Conflict resolution with Pascal's bindings

Build slice 9 must verify that the shortcuts above do not conflict with Pascal's existing bindings. If a conflict exists, this section's shortcut wins **only when `isCFSMode === true`**; in architectural mode, Pascal's binding wins. This rule is enforced in `use-cfs-shortcuts.ts`:

```ts
useEffect(() => {
  if (!isCFSMode) return;
  const handler = (e: KeyboardEvent) => { /* dispatch */ };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}, [isCFSMode]);
```

The hook is conditional on `isCFSMode`; when false, no listener is registered, so Pascal's bindings work unchanged.

If build slice 9 finds a conflict that breaks a CFS shortcut even in CFS mode (e.g., Pascal's listener is on the same key with `stopPropagation`), the conflict is recorded as an open item and resolved by either changing the CFS letter or coordinating an upstream Pascal change. This section commits to the bindings above; the verification is slice 9's job.

### 7.6.4 `ShortcutsPanel`

A modal-less panel triggered by `?` (Shift+/ on most layouts). It is a list of every shortcut from §7.6.2 grouped by category:

- Mode and tools
- Edit and history
- Export and import
- Help and navigation

Each row: keyboard shortcut on the left, action description on the right. The panel has a close button and dismisses on `Esc`. It does not steal focus — the user can keep pressing shortcuts while it is visible.

### 7.6.5 Tooltip integration

Every toolbar button's tooltip includes its shortcut in parentheses:

```
Opening (T)
Service hole (H)
Panel break (B)
Panelize (P)
```

The shortcut text is rendered by the same string source as `ShortcutsPanel`, so they cannot drift. If a shortcut changes, both surfaces update.

## 7.7 Status surfaces

The single canonical place where each error or warning lives. The rule that prevents the same error from appearing in three places with three slightly different wordings.

### 7.7.1 Surface types

Four surfaces, each with a defined purpose:

| Surface | Purpose | Where |
|---|---|---|
| Status banner (top) | Project-wide errors that block workflows | Top of editor, full-width, dismissable |
| Inline callout | Section-scoped messages inside the inspector | Inside the relevant inspector body |
| Compliance badge | Per-hole verdict | Beside the hole in `MemberBody` and as the header of `ServiceHoleBody` |
| Transient toast | Acknowledgments of one-time actions | Bottom-right, auto-dismiss after 4 seconds |

### 7.7.2 Status banner

The full-width banner at the top of the editor below the toolbar. Shown only when at least one project-wide error is active. Examples:

| Condition | Message | Severity |
|---|---|---|
| `useCFS.activeLibrary === null` (library failed to load) | `No member library loaded. Refresh the page or check the SSMA catalog.` | Error |
| `CFSPanelizationSystem` threw `PanelizationError` | `Panelization failed: cannot break wall: forbidden zones cover the region. Adjust max width or move openings.` | Error |
| `JSONImporter` returned `status: 'partial'` | `Import completed with N rejected nodes. Click for details.` | Warning |
| Active library missing sections referenced by N members | `N members reference unknown sections. Open the inspector to fix.` | Warning |

The banner surfaces are mutually exclusive: if multiple errors are active, the banner cycles through them with a small "1 of 3" counter and prev/next arrows. v2 may show all simultaneously in a stacked tray.

### 7.7.3 Inline callout

A bordered colored block inside the inspector body. Used for selection-scoped messages:

| Body | Condition | Message |
|---|---|---|
| `WallFramingBody` | Section override fails to resolve | `Section sec-???? not found. Section will fall back to project default.` |
| `OpeningBody` | `flagOpeningInvalid` from §5.1 | The flag's reason text |
| `MemberBody` | Member's `sectionId` unresolved (post-import) | `This member's section is not in any loaded library. Geometry uses fallback rendering.` |
| `ServiceHoleBody` | `compliance.status === 'non-compliant'` | The verdict block from §7.4.7 |
| `PanelBody` | `cachedWeight_kg > project.settings.panelMaxWeight_kg` (drift between cache and current setting) | `Cached weight exceeds current max. Re-panelize to refresh.` |

Inline callouts disappear when the underlying condition clears.

### 7.7.4 Compliance badge

The per-hole verdict, used in two places:

| Location | Form |
|---|---|
| `MemberBody` hole list | Single character + color: `✓` green, `✗` red, `?` gray |
| `ServiceHoleBody` header | Full block with icon, status word, reasons, and timestamp (§7.4.7) |

Both forms carry both color and a non-color signal (the character). This satisfies the §7.9 accessibility rule that color is never the only signal.

The character set:

| `compliance.status` | Character | Color |
|---|---|---|
| `'compliant'` | `✓` | Green |
| `'non-compliant'` | `✗` | Red |
| `'unchecked'` | `?` | Gray |

The compliant/non-compliant colors match the role-color table from §1.2 / §6.3 contrast-tested for WCAG AA against the editor's dark and light themes. Build slice 9 confirms exact hex values.

### 7.7.5 Transient toast

Bottom-right, slides in, auto-dismisses after 4 seconds. Used for one-time acknowledgments that don't need permanent surface:

| Condition | Message |
|---|---|
| Opening too small to place (§7.3.1) | `Opening too small. Drag wider to place.` |
| Service hole at invalid position (§7.3.2 — currently no rejection, but reserved for v2) | — |
| Panel break placed | `Panel break added at x = N mm.` |
| Section override cleared | `Override cleared.` |
| Replaced queued export (§7.5) | `Replaced queued export.` |

Toasts are not dismissable manually — they go away on their own. They never show errors, only confirmations of small actions. Errors go to the status banner or the inline callout.

### 7.7.6 The single-source rule

Each error class has exactly one surface. The rule prevents:

- Library-load errors from appearing both in a banner and in the project settings body.
- Compliance verdicts from appearing both as a badge and as a banner.
- Import partial messages from appearing both as a banner and as a toast.

When two surfaces could plausibly host the same error, the rule is:

1. Project-wide → banner.
2. Selection-scoped → inline callout in the relevant body.
3. Per-node validation → the type-specific format (compliance badge for holes; inline callout otherwise).
4. One-time acknowledgment of a successful action → transient toast.

If a build slice surfaces an error in a place that contradicts this rule, the spec has drifted; fix this section first.

## 7.8 Empty states

What the user sees when they reach a screen state that has no content. Each empty state has one suggested next action.

### 7.8.1 First toggle to CFS mode

When `isCFSMode` flips from `false` to `true` for the first time in a session and no `CFSWallFraming` exists in the scene:

The inspector shows `ProjectSettingsBody` (§7.4.2). Above it, an inline callout:

```
Welcome to CFS mode.
Draw a wall to start framing it. Your project defaults are below — review them now,
since changes after framing will re-layout every wall.
```

The callout has a close button. It does not reappear after dismissal in the same session.

### 7.8.2 Wall drawn, no framing yet (one-frame transient)

Between the moment a wall is created and the moment `CFSFramingSystem` runs (§5.1's auto-create-framing flow), there is a one-frame state where the wall has no `CFSWallFraming` child. This is invisible to the user — the inspector's selection bridge handles it by showing a `Loading framing...` placeholder. After the framing pass, the bridge resolves to `WallFramingBody`.

If for any reason the framing fails to be created (e.g., the system aborted because the active library is null), the inspector shows the framing-pending placeholder for one extra frame, then surfaces the underlying error via the status banner per §7.7.2.

### 7.8.3 Framing exists, no openings

`WallFramingBody` shows the openings list as empty:

```
Openings (0)
No openings yet. Press T or click the Opening tool to place one.
```

The hint references the shortcut from §7.6.

### 7.8.4 Framing exists, not panelized

The Panels section in `WallFramingBody` and the entire `PanelBody` selection branch:

```
This wall has not been panelized.
Click Panelize below or press P to split the wall into shippable panels.
```

The button is the same `Panelize` button as in the body footer.

### 7.8.5 Panelized, exporters available

No special empty state. The `Export ▾` menu becomes fully enabled and the user is expected to know what an export does. The `?` shortcut opens the shortcuts panel if the user is unsure what to press.

### 7.8.6 Empty scene from a fresh import

A scene imported from a JSON file with `cfsNodes: {}` (a pure-Pascal scene loaded into the CFS-aware editor): same as §7.8.1 — `ProjectSettingsBody` with the welcome callout.

### 7.8.7 Library load failure

`useCFS.activeLibrary === null`. Status banner from §7.7.2 is shown. `ProjectSettingsBody` shows the active library section in error state with a `Retry load` button. Tools remain disabled with the disabled tooltip from §7.2.

This is the one empty state that blocks all CFS work. Without a library, no member can be created, no framing can run, no export will preflight. The status banner is the user's path back.

## 7.9 Accessibility and focus

The accessibility rules for v1. Conformance-focused; specific ARIA roles and tab orders are deferred to v2 once Pascal's existing accessibility baseline is documented.

### 7.9.1 Keyboard reachability

Every action exposed via mouse is reachable by keyboard. The complete set:

| Action category | Keyboard reach |
|---|---|
| Toggle CFS mode | Shortcut `M`, or `Tab` to the toggle and `Space`/`Enter` |
| Activate a tool | Shortcut (`T`, `H`, `B`), or `Tab` to the toolbar button and `Space`/`Enter` |
| Cancel a tool | `Esc` |
| Edit an inspector field | `Tab` to the field, type/arrow as appropriate |
| Open the export menu | Shortcut `Cmd/Ctrl + E`, or `Tab` to the trigger and `Space`/`Enter` |
| Trigger an export | `Tab` through menu items, `Enter` to activate |
| Run undo/redo | `Cmd/Ctrl + Z` and `Cmd/Ctrl + Shift + Z` |
| Open shortcuts panel | `?` |

Tool flows on the canvas (placing an opening, placing a hole, placing a break) are mouse-driven in v1 because they rely on cursor positioning over 3D geometry. Keyboard-only canvas placement is deferred to v2 with a "place at center of selected wall" pattern.

### 7.9.2 Focus rings

Every focusable element has a visible focus ring when reached by keyboard. The ring is high-contrast against the editor's background and does not depend on color alone — it has a thickness and a contrasting outline so it remains visible to users with color vision deficiency.

Focus rings are suppressed on mouse interaction (`focus-visible` semantics) so clicking a button does not leave a ring stuck. Pascal's existing ring style is reused for consistency.

### 7.9.3 Color is never the only signal

Three places where this rule applies:

1. **Compliance badges (§7.7.4).** Color and a character. `✓` `✗` `?` are unique even in monochrome.
2. **Member role colors in toolbar swatches and inspector left-border accents.** Always paired with a role label in text (`Field stud`, `Chord stud`, `King stud`).
3. **Status banner severity.** Color and an icon (`⚠` for warnings, `⛔` for errors). The icon is part of the message, not decoration.

Build slice 9 verifies WCAG AA contrast ratios for every text-on-color combination. Failures are recorded as open items.

### 7.9.4 Tab order

Within the editor, the global tab order is:

1. Mode toggle.
2. Pascal architectural toolbar (Pascal-owned order).
3. CFS toolbar (left to right: Opening, Service hole, Panel break, Panelize).
4. Export menu trigger.
5. Inspector header (breadcrumb segments left to right).
6. Inspector body (top to bottom through every focusable field).
7. Inspector footer buttons (left to right).
8. Canvas (a single tab stop; canvas-internal navigation is mouse-only in v1).

Tab order within the inspector body is the visual order: section headers are not focus stops (they are not interactive), only the editable controls and clickable rows are.

### 7.9.5 Screen reader text

Every interactive element has an accessible name:

- Toolbar buttons use the button's tooltip text as their `aria-label`.
- The mode toggle exposes both segments with `role="radio"` and `aria-checked` reflecting `isCFSMode`.
- Inspector field labels are programmatically associated with their inputs.
- Compliance badges include the verdict and reasons in their accessible name (`aria-label="Non-compliant: hole within 305 mm of member end"`).

Per §7.0, every user-visible string lives in `apps/editor/cfs/lib/strings.ts`; accessible names use the same source so they cannot drift from visible labels.

### 7.9.6 What this section does not commit to

- Specific ARIA roles for the canvas region.
- A live region for status banner announcements.
- Skip-links for keyboard navigation past the toolbar.
- Reduced-motion preferences for the toast slide-in animation.

These are v2 work. They are recorded as open items so spec slice G can track them and so build slice 9 can prioritize the parts that are achievable within v1's polish budget.

## 7.10 UI-side invariants

Properties that must hold across the editor in any healthy build. The §5.7 / §6.7 equivalent for UI. Each is runtime-checkable in development mode.

1. **Action symmetry.** Every action exposed by a button is also exposed by a shortcut listed in §7.6.2. Every shortcut listed is bound to an action that has a UI control. Symmetry prevents shortcuts that do nothing and buttons that have no shortcut equivalent.

2. **Field origin.** Every field shown as editable in any inspector body corresponds to a Zod schema field in §3 or a `useCFS` field documented in §4. No inspector-only fields exist; everything the user edits is part of the documented data model.

3. **Disabled-state truthfulness.** Every disabled button's disabled rule, when evaluated, returns true exactly when the underlying action would fail. The rule is the precondition, not a UI-only flag.

4. **Single-source error display.** No error message appears in more than one surface simultaneously. The §7.7.6 single-source rule is enforceable at runtime by walking the four surfaces' active state and asserting no two carry the same error key.

5. **Selection consistency.** The selection shown in the inspector breadcrumb (§7.4.1) matches `useViewer.selection`. They are derived from the same source; if they diverge, the bridge is broken.

6. **No destructive action one click away.** Every destructive button (delete framing, delete opening, remove panel break) opens a confirmation dialog before executing. Single-click destructive actions are bugs. The exception: deleting a service hole (§7.4.7) is single-click because it is recoverable via undo within one frame.

7. **Mode-gating respected.** When `isCFSMode === false`, no CFS-toolbar element, no CFS-inspector body, and no CFS-export menu is mounted. The DOM has no orphan CFS components in architectural mode. This catches forgotten gating in build slices.

8. **Strings centralization.** No user-visible string is hardcoded in a component. Every string comes from `apps/editor/cfs/lib/strings.ts`. Runtime check: a development-mode warning if a component renders a string literal that is not in the strings module (heuristic: any literal with more than one word).

9. **Tool-mutation labels.** Every `withBatchedUndo` call from a tool uses the label fixed in the tool's subsection (§7.3). The labels appear in the undo stack tooltip; misnamed labels make undo confusing. Fixed strings: `'place opening'`, `'place service hole'`, `'place panel break'`, `'panelize'`, `'enable CFS mode'`, `'import scene'`.

10. **Inspector observes, does not bypass.** No inspector body writes to `useScene` directly outside of documented mutators. Every editable field's change handler funnels through `useScene.getState().updateNode(id, changes)` or similar. Bypassing the mutator (e.g., directly mutating `useScene.nodes[id]`) is a violation of §4.7 Pattern 5 and the runtime check from §5.7 invariant 8.

These ten invariants are the runtime reflection of the contracts in this section. Failing one is a UI bug; the runtime checker pinpoints the offender by listing which invariant was violated and where.

---

## Open items raised by spec slice F

Items surfaced while writing section 7. They are listed here for the appendix, to be resolved in the indicated slice.

1. **Pascal toolbar component path.** §7.2 specifies that `CFSToolbarGroup` mounts to the right of Pascal's toolbar, separated by a divider. The exact integration point in Pascal's component tree (presumably `apps/editor/components/toolbar/Toolbar.tsx` or similar) is not confirmed. Build slice 1 must locate the integration point and, if it requires an upstream change to expose a slot, raise the change with Pascal rather than editing upstream files (§0.3). Until then, the placement contract is "to the right of Pascal's tool group, separated by a divider" — implementation-agnostic.

2. **Pascal inspector swap.** §7.0 commits to hiding Pascal's inspector when `isCFSMode === true` and showing the CFS inspector in its place. The mechanism — whether Pascal's inspector exposes a portal slot, whether we mount a sibling that uses `position: absolute`, whether Pascal needs an upstream change — is build-slice-1 work. Documented here so the slice has it on its checklist.

3. **Pascal shortcut conflicts.** §7.6.3 commits to CFS shortcuts winning when `isCFSMode === true`. Build slice 9 must verify no Pascal shortcut blocks a CFS shortcut in CFS mode. Conflicts found are resolved by changing the CFS letter (preferred) or by coordinating an upstream Pascal listener change.

4. **Mode toggle visual treatment.** §7.1 fixes the segmented control shape and the labels but not the icons. Build slice 1 picks icons from Pascal's existing icon library. If no suitable icons exist, the control renders text-only — this is acceptable and the spec does not require icons.

5. **Multi-selection editing.** §7.4.1 commits to multi-selection being read-only in v1. v2 should add multi-edit for project-wide changes (e.g., select all openings on a wall and change their header type to L-header). Recorded for v2 planning.

6. **Inspector search (`/`).** §7.6.2 reserves `/` for inspector search but does not implement it in v1. The intended use is jumping to a specific node by id, mark, or designation across a large project. Recorded for v2.

7. **Accessibility v2 scope.** §7.9.6 lists ARIA roles for the canvas region, status banner live regions, skip-links, and reduced-motion preferences as v2 work. Spec slice G should add these as explicit v2 backlog items rather than burying them inside section 7.

8. **Tooltip-and-shortcut sync mechanism.** §7.6.5 says tooltips include the shortcut and that both surfaces share a string source. The exact source (a `SHORTCUTS` map keyed by action id) is not specified. Build slice 9 commits to the structure when implementing the shortcuts panel, since the shape falls out naturally from rendering both surfaces from one source.

9. **Toast positioning conflict with Pascal.** §7.7.5 places transient toasts in the bottom-right. Pascal may already use this location for its own notifications. Build slice 9 verifies and either coordinates positioning with Pascal or moves CFS toasts to a non-conflicting corner.

10. **Confirmation dialog component.** §7.10 invariant 6 requires a confirm dialog before destructive actions. Pascal likely has one; we use it. If Pascal does not, the dialog lives at `apps/editor/cfs/components/ConfirmDialog.tsx` as a small Radix-based component (§2.10). Build slice 4 (first destructive action: `Delete opening`) makes the call.

11. **Welcome callout dismissal persistence.** §7.8.1 dismisses the welcome callout for the session. Whether dismissal persists across sessions (via localStorage) is a UX decision deferred to build slice 9. The session-only behavior is the safe v1 default.

---

*End of output for spec slice F — UI contract. Section 7 is complete. The full appendix sweep, cross-section reconciliation, and v2 backlog are produced by spec slice G.*
