# 4. State management (`useCFS` + `useScene`)

This section is the state contract for AACSteel-Designer. It defines where every piece of project information lives, how it gets there, how it changes, and how it is observed. Sections 0–2 established the architecture; section 3 defined the data shapes; this section defines the runtime rules that bind them together.

The audience is Claude Code reading this file at the start of any build slice that touches state — which is every slice from 1 onward. When implementing a slice, treat the rules in this section as final. If something here is ambiguous in the moment, the resolution belongs in the next spec edit, not in code.

> Note on terminology: this section uses `useScene`, `useViewer`, `useEditor`, `dirtyNodes`, `sceneRegistry`, and Pascal node-mutator signatures as defined in section 2. If terminology drifts from section 2, section 2 wins; this section must be reconciled in spec slice G.

## 4.0 The boundary rule

The single most consequential decision in the architecture, stated once:

> **Scene data goes in `useScene`. Editor-local state goes in `useCFS`. Nothing else.**

"Scene data" is anything the user creates, derives from what the user creates, ships in a JSON export, undoes, redoes, or expects to see again after closing and reopening a project. Every CFS node defined in section 3 — `CFSProject`, `CFSWallFraming`, `CFSMember`, `CFSOpening`, `CFSPanel`, `CFSServiceHole`, `CFSConnection` — is scene data.

"Editor-local state" is anything that exists only because the editor has a user interface — toggles, active tools, which inspector tab is open, hover states, the in-memory copy of loaded section libraries. None of it round-trips through JSON; none of it goes through undo; none of it survives a refresh, with a small explicit exception in §4.10.

Section 3 already commits to this rule in its own language ("editor-local state does not live in scene nodes — that state lives in `useCFS` and is defined in section 4"). This section is the operational version.

### The decision tree

When deciding where a new piece of state belongs, walk this tree top to bottom and stop at the first match.

1. **Will the user expect undo/redo to work for this change?** → `useScene`.
2. **Should this survive a JSON export and re-import?** → `useScene`.
3. **Does this exist independently of any one editor session — i.e., is it a property of the project?** → `useScene`.
4. **Is this a property of the editor's current session — selection, active tool, panel layout, mode toggle?** → `useCFS`.
5. **Is this a per-user preference that should follow the user across projects but not across users?** → `useCFS`, with `localStorage` persistence per §4.10.
6. **Is this transient render state — hover highlight, drag preview, the geometry that lives on a Three.js mesh?** → not in any store. Lives on the registry's `Object3D` and is recomputed by systems.

Three patterns repeatedly look like exceptions but are not:

- **Member libraries (`CFSMemberLibrary`, `CFSSection`)** are reference data, not scene data. They are catalog lookups, identical for every project that uses the same library, and their contents do not change as the user works. They live in `useCFS.memberLibraries`. Section 3.3 makes this explicit and gives the rationale.
- **Project settings (`CFSProjectSettings`)** are scene data because they are properties of the project (different projects, different settings) and the user expects to undo a settings change. They live on the singleton `CFSProject` node in `useScene`. The editor reads them through a selector — see §4.5.
- **Cached aggregates** like `CFSWallFraming.cachedTotalWeight_kg` and `CFSPanel.cachedWeight_kg` are scene data per section 3 (they round-trip in JSON), but they are derived. Systems write them; nothing else does. They are denormalization, not state.

### The forbidden inversions

The two failure modes the boundary rule prevents:

- **Scene data in `useCFS`.** Loses undo/redo, loses persistence, loses JSON round-trip. Symptoms: the user undoes and the change does not revert; the user reloads and their work is gone.
- **Editor-local state in `useScene`.** Pollutes the undo history with cosmetic changes, bloats the JSON exporter output, fires `dirtyNodes` for changes that have nothing to do with scene geometry. Symptoms: the user toggles the inspector tab and that becomes an undo step; opening a project shows the previous editor's selection.

If a future feature feels like it requires breaking the boundary rule, the feature is wrong before the boundary is. Open an Appendix item; do not split the difference in code.

## 4.1 The four stores at a glance

Pascal has three stores; we add a fourth. The full mapping for AACSteel-Designer:

| Store | Package | Owner | Persisted to disk | In undo history | What lives there |
|---|---|---|---|---|---|
| `useScene` | `@pascal-app/core` | upstream Pascal | yes (IndexedDB) | yes (Zundo, 50 steps) | All scene nodes — Pascal walls, slabs, items, levels, plus every `cfs_*` node defined in section 3. The dirty set. CRUD mutators. |
| `useViewer` | `@pascal-app/viewer` | upstream Pascal | no | no | Selection (building/level/zone ids), level display mode, camera mode. |
| `useEditor` | `apps/editor` | upstream Pascal | no | no | Editor `phase` (`site \| structure \| furnish`), active tool, drawer state. |
| `useCFS` | `@pascal-app/cfs` | this project | partial (`localStorage`, see §4.10) | no | Mode toggle, member libraries, active library id, inspector tab, project-creation transient flags, per-user preferences. |

Three observations the table makes explicit:

1. **Only `useScene` is persistent and undoable.** Anything that needs either property must live there. There is no opt-in; persistence and undo are properties of the store.
2. **Only `useScene` participates in `dirtyNodes`.** Systems iterate the dirty set; the dirty set lives on `useScene`. Mutations to the other three stores do not dirty any node.
3. **`useCFS` is partial-persistence.** The store as a whole is in-memory; a small allowlist of fields persist via `localStorage`. The list is exhaustive in §4.10.

## 4.2 `useCFS` shape

This is the transcription target for build slices 1 and 2. Build slice 1 implements a minimal subset (just the mode toggle); build slice 2 implements the rest. Both slices read this subsection.

The store has three concerns: editor mode and UI, the in-memory member-library catalog, and per-user preferences. Each concern is a slice of the store; together they form the full state object.

### Full TypeScript shape

```typescript
import type {
  CFSMemberLibrary,
  CFSMemberLibraryId,
  CFSHeaderType,
} from '@pascal-app/cfs/schema';

// ----- editor / UI state -----

export type CFSInspectorTab =
  | 'wall'      // selected CFSWallFraming summary
  | 'opening'   // selected CFSOpening details
  | 'panel'     // selected CFSPanel summary
  | 'holes'     // service-hole list and compliance
  | 'settings'; // project settings form

export type CFSUnitsDisplay = 'metric' | 'imperial';

// ----- library catalog state -----

// Keyed by library id; immutable after load. Multiple libraries can coexist.
export type CFSMemberLibraryMap = Record<CFSMemberLibraryId, CFSMemberLibrary>;

// ----- the store -----

export interface CFSStoreState {
  // --- mode ---
  isCFSMode: boolean;

  // --- inspector / UI ---
  inspectorTab: CFSInspectorTab;
  hoveredMemberId: string | null;       // transient highlight; null when nothing hovered
  selectedPanelId: string | null;       // distinct from useViewer selection; CFS-scope

  // --- libraries (in-memory catalog) ---
  memberLibraries: CFSMemberLibraryMap;
  activeLibraryId: CFSMemberLibraryId | null;

  // --- per-user preferences (subset persisted; see §4.10) ---
  unitsDisplay: CFSUnitsDisplay;
  preferredHeaderType: CFSHeaderType;

  // --- transient lifecycle flags ---
  isLibraryLoading: boolean;
  libraryLoadError: string | null;
}

export interface CFSStoreActions {
  // mode
  setCFSMode: (next: boolean) => void;

  // inspector / UI
  setInspectorTab: (tab: CFSInspectorTab) => void;
  setHoveredMember: (id: string | null) => void;
  setSelectedPanel: (id: string | null) => void;

  // libraries
  loadLibrary: (json: unknown) => Promise<void>; // parses, validates, registers
  setActiveLibrary: (id: CFSMemberLibraryId) => void;

  // preferences
  setUnitsDisplay: (units: CFSUnitsDisplay) => void;
  setPreferredHeaderType: (header: CFSHeaderType) => void;
}

export type CFSStore = CFSStoreState & CFSStoreActions;
```

### Field-by-field notes

- **`isCFSMode`** — the parallel mode toggle. Resolution of the appendix question raised in spec slice A is in §4.6.
- **`inspectorTab`** — single enum because the inspector is a single tabbed panel (resolved here; details deferred to section 7).
- **`hoveredMemberId`, `selectedPanelId`** — explicitly editor-local. Selection of *Pascal* nodes (walls, levels, buildings) belongs to `useViewer.selection` and is unchanged. CFS-scope selection that does not map onto Pascal's selection model lives here.
- **`memberLibraries`** — record keyed by `CFSMemberLibraryId`. Holds the in-memory parsed form of the catalog. Sections inside a library are looked up as `memberLibraries[activeLibraryId].sections.find(s => s.id === sectionId)`; a memoized selector wraps this — see §4.11.
- **`activeLibraryId`** — must, when not null, key into `memberLibraries`. Invariant enforced by `setActiveLibrary`.
- **`unitsDisplay`, `preferredHeaderType`** — per-user preferences. `unitsDisplay` mirrors `CFSProjectSettings.units` from section 3.1 conceptually but is independent: a user can prefer metric display while opening a project saved with `units: 'imperial'`. The display preference wins for that user's session; the project's stored value is unchanged. The inspector form in §4.5 surfaces both.
- **`isLibraryLoading`, `libraryLoadError`** — transient flags so the UI can show a spinner and a meaningful error if `ssma.json` fails to parse. Cleared on next successful load.

### What is not in `useCFS`

By the boundary rule, none of the following appear:

- CFS nodes — they are in `useScene`.
- Project settings (`CFSProjectSettings`) — they are on the `CFSProject` node in `useScene`. `useCFS.preferredHeaderType` is a *seed* for new projects, not the settings themselves.
- The active Pascal tool — that is `useEditor`. CFS tools register with `useEditor` like any other tool.
- The current Pascal `phase` — that is `useEditor.phase`. The CFS toggle is independent (§4.6).
- Geometry, meshes, materials — those live on the registry's `Object3D` instances, never in any store.

### File layout

Per §2.9, the store lives at `packages/cfs/src/store/use-cfs.ts`. Selector helpers live alongside it under `packages/cfs/src/store/selectors/` — see §4.11.

## 4.3 Library hydration

The SSMA catalog ships in the repo as `packages/cfs/src/data/ssma.json`. On app load, `useCFS` must hydrate `memberLibraries['lib-ssma']` from that file. The full sequence:

1. App mounts. `useCFS` initializes with `memberLibraries: {}`, `activeLibraryId: null`, `isLibraryLoading: false`.
2. The CFS root component (mounted regardless of `isCFSMode`) runs a `useEffect` that imports `ssma.json` and calls `useCFS.loadLibrary(json)`.
3. `loadLibrary` sets `isLibraryLoading = true`, then runs the loader at `packages/cfs/src/library/load-ssma.ts`:
   1. Validate the JSON against `CFSMemberLibrary` (the section-3 Zod schema). Reject on parse error.
   2. Insert the parsed library into `memberLibraries` keyed by `library.id`.
   3. If `activeLibraryId` is null, set it to the loaded library's id. (For v1 with one library, this is always the case on first load.)
4. On success, `isLibraryLoading = false`, `libraryLoadError = null`.
5. On failure, `isLibraryLoading = false`, `libraryLoadError = <message>`. The library is not registered. Sections that depend on the library (every CFS system) must guard against `memberLibraries[activeLibraryId]` being `undefined` and render an inspector-level error rather than crashing.

### Pseudo-code for the loader

```
async function loadLibrary(json: unknown): Promise<void> {
  setState({ isLibraryLoading: true, libraryLoadError: null });
  try {
    const lib = CFSMemberLibrary.parse(json);     // throws on schema mismatch
    setState((s) => ({
      memberLibraries: { ...s.memberLibraries, [lib.id]: lib },
      activeLibraryId: s.activeLibraryId ?? lib.id,
      isLibraryLoading: false,
    }));
  } catch (err) {
    setState({
      isLibraryLoading: false,
      libraryLoadError: formatZodError(err),
    });
  }
}
```

### Failure modes

| Failure | Cause | Recovery |
|---|---|---|
| `ssma.json` missing at build time | Repo damaged or fetch path wrong | Build fails. Not a runtime concern. |
| `ssma.json` malformed JSON | Bad commit to `data/ssma.json` | `JSON.parse` throws inside the dynamic import; `loadLibrary` catches; `libraryLoadError` set. |
| `ssma.json` parses but fails Zod validation | Schema drift between code and data | `CFSMemberLibrary.parse` throws; `libraryLoadError` set with field path. |
| User attempts CFS mode with no library loaded | Library load failed | `setCFSMode(true)` succeeds (it is just a flag), but the inspector renders a clear error explaining no library is available. Tools refuse to create framing. |

**The library loader does not retry on failure.** A malformed catalog is a build problem, not a network problem; retrying does not help. The user can refresh the page after a fix is deployed.

### v2 multi-library

The store accommodates multiple libraries today (`memberLibraries` is a map, `setActiveLibrary` takes any registered id), but v1 ships only SSMA. User-uploaded libraries are deferred. The shape does not change in v2; only the loader gets additional callers.

## 4.4 `CFSProject` lifecycle

The `CFSProject` schema (section 3.2) is a singleton per scene. The lifecycle rules:

### Creation

A `CFSProject` is created **the first time `setCFSMode(true)` is called in a scene that has no `CFSProject` node**. The flow:

1. User clicks the CFS toggle in the toolbar. The toggle handler calls `useCFS.setCFSMode(true)`.
2. `setCFSMode` flips `isCFSMode` and, in the same callback, checks `useScene` for an existing `CFSProject` node.
3. If none exists, the handler constructs a new `CFSProject` via `CFSProject.parse({...})` with:
   - `parentId` = the Pascal site/building root node id
   - `settings` = a default `CFSProjectSettings` derived from `useCFS.preferredHeaderType`, `useCFS.unitsDisplay`, and hard-coded SI defaults for spacing/panel/wall-height
   - `libraries` = `[useCFS.activeLibraryId]` (which must be non-null at this point — the CFS root has loaded SSMA before the toggle is reachable)
   - `activeLibraryId` = `useCFS.activeLibraryId`
   - `createdAt`, `updatedAt` = `now()`
   - `metadata` = `{}`
4. Insert with `useScene.createNode(project, siteRootId)`.

This is one undo step. Toggling CFS mode off and on again does not create a second project — the existence check in step 2 finds the first one. The toggle is idempotent on the project.

### Singleton invariant

There is at most one `CFSProject` node in any scene. Enforced in two places:

- `setCFSMode` checks before creating (above).
- The JSON importer (build slice 9) rejects scenes with more than one `cfs_project` node and surfaces the problem rather than silently keeping one.

### Hydration on JSON import

When a scene JSON containing a `CFSProject` is imported:

1. `JSONImporter` constructs all nodes, including the `CFSProject`, via `useScene.createNode` calls (or a bulk equivalent that preserves Zundo as one undo step — see §4.9).
2. After import, the importer reads the imported `CFSProject.activeLibraryId` and calls `useCFS.setActiveLibrary(id)` if that library is loaded. If the library is *not* loaded, the importer surfaces a "missing library" warning and leaves the user's current `useCFS.activeLibraryId` unchanged. Members in the imported scene still resolve their `sectionId` against any loaded library that contains a matching section; if none does, those members render in a fallback "unresolved section" state.
3. `isCFSMode` is set to `true` if the imported scene contains a `CFSProject`. If it does not, `isCFSMode` is unchanged.

### Deletion

The `CFSProject` node is not user-deletable in v1. There is no UI affordance to delete it. The toggle turns CFS *visibility* off; it does not delete the project. This preserves the invariant that an existing project's framing, openings, and panels are always recoverable.

If v2 adds a "remove all CFS data from this scene" command, it deletes the `CFSProject` and cascades per section 3.12 (which deletes every framing, which cascades to every member, opening, panel, hole, connection). That cascade lives in `useScene.deleteNode`; nothing in `useCFS` needs to know about it.

### What is *not* on `CFSProject` and why

The `CFSProject` is small on purpose. It holds settings, library references, and metadata. It does *not* hold lists of framings, members, or panels — those discover themselves through `parentId` chains in `useScene`. Storing aggregate lists on the project would create another denormalization to keep in sync; the parent-child graph is already the source of truth.

## 4.5 Project settings: read and write paths

`CFSProjectSettings` (section 3.1) is scene data. It lives on the `CFSProject` node, in `useScene`. The editor reads it constantly — every system needs `defaultStudSpacing_mm`, every panelizer needs `panelMaxWidth_mm` — and the inspector lets the user edit it. This subsection defines both paths.

### The read path: `useProjectSettings()`

A single selector hook is the canonical reader. Pseudo-code:

```typescript
// packages/cfs/src/store/selectors/use-project-settings.ts

export function useProjectSettings(): CFSProjectSettings | null {
  const projectId = useScene((s) => findCFSProjectId(s));   // memoized
  const settings  = useScene((s) =>
    projectId ? (s.nodes[projectId] as CFSProject).settings : null
  );
  return settings;
}
```

Properties of this selector:

- **One subscription per consumer.** Components that read settings re-render only when settings change, not when any other scene node changes.
- **Returns `null` before the project exists.** Consumers must handle null — typically by rendering nothing, since a UI surface that cares about CFS settings is also gated on `isCFSMode`, and `isCFSMode` implies the project exists (per §4.4).
- **Does not duplicate state.** There is no `useCFS.projectSettings` field. Reading from `useCFS` would mean mirroring the source of truth, and mirrors drift.

Systems use the equivalent non-hook accessor: `getProjectSettings(useScene.getState())`.

### The write path: `updateProjectSettings()`

The inspector's settings form does not call `setState` directly on a copy of settings. It calls a single mutator:

```typescript
// packages/cfs/src/store/selectors/use-project-settings.ts

export function updateProjectSettings(
  patch: Partial<CFSProjectSettings>
): void {
  const state = useScene.getState();
  const projectId = findCFSProjectId(state);
  if (!projectId) return;
  const current = (state.nodes[projectId] as CFSProject).settings;
  const next    = CFSProjectSettings.parse({ ...current, ...patch });
  state.updateNode(projectId, { settings: next, updatedAt: nowIso() });
}
```

Properties:

- **Validation at write time.** `Parse` throws on invalid input; the form catches and surfaces field errors. No invalid settings ever reach the store.
- **Single Zundo step.** A settings edit is one `updateNode` call, so undo reverts the whole edit, not partial fields.
- **Dirty propagation is automatic.** `updateNode` adds the project id to `dirtyNodes`. Systems that care about settings (panelization, framing) subscribe to dirty events on `cfs_project` and mark the appropriate downstream nodes dirty — see §4.8.

### `useCFS` is *not* the cache

Putting settings in `useCFS` would be a tempting "performance optimization." It is forbidden:

- It would lose undo on settings edits.
- It would require manual synchronization on JSON import.
- The selector approach above already provides minimal re-renders; there is no performance to be gained.

The only `useCFS` field that *resembles* a settings field is `preferredHeaderType` (§4.2). It is not a cache of project settings; it is a per-user *seed* for new projects (§4.4). After project creation, the project's settings are independent and authoritative.

### Inspector form binding

The settings inspector tab (`inspectorTab === 'settings'`) is a controlled form bound to the selector:

```
const settings = useProjectSettings();
// render inputs whose values come from settings
// onChange handlers call updateProjectSettings({ field: newValue })
```

Form-level concerns — debouncing, dirty-form indicator, cancel/confirm — are UI decisions deferred to section 7.

## 4.6 Mode toggle: resolution of appendix item 2

Spec slice A's appendix flagged a real design question: should CFS mode be a fourth value of `useEditor.phase` (composing with Pascal's existing `site | structure | furnish` machinery), or a parallel `useCFS.isCFSMode` boolean?

**Resolution: parallel boolean.**

`useCFS.isCFSMode: boolean` is the mode toggle. `useEditor.phase` is unchanged. The toggle is independent of the phase.

### Reasons

1. **Upstream rule.** Section 0.3's inviolable rule prohibits modifying upstream Pascal packages. Adding `cfs_detail` to `useEditor.phase` would either require changing `@pascal-app/core` (forbidden) or layering a fork (deferred to a Pascal pull request, which we do not block on for v1).
2. **Composition.** A user might reasonably want to be in `structure` phase architecturally and have CFS overlays visible, or in `site` phase for context and CFS hidden. A fourth phase value would force the modes mutually exclusive. A parallel boolean composes.
3. **Execution Plan match.** Build Slice 1's kickoff prompt specifies a parallel boolean by name. Resolving this section to match avoids a documented-vs-coded mismatch on day one.

### Behavior on toggle

`setCFSMode(true)`:

1. Sets `isCFSMode = true` in `useCFS`.
2. Triggers project creation if no `CFSProject` exists (§4.4).
3. Causes CFS renderers to mount in the React tree; existing CFS scene nodes become visible. No scene mutation occurs beyond the one-time project creation.

`setCFSMode(false)`:

1. Sets `isCFSMode = false`.
2. CFS renderers unmount; existing CFS scene nodes are hidden but not deleted. The data is intact in `useScene`.
3. No scene mutation. The toggle is purely a visibility flip after the first activation.

### Interaction with Pascal `phase`

Pascal's `phase` continues to govern Pascal's surfaces — site tools, structure tools, furnishing tools. CFS tools (`OpeningTool`, `ServiceHoleTool`, `PanelBreakTool`) are gated on `isCFSMode === true` and are independent of `phase`. A CFS tool can be active while `phase === 'structure'`; that is the expected case.

If a future version of AACSteel-Designer wants CFS to constrain the available phases (e.g., disable `furnish` while in CFS mode), that gating happens in the toolbar component (section 7), not here. The state model does not enforce it.

### What "appendix item 2 resolved" means

This subsection is the resolution. Spec slice G should remove the open question from the appendix and replace it with a one-line note pointing here.

## 4.7 Mutation flow rules

Every state change in AACSteel-Designer follows one of a small set of canonical patterns. This subsection lists each pattern, what it looks like in code, and the corresponding forbidden form. Build slices 1–9 must follow these patterns; deviations are bugs.

### Pattern 1: Creating a CFS scene node

The §2.5 pattern, applied to every CFS node type. Always:

```typescript
const member = CFSMember.parse({
  type: 'cfs_member',
  id: makeCFSMemberId(),
  parentId: framingId,
  role: 'stud',
  sectionId: studSectionId,
  start: { x_mm: 1219.2, y_mm: 0,    z_mm: 0 },
  end:   { x_mm: 1219.2, y_mm: 2743, z_mm: 0 },
  orientation_deg: 0,
  panelId: null,
  serviceHoleIds: [],
});
useScene.getState().createNode(member, framingId);
```

Three things this pattern guarantees:

- The node is validated at construction. A malformed node never enters the store.
- The parent-child link is established atomically.
- Zundo records exactly one history entry for this insertion.

Forbidden forms:

- `useScene.getState().createNode({ type: 'cfs_member', ... }, framingId)` — bypasses validation. Schemas exist for a reason.
- Mutating `useScene.getState().nodes[id] = node` directly — bypasses Zundo and dirty tracking.
- Constructing the node and calling `useScene.setState({ nodes: { ...current, [id]: node } })` — same problem.

### Pattern 2: Updating a CFS scene node

```typescript
useScene.getState().updateNode(memberId, {
  panelId: newPanelId,
  shippingMark: newShippingMark,
});
```

Properties:

- Partial update; unspecified fields remain.
- The full updated node is implicitly re-validated by `updateNode` (or, if Pascal's mutator does not validate, the system wraps the call in a `Schema.parse` of `{ ...current, ...patch }`; this is confirmed in build slice 1).
- The id is added to `dirtyNodes`. Cascading dirty propagation per §4.8.
- One Zundo step per `updateNode` call. Multi-field updates in a single call are one undo step; multiple `updateNode` calls are multiple undo steps unless batched (§4.9).

### Pattern 3: Deleting a CFS scene node

```typescript
useScene.getState().deleteNode(nodeId);
```

The cascade rules from section 3.12 apply: deleting a `CFSWallFraming` deletes its members, openings, panels, and connections; deleting a `CFSMember` deletes its service holes and updates connections; deleting a `CFSOpening` deletes the members listed in its `generatedMemberIds`; deleting a `CFSPanel` sets `panelId = null` on its members.

These cascades are policy enforced in the deletion handlers (a thin layer above `useScene.deleteNode`). The cascade is one Zundo step. Undoing a `CFSOpening` deletion restores the opening *and* every member it had generated.

### Pattern 4: Mutating editor-local state

```typescript
useCFS.getState().setInspectorTab('panel');
useCFS.getState().setHoveredMember(memberId);
```

Properties:

- No Zundo. Toggling tabs is not an undo step.
- No dirty propagation. Editor-local state never marks scene nodes dirty.
- Renders update via Zustand's standard subscription model.

### Pattern 5: Mutating scene state from a system

Systems run in `useFrame`. They read from `useScene.getState()` and `sceneRegistry`, and they write through `useScene.getState().updateNode` (or `createNode` / `deleteNode`). They never mutate `useScene.nodes` directly, never write to `useCFS`, and never bypass `Schema.parse`.

The standard system shape, expanding §2.1's pseudo-code:

```typescript
useFrame(() => {
  const scene = useScene.getState();
  const dirty = scene.dirtyNodes;

  for (const id of dirty) {
    const node = scene.nodes[id];
    if (node?.type !== 'cfs_wall_framing') continue;

    // 1. Compute the desired layout from the node + project settings.
    const settings = getProjectSettings(scene);
    const layout = computeFramingLayout(node, scene, settings);

    // 2. Diff against existing children and emit createNode / updateNode / deleteNode calls.
    applyFramingDiff(layout, scene);

    // 3. Clear the dirty marker for this node.
    scene.dirtyNodes.delete(id);
  }
});
```

The `applyFramingDiff` step is the only place a system writes scene data. Each call inside it goes through `useScene` mutators per patterns 1–3.

### Pattern 6: Transient render state on the registry

Hover highlights, drag previews, ghost geometry — anything that exists only for one frame or only while a pointer is held — does not go in any store. It is set on the `Object3D` in `sceneRegistry` directly:

```typescript
const obj = sceneRegistry.nodes.get(memberId);
if (obj) (obj as THREE.Mesh).material = highlightMaterial;
```

The system or interaction handler that set the transient state is responsible for clearing it. If transient state needs to outlive a frame (e.g., persistent hover highlight while the user moves the mouse), the *trigger* (hovered member id) goes in `useCFS.hoveredMemberId` and a system reads it and applies the visual change to the registry. The store carries the id; the registry carries the visual.

### The forbidden patterns, summarized

- Direct mutation of `useScene.nodes` — bypasses Zundo and dirty tracking.
- `Schema.parse` skipped on a `createNode` — admits malformed nodes.
- Scene data placed in `useCFS` — loses persistence and undo.
- Editor-local state placed in `useScene` — pollutes undo and JSON.
- Geometry stored in any Zustand store — bloats serialization, defeats the registry.
- Systems writing to `useCFS` — `useCFS` is for editor input, not derived scene output.

## 4.8 Dirty-node propagation contract

Pascal's dirty-node pattern (§2.1) is the engine that turns a small mutation into the right set of regenerated nodes. This subsection defines, for every CFS-relevant mutation, which nodes become dirty as a consequence. Build slices 3–7 read this table when implementing systems.

The general rule: **a mutation dirties its target node directly and its dependents transitively.** What counts as a dependent depends on what each system consumes.

### Direct dirty propagation

| Mutation | Nodes added to `dirtyNodes` |
|---|---|
| Create / update / delete a Pascal `Wall` (length, position, orientation) | The wall, plus any `CFSWallFraming` whose `parentId === wall.id`. |
| Create `CFSWallFraming` | The framing. (No upstream dirties; it is the upstream.) |
| Update `CFSWallFraming` (config field — `studSpacing_mm`, `studSectionId`, etc.) | The framing only. The framing system regenerates layout. |
| Create `CFSOpening` | The opening, plus its parent `CFSWallFraming`. |
| Update `CFSOpening` (position, dimensions, header type override) | The opening, plus its parent `CFSWallFraming`. |
| Delete `CFSOpening` | The parent `CFSWallFraming`. The opening's `generatedMemberIds` are deleted by the cascade. |
| Create / update / delete `CFSMember` (system-driven only — users do not place members directly) | The member, plus the parent `CFSWallFraming` (so cached aggregates refresh). |
| Update `CFSMember.panelId` | The member only. **Not** the framing, **not** the panel. Panel reassignment is a tagging operation, not a layout change. |
| Create / update / delete `CFSPanel` | The panel, plus the parent `CFSWallFraming`. |
| Create / update / delete `CFSServiceHole` | The hole, plus its parent `CFSMember` (so geometry CSG re-runs). |
| Update `CFSProject.settings` | The project, plus every `CFSWallFraming` in the scene (so framing systems re-evaluate against the new defaults). |

### Why `CFSMember.panelId` does not dirty the framing

This is the one rule that surprises. Updating `panelId` is a metadata change — the member's role, position, and section are unchanged. Framing layout does not depend on which panel a member belongs to. Geometry does not depend on it. Dirtying the framing on a panel reassignment would re-run the framing layout for no benefit.

The panel itself is *also* not dirtied by a member's `panelId` change, because cached aggregates on the panel are recomputed by `CFSPanelizationSystem` after a panelization run, not on every individual reassignment. The system clears its own dirty marker after recomputing.

### Cross-store reactivity

`useCFS` mutations do not directly add to `dirtyNodes`, with one exception:

- **`setActiveLibrary`** — when the active library changes, every CFS scene node that resolves a `sectionId` may need to re-resolve. The corresponding store action dirties every `CFSWallFraming` and every `CFSMember` in the scene, so framing and geometry systems re-run.

This is the one place an editor-local mutation crosses into scene-side reactivity. It is documented here so that build slice 2 implements the dirty propagation as part of `setActiveLibrary`.

Toggling `isCFSMode` does *not* dirty any node. CFS renderers mount or unmount; existing nodes are unchanged.

### What the systems must guarantee

Every CFS system, on every frame:

1. Iterates `dirtyNodes`.
2. Filters by the type(s) it owns.
3. Processes each owned id.
4. Removes the id from `dirtyNodes` after processing.

A system that processes a node and does not clear the dirty marker creates a busy loop. A system that clears a dirty marker without processing creates a stale view. Both are bugs caught by the per-frame profiling described in Execution Plan FAQ 4.5.

## 4.9 Undo/redo invariants

Pascal wraps `useScene` with Zundo, providing 50 steps of undo (§2.6). For undo and redo to work correctly with our additions, three invariants must hold. They are restatements of §2.6 in operational form.

### Invariant 1: All scene mutations go through `useScene` mutators

`createNode`, `updateNode`, `deleteNode`. No exceptions. Pattern 1 in §4.7 is the canonical insertion path; patterns 2 and 3 are the canonical update and delete paths. Direct `setState` on `useScene` bypasses Zundo's diff capture and breaks undo for that change.

### Invariant 2: Editor-local state is not in `useScene`

Restated from §4.0. The contrapositive of "scene data goes through Zundo" is "non-scene data must not go through Zundo." If `inspectorTab` were on `useScene`, every tab click would consume an undo slot, pushing real edits out of the 50-step buffer.

### Invariant 3: Multi-mutation operations batch into one undo step

This is the invariant that demands explicit support, because Zundo by default records every `setState` as a separate step.

A user-visible operation often produces many scene mutations: placing a window creates the opening node *and* triggers the framing system to create kings, jambs, header, sill, sill track, and cripples — eleven or so nodes in total. The user expects undo to revert the whole window, not one cripple at a time.

The mechanism is a batched-undo wrapper:

```typescript
// packages/cfs/src/store/with-batched-undo.ts

export function withBatchedUndo<T>(label: string, fn: () => T): T {
  const temporal = useScene.temporal.getState();
  temporal.pause();
  try {
    return fn();
  } finally {
    temporal.resume();
    // Force one history entry that captures the state before fn ran
    // and the state after. Implementation depends on Zundo's API surface;
    // build slice 1 confirms whether Pascal already provides this.
  }
}
```

Every user-facing operation that mutates more than one node uses this wrapper:

```typescript
withBatchedUndo('place opening', () => {
  const opening = createOpening(...);          // 1 createNode
  // CFSFramingSystem will fire on next frame and create the surrounding members.
  // Those creations need to be inside the same batch — see note below.
});
```

**Caveat:** because system-driven mutations happen in `useFrame` after the user action returns, naive use of `withBatchedUndo` does not capture them. The implementation strategy:

- The user-action wrapper sets a `pendingBatchLabel` flag on `useCFS` (transient, not persisted, not undone).
- The next `useFrame` tick, before systems run, the flag is consumed by a pre-frame Zundo `pause`.
- After all systems have processed the dirty set produced by the user action, a post-frame `resume` plus a manual history-commit produces one undo step covering the user mutation + all system-driven mutations.

This is delicate machinery. Build slice 1 implements and tests it against a known-good case (toggling CFS mode + project creation should be one undo step). Build slice 4 stresses it (placing a window should be one undo step covering ~11 node creations).

### Worked invariants check

| User action | Expected undo behavior | Implementation requirement |
|---|---|---|
| Toggle inspector tab | No undo step | `useCFS` is outside Zundo |
| Toggle CFS mode for first time in scene | One undo step (project creation) | `setCFSMode` wraps project creation in `withBatchedUndo` |
| Toggle CFS mode again (off, then on) | No undo step | Toggle is `useCFS`-only after first activation |
| Draw a Pascal wall in CFS mode | One undo step (Pascal wall + framing + tracks + studs) | Pascal's wall-creation path + framing system run within one `withBatchedUndo` |
| Place a window | One undo step (opening + 10–12 framing members) | Opening tool wraps the createNode + the system-driven follow-up |
| Edit project settings field | One undo step | Single `updateNode` on the project |
| Change `setActiveLibrary` | No undo step (per-user preference) | The cross-store dirties (§4.8) re-run systems but their re-emitted updates are not new history; they are derived state |
| Place a service hole | One undo step (hole created, member geometry CSG follow-up) | Service hole tool batches |

### Cross-reference

Once this section is in place, **Execution Plan FAQ 4.6 ("Undo/redo stops working after adding CFS features") should be deleted.** Replace it with a one-line pointer to §4.9 in spec slice G's cleanup pass. The information FAQ 4.6 conveyed — "scene data goes through `useScene`, editor state goes elsewhere" — is now codified here as Invariants 1 and 2.

## 4.10 Persistence

What survives a page refresh, what survives a JSON export/import, and what does not.

### `useScene` — full persistence (no work on our side)

Pascal already persists `useScene` to IndexedDB. CFS scene nodes ride along automatically. Restart the app, the scene comes back, including every `cfs_*` node defined in section 3. The JSON exporter and importer (build slice 9) extend this with an explicit serialization path — the schemas already support round-trip per the worked example in section 3.11.

### `useCFS` — partial persistence to `localStorage`

The store as a whole is in-memory. A small allowlist of fields persists to `localStorage` because they are per-user preferences that should survive across sessions:

| Field | Why persisted | Key |
|---|---|---|
| `unitsDisplay` | User preference; not project-specific | `aacsteel.unitsDisplay` |
| `preferredHeaderType` | Seed value for new projects; user preference | `aacsteel.preferredHeaderType` |
| `activeLibraryId` | The user's chosen catalog; survives refresh so they don't re-pick | `aacsteel.activeLibraryId` |

Implementation: a small `persist` middleware on the Zustand store, scoped to the three keys. Pseudo-code:

```typescript
const useCFS = create<CFSStore>()(
  persist(
    (set, get) => ({ /* full store */ }),
    {
      name: 'aacsteel.cfs',
      partialize: (s) => ({
        unitsDisplay: s.unitsDisplay,
        preferredHeaderType: s.preferredHeaderType,
        activeLibraryId: s.activeLibraryId,
      }),
    },
  ),
);
```

### `useCFS` — what does not persist

Everything else. Explicitly:

- `isCFSMode` — recomputed on app load from "does the scene have a `CFSProject`?" If yes, toggle on; if no, off. This avoids the awkward state where the toggle is on but no project exists, or off but a project does.
- `inspectorTab`, `hoveredMemberId`, `selectedPanelId` — UI state, gone on refresh.
- `memberLibraries` — re-loaded from `ssma.json` on every app start. The catalog is shipped with the build; persisting it would store a stale copy.
- `isLibraryLoading`, `libraryLoadError` — transient flags, never persisted.

### Storage-quota considerations

The persisted `useCFS` payload is three small fields, well under 1 KB. IndexedDB scene persistence is Pascal's responsibility and its size profile is unchanged by our additions to `useScene` — CFS nodes are small JSON objects, and the largest scene we target (200 walls, full framing) is well within typical IndexedDB quotas.

### Reset behavior

A "reset preferences" command (UI-deferred to v2) would clear the three `localStorage` keys without touching `useScene`. A "clear all data" command would clear both. Neither exists in v1; users who want to reset clear their browser storage.

## 4.11 Selector and hook conventions

Components subscribe to state through *selectors*, not by reading the whole store. This subsection sets the naming, location, and shape conventions.

### Why selectors

Three reasons:

1. **Re-render minimization.** A component that reads `useScene((s) => s)` re-renders on every scene change. A selector returning only the value the component needs re-renders only when that value changes.
2. **Testability.** Selectors are pure functions of state. They can be tested without mounting React.
3. **Refactoring.** When the shape of the store changes, the call sites stay the same; only the selector body updates.

### Naming

| Pattern | Use for | Example |
|---|---|---|
| `use<Thing>()` | React hook returning a value or a small derived object | `useProjectSettings()`, `useActiveLibrary()`, `useIsCFSMode()` |
| `use<Thing>By<Key>(key)` | Hook scoped by an id | `useFramingForWall(wallId)`, `useMembersInPanel(panelId)` |
| `get<Thing>(state)` | Non-hook accessor for use inside systems and event handlers | `getProjectSettings(state)`, `getActiveLibrary(state)` |
| `set<Thing>(value)` | Action exposed by the store | `setCFSMode(true)`, `setActiveLibrary(id)` |
| `update<Thing>(patch)` | Partial-update mutator that goes through `useScene` | `updateProjectSettings({ panelMaxWidth_mm: 4000 })` |

The `use*` hooks live in `packages/cfs/src/store/selectors/`. The `get*` accessors live in the same files, exported alongside their hook counterparts. The `set*` actions are part of `useCFS` (defined in §4.2). The `update*` mutators live with their selectors and call into `useScene`.

### File layout

```
packages/cfs/src/store/
  use-cfs.ts                       # the store definition
  selectors/
    index.ts                       # re-exports
    use-is-cfs-mode.ts
    use-active-library.ts
    use-project-settings.ts        # includes updateProjectSettings
    use-framing-for-wall.ts
    use-members-in-panel.ts
    use-section-by-id.ts
    use-cfs-project.ts             # internal: finds the singleton project
```

One selector per file, matching the §0.5 convention.

### Shallow comparison for object selectors

Selectors that return an object (not a primitive) use Zustand's `useShallow` to avoid re-rendering on identity-but-not-content changes:

```typescript
import { useShallow } from 'zustand/shallow';

export function useFramingForWall(wallId: string) {
  return useScene(
    useShallow((s) => {
      const framing = Object.values(s.nodes).find(
        (n) => n.type === 'cfs_wall_framing' && n.parentId === wallId,
      );
      return framing ?? null;
    }),
  );
}
```

### Memoization for derived collections

Selectors that compute lists (e.g., "all members in panel P") memoize on the inputs they read, typically using a small cache keyed by the input id. The cache is invalidated by Zustand's subscription mechanism — when the inputs change, the cache entry is recomputed on next read. The implementation pattern is finalized in build slice 2 and lives in `packages/cfs/src/store/selectors/lib/memoize.ts`.

### What components do not do

- They do not call `useScene.getState()` synchronously inside render — that bypasses subscriptions and gives a stale value.
- They do not call mutators inside render — mutators have side effects.
- They do not subscribe to the entire store — `useCFS()` (no selector) is forbidden in production code; allowed only in DevTools panels.

## 4.12 Worked example: placing a window

End-to-end trace of the `place window` operation. This is the canonical example a reader can hold in their head; references in build slices 3–7 point back here.

**Initial state:** A Pascal wall exists. A `CFSWallFraming` exists for it with tracks and field studs. The user is in CFS mode with the `OpeningTool` active.

**User action:** Click on the wall at x = 2438 mm, drag to define a 914 mm × 1219 mm window with a 914 mm sill height, release.

**Trace:**

1. **`OpeningTool.onDragEnd` fires.** It computes `positionAlongWall_mm` from the wall and the click position, gathers the rough opening dimensions from the drag, and prepares the opening data.

2. **The tool wraps its mutation in `withBatchedUndo`:**

   ```
   withBatchedUndo('place opening', () => {
     const opening = CFSOpening.parse({
       type: 'cfs_opening',
       id: makeCFSOpeningId(),
       parentId: framingId,
       openingType: 'window',
       positionAlongWall_mm: 2438.4,
       roughDimensions: { width_mm: 914.4, height_mm: 1219.2 },
       sillHeight_mm: 914.4,
       headerTypeOverride: null,
       generatedMemberIds: [],
     });
     useScene.getState().createNode(opening, framingId);
   });
   ```

3. **`createNode` runs:**
   - Inserts the opening into `useScene.nodes`.
   - Adds the opening id to `dirtyNodes`.
   - Per the dirty propagation contract (§4.8, "Create `CFSOpening`"), also adds the parent `CFSWallFraming` id to `dirtyNodes`.
   - Zundo records — but the batch wrapper is paused, so this is staged, not committed.

4. **Next `useFrame` tick.** `CFSFramingSystem` runs:
   - Iterates `dirtyNodes`.
   - Sees the framing id, processes it.
   - Reads the framing node, the parent wall, the project settings (via `getProjectSettings`), the active library, and *all child openings* (one of which is the new window).
   - Computes the new layout: existing tracks unchanged, existing field studs at positions that collide with the opening removed, two king studs added flanking the opening, two jamb studs added inside, one header (default `box`) added across the opening, one sill below, one sill track above the sill, two cripples above the header up to the top track, two cripples below the sill down to the bottom track.
   - Emits the diff as `createNode` and `deleteNode` calls — perhaps eight new members and two removed.
   - Updates the opening's `generatedMemberIds` with the eight new member ids via `updateNode(openingId, { generatedMemberIds: [...] })`.
   - Updates the framing's cached aggregates.
   - Removes the framing id from `dirtyNodes`. Removes the opening id from `dirtyNodes` (it does not have its own opening-specific system in v1; the framing system processes both).

5. **Same `useFrame` tick.** `CFSGeometrySystem` runs:
   - Sees the eight new member ids in `dirtyNodes` (added by `createNode`).
   - For each, reads the member, looks up the section in the active library, builds the C-section polygon, extrudes it along the member axis, and writes the resulting geometry to the registry's `Object3D` for that member.
   - Removes each id from `dirtyNodes`.

6. **Same `useFrame` tick (post-frame).** The batched-undo wrapper's `resume` and history-commit fire. Zundo records exactly one history entry covering the opening creation + the eight member creations + the two member deletions + the opening's `generatedMemberIds` update + the framing's cached-aggregate updates.

7. **Render.** React Three Fiber renders the next frame. The user sees the opening and its surrounding framing in one visual update.

**User action:** Press Cmd-Z.

**Trace:**

1. Pascal's undo handler calls `useScene.temporal.undo()`.
2. Zundo reverts the entire batched step in one operation: opening removed, eight members removed, two members restored, framing aggregates reverted.
3. `dirtyNodes` is repopulated by the revert (every restored / removed node is dirty).
4. Next frame, systems re-process. Geometry meshes for restored field studs are rebuilt from registry-cached state or recomputed; meshes for removed members are unregistered.
5. The user sees the wall as it was before the window placement, in one frame.

**What this example proves:**

- A single user action produces a single undo step despite touching ~12 nodes.
- The mutation flow stays within `useScene` mutators; nothing reaches into `useScene.nodes` directly.
- Editor-local state (`isCFSMode`, `inspectorTab`) is untouched by the operation.
- The dirty-node pattern coordinates the framing system and the geometry system without either knowing about the other.
- Geometry lives on the registry, not in the store.

This is the operational picture every CFS feature in the project conforms to. If a future slice's design does not look like this trace, the design is wrong.

---

## Open items raised by spec slice C

Items surfaced while writing section 4. They are listed here for the appendix, to be resolved in the indicated slice.

1. **`useScene` mutator signatures and Zundo wrapper presence.** §4.7 and §4.9 are written against the §2.5 mutator surface and assume Pascal does *not* provide a `withBatchedUndo` helper out of the box. Build slice 1 must read `packages/core/src/store/use-scene.ts` and Pascal's Zundo setup, confirm the signatures, and either use Pascal's batching helper if one exists or implement `with-batched-undo.ts` per the pseudo-code in §4.9. Section 4 is updated post-slice-1 if the as-built differs.

2. **Cross-store dirty propagation for `setActiveLibrary`.** §4.8 specifies that switching libraries dirties every framing and member in the scene. For large scenes this is a sweep. Build slice 2 should profile this path and, if it materially affects switch-time, introduce a more targeted dirty set (e.g., only nodes whose `sectionId` does not resolve in the new library). The schema and contract do not change; the implementation refines.

3. **Persistence of `unitsDisplay` between projects with different `units` settings.** §4.5 and §4.10 establish that `useCFS.unitsDisplay` is a per-user preference and `CFSProjectSettings.units` is a per-project value, and the user's preference wins for display. The UI question — does the inspector show a one-time hint when a project was authored in different units than the user prefers — is deferred to section 7.

4. **Forms and dirty-state UX.** §4.5 leaves the settings inspector form's dirty-state and confirm/cancel UX to section 7. Spec slice F should reconcile.

5. **Naming consistency: `useCFS` vs. `useCFSStore`.** Pascal uses `useScene` (no Store suffix). This section follows suit with `useCFS`. Build slice 1 should confirm the upstream's most recent naming and, if it has shifted, update the appendix and §4.2.

---

*End of output for spec slice C — state management. Section 4 is complete. Sections 5 through 7 and the appendix sweep are produced by spec slices D through G.*
