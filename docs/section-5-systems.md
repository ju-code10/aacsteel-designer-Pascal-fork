# 5. Systems

This section is the operational contract for every CFS system. Each subsection defines, for one system: which dirty triggers it consumes, which scene nodes it owns, what algorithm it runs, what it writes, what it must not touch, and the test cases it ships with. Build slices 3 through 7 each consume one subsection at kickoff.

The audience is Claude Code reading this section at the start of a build slice. Treat each contract as final unless explicitly noted. If a system needs to do something this section does not authorize, the spec has drifted — fix the spec first, then the code.

> Note on terminology and architecture: this section sits on top of sections 0–4. Pascal patterns (the dirty-node loop, `useFrame`, the registry, the renderer/system split) are defined in section 2 and are not redefined here. Data shapes are defined in section 3 and are referenced by name. Mutation patterns and dirty propagation are defined in section 4 and are referenced by section number. If anything here contradicts sections 0–4, sections 0–4 win and this section must be reconciled in spec slice G.

## 5.0 System contract conventions

Every system in 5.1 through 5.5 follows the same shape, in the same order. The shape exists so that a build slice always finds the same information in the same place.

### The standard subsection layout

1. **Purpose.** One paragraph: what the system exists to do, in plain English.
2. **Owned node types.** The CFS scene-node types whose `dirtyNodes` entries this system consumes and whose mutations it emits. Stated explicitly to make ownership unambiguous and to prevent two systems racing for the same node.
3. **Mount point.** Where the system's React component is mounted in the editor's tree. Always at the editor app level (per §2.4); the precise file is named.
4. **Dirty triggers.** A table mapping incoming dirty events to the action this system takes. Restated against the §4.8 propagation table so the build slice does not have to cross-reference.
5. **Algorithm.** Pseudo-code for the layout, validation, or transformation work. TypeScript-like syntax for math; numbered prose for trigger-and-handle flows. Edge cases enumerated as named subsections under the algorithm.
6. **Outputs.** What the system writes through `useScene` mutators (`createNode`, `updateNode`, `deleteNode`) and what, if anything, it writes to the registry's `Object3D` instances.
7. **What this system must not touch.** An explicit do-not-write list. Catches integration bugs at review time.
8. **Test cases.** A table of the tests the build slice ships with. Each row: a short name, the input, the expected output, and the section-1 or section-3 rule it verifies. Full test code is not in the spec; the build slice writes it.
9. **Performance budget.** Where relevant — frame time, memory, allocation patterns. Stated as a target plus the measurement method.

### Conventions that apply to every system

The following rules are inherited from sections 2 and 4. They are restated once here so each subsection does not have to repeat them.

- **Systems run inside `useFrame`.** They iterate `useScene.getState().dirtyNodes`, filter by the types they own, process matching ids, and **delete each processed id from `dirtyNodes` after the work for that id is complete** (§2.1).
- **Systems write through `useScene` mutators only.** `createNode`, `updateNode`, `deleteNode`. Direct mutation of `useScene.nodes` is forbidden (§4.7, Pattern 5). Geometry on the registry's `Object3D` is mutated directly; that is the one exception, and it applies only to §5.3.
- **Systems return `null` from their React render.** They never own UI (§2.4). Tools, panels, and inspectors are editor-side concerns covered in section 7.
- **Systems read project settings through `getProjectSettings(useScene.getState())`.** Never through a local copy on `useCFS` (§4.5).
- **Systems read the active library through `getActiveLibrary(useCFS.getState())`.** A null return means the library has not loaded; the system must guard and emit no mutations rather than crash (§4.3, failure modes).
- **Every system mutation must be reachable inside the originating user action's batch wrapper.** When a tool wraps its mutation in `withBatchedUndo` (§4.9, Invariant 3), the system-driven follow-up mutations on the next frame are part of the same Zundo step. The mechanism for keeping the batch open across the frame boundary is defined in §4.9; systems do not implement it themselves, but they must not break it (e.g., by spawning async work that mutates the scene after the batch has committed).

### Forbidden patterns, summarized

- Iterating over all nodes of a type every frame instead of `dirtyNodes`. Defeats the entire architecture.
- Writing to `useCFS` from a system. `useCFS` is editor input; systems produce scene output.
- Holding scene data on a system's React state or refs. Systems are stateless; their state is in `useScene` and on the registry.
- Skipping `Schema.parse` on a `createNode`. Bypasses validation; admits malformed nodes that crash other systems.
- Mutating the renderer's `Object3D` for a node that this system does not own. Cross-system geometry stomping.

## 5.1 `CFSFramingSystem`

The first and largest system. Owns the layout of every CFS member on every wall — tracks, field studs, chord studs, and the full opening-framing pattern (kings, jambs, headers, sills, sill tracks, cripples). Consolidates the work formerly split across separate "framing" and "opening" systems into a single owner of `CFSWallFraming` membership.

> Architectural note: the file layout in §2.9 lists `framing-system.tsx` and `opening-system.tsx` as separate files. Section 5 consolidates them into one system in one file (`framing-system.tsx`). Reasoning: opening framing requires whole-wall context (coalescing king studs with chord studs, removing field studs that fall inside an opening, sharing kings between adjacent openings) and splitting the work across two systems creates a coordination problem with no benefit. The §2.9 file list is reconciled in spec slice G.

Build slices 3 and 4 implement this system. Slice 3 ships the plain-wall portion (§5.1 algorithm steps 1–4 below); slice 4 extends it with the opening-framing portion (steps 5–8). The contract here is the union of both slices.

### Purpose

For every Pascal `Wall` that has a `CFSWallFraming`, materialize the set of `CFSMember` nodes that the wall requires given its length, height, the project framing settings, and any `CFSOpening` children. Keep that set in sync with the wall, the framing config, and the openings as any of those change.

### Owned node types

This system reads from and writes to:

- `CFSWallFraming` — reads its config; updates its cached aggregates.
- `CFSMember` — creates, updates, and deletes.
- `CFSOpening` — reads to compute opening framing; updates `generatedMemberIds` after generating.

It does **not** own:

- `CFSPanel` — owned by §5.5.
- `CFSServiceHole` — owned by §5.4.
- Pascal `Wall` — upstream; never written to.
- Member geometry on the registry — owned by §5.3.

### Mount point

`apps/editor/cfs/systems/CFSFramingSystem.tsx`, mounted at the editor app root inside the existing systems group, gated on `isCFSMode` so it is not running when the user has CFS mode off.

### Dirty triggers

| Incoming dirty event (§4.8) | Action |
|---|---|
| Pascal `Wall` becomes dirty | If the wall has no `CFSWallFraming` child, create one (in CFS mode only). Then mark that framing dirty for processing this frame. |
| `CFSWallFraming` becomes dirty | Run the full layout algorithm for that framing. |
| `CFSOpening` becomes dirty (any field) | Mark the parent framing dirty; do not process the opening directly. The framing pass picks up all openings together. |
| `CFSProject.settings` becomes dirty | Per §4.8, every framing in the scene was already added to `dirtyNodes`. Process each as normal. |
| `CFSMember` becomes dirty | This system does not consume member dirty events. Members are dirtied by this system's writes; §5.3 consumes them for geometry. |

The system clears the framing id from `dirtyNodes` at the end of step 8. It does **not** clear member or opening ids it dirties as a side effect of its writes — those are consumed downstream.

### Algorithm

Inputs to one framing pass, gathered at the start:

```typescript
const wall          = scene.nodes[framing.parentId];          // Pascal Wall
const settings      = getProjectSettings(scene);              // §4.5
const library       = getActiveLibrary(useCFS.getState());    // §4.3
const openings      = childrenOfType(scene, framing.id, 'cfs_opening');
const existingMembers = childrenOfType(scene, framing.id, 'cfs_member');
```

If `library` is null, abort the pass and emit no mutations. The inspector surfaces the "no library loaded" error (§4.3); silent failure here is wrong but crashing is worse.

The wall's local frame: x runs along the wall's length from start to end, y is vertical, z is wall thickness (unused by framing math; used only by §5.3 when placing the cross-section). Positions in `CFSMember.start` and `CFSMember.end` are world-space, computed by transforming local (x, y, 0) through the wall's transform.

The pass produces a `desiredMembers: CFSMember[]` list, then diffs it against `existingMembers` and emits `createNode`, `updateNode`, `deleteNode` calls. The diff key is `(role, position-along-wall, vertical-extent)` — two members at the same position with the same role and the same vertical span are the same member, and an `updateNode` updates the existing one rather than churning the id.

The eight steps:

#### Step 1 — Resolve effective configuration

```typescript
const effective = {
  studSpacing_mm:    framing.studSpacing_mm    ?? settings.defaultStudSpacing_mm,
  studSectionId:     framing.studSectionId     ?? settings.defaultStudSection,
  trackSectionId:    framing.trackSectionId    ?? settings.defaultTrackSection,
  defaultHeaderType: framing.defaultHeaderType ?? settings.defaultHeaderType,
  wallHeight_mm:     framing.wallHeight_mm     ?? settings.wallHeight_mm,
};
const wallLength_mm  = wallLengthFromPascalWall(wall);
const studSection    = library.sections.find(s => s.id === effective.studSectionId);
const trackSection   = library.sections.find(s => s.id === effective.trackSectionId);
```

If either section lookup is null, abort the pass and surface an "unresolved section" error on the framing's cached aggregates so the inspector can display it. This matches the JSON-import fallback behavior described in §4.4.

#### Step 2 — Generate tracks

Tracks span the full wall length. Two members:

```typescript
desiredMembers.push(makeMember({
  role: 'top-track',
  sectionId: effective.trackSectionId,
  start: localToWorld(wall, { x_mm: 0,            y_mm: effective.wallHeight_mm, z_mm: 0 }),
  end:   localToWorld(wall, { x_mm: wallLength_mm, y_mm: effective.wallHeight_mm, z_mm: 0 }),
}));
desiredMembers.push(makeMember({
  role: 'bottom-track',
  sectionId: effective.trackSectionId,
  start: localToWorld(wall, { x_mm: 0,            y_mm: 0, z_mm: 0 }),
  end:   localToWorld(wall, { x_mm: wallLength_mm, y_mm: 0, z_mm: 0 }),
}));
```

Tracks are split at panel breaks during step 9 of §5.5, not here. From this system's perspective, each wall has exactly one top track and one bottom track of the wall's full length.

#### Step 3 — Generate chord studs

One chord stud at each end of the wall:

```typescript
for (const x of [0, wallLength_mm]) {
  desiredMembers.push(makeMember({
    role: 'chord-stud',
    sectionId: effective.studSectionId,
    start: localToWorld(wall, { x_mm: x, y_mm: 0, z_mm: 0 }),
    end:   localToWorld(wall, { x_mm: x, y_mm: effective.wallHeight_mm, z_mm: 0 }),
  }));
}
```

For v1, every wall end gets a single (non-built-up) chord stud. Built-up chords (back-to-back or boxed) are deferred to v2. Corner sharing — where two walls meet and the chord stud belongs to one of them — is handled by the rule that whichever wall was created first owns the chord stud at the shared corner; the other wall's chord stud at that position is suppressed. This rule is implemented as: before emitting a chord stud at position `(x, y_mm: 0..wallHeight)`, check whether another `CFSWallFraming` has already emitted a chord stud at the same world position; if so, skip. The corner-sharing detection lives in `packages/cfs/src/lib/corner-detect.ts`.

#### Step 4 — Generate field studs

Field studs at `effective.studSpacing_mm` on center along the wall, between the chord studs, with the omission rule from §1.4:

```typescript
const candidates: number[] = [];
for (let x = effective.studSpacing_mm; x < wallLength_mm; x += effective.studSpacing_mm) {
  candidates.push(x);
}
// §1.4: omit the last field stud if its distance to the wall end is less than
// half the spacing, because the chord stud at the wall end already covers the load.
const half = effective.studSpacing_mm / 2;
const lastCandidate = candidates[candidates.length - 1];
if (lastCandidate !== undefined && wallLength_mm - lastCandidate < half) {
  candidates.pop();
}
for (const x of candidates) {
  desiredMembers.push(makeMember({
    role: 'stud',
    sectionId: effective.studSectionId,
    start: localToWorld(wall, { x_mm: x, y_mm: 0, z_mm: 0 }),
    end:   localToWorld(wall, { x_mm: x, y_mm: effective.wallHeight_mm, z_mm: 0 }),
  }));
}
```

After step 4, the desired-members list is the plain-wall layout. Build slice 3 stops here.

#### Step 5 — For each opening, compute opening-framing positions

For each `CFSOpening` child of this framing:

```typescript
const left_mm    = opening.positionAlongWall_mm;
const right_mm   = left_mm + opening.roughDimensions.width_mm;
const top_mm     = (opening.openingType === 'door')
                     ? opening.roughDimensions.height_mm
                     : (opening.sillHeight_mm! + opening.roughDimensions.height_mm);
const bottom_mm  = (opening.openingType === 'window') ? opening.sillHeight_mm! : 0;

if (right_mm > wallLength_mm) {
  // Reject: opening wider than wall. Surface in inspector; emit no framing for this opening.
  flagOpeningInvalid(opening.id, 'opening exceeds wall length');
  continue;
}
```

The kings sit at `left_mm` and `right_mm` (the rough opening edges). The jambs sit immediately inboard of the kings, offset by the king's flange thickness — for v1, the offset is the section's `flangeWidth_mm`. The header spans between the inside faces of the jambs at `top_mm`. The sill spans the same horizontal extent at `bottom_mm` for windows.

#### Step 6 — Emit opening members

```typescript
const headerType = opening.headerTypeOverride ?? effective.defaultHeaderType;
const flange     = studSection.properties.flangeWidth_mm;

// Kings: full-height at the rough-opening edges.
desiredMembers.push(makeMember({
  role: 'king-stud',
  sectionId: effective.studSectionId,
  start: localToWorld(wall, { x_mm: left_mm,  y_mm: 0,                     z_mm: 0 }),
  end:   localToWorld(wall, { x_mm: left_mm,  y_mm: effective.wallHeight_mm, z_mm: 0 }),
}));
desiredMembers.push(makeMember({
  role: 'king-stud',
  sectionId: effective.studSectionId,
  start: localToWorld(wall, { x_mm: right_mm, y_mm: 0,                     z_mm: 0 }),
  end:   localToWorld(wall, { x_mm: right_mm, y_mm: effective.wallHeight_mm, z_mm: 0 }),
}));

// Jambs: full-height, inboard of kings.
desiredMembers.push(makeMember({
  role: 'jamb-stud',
  sectionId: effective.studSectionId,
  start: localToWorld(wall, { x_mm: left_mm + flange,  y_mm: 0,                     z_mm: 0 }),
  end:   localToWorld(wall, { x_mm: left_mm + flange,  y_mm: effective.wallHeight_mm, z_mm: 0 }),
}));
desiredMembers.push(makeMember({
  role: 'jamb-stud',
  sectionId: effective.studSectionId,
  start: localToWorld(wall, { x_mm: right_mm - flange, y_mm: 0,                     z_mm: 0 }),
  end:   localToWorld(wall, { x_mm: right_mm - flange, y_mm: effective.wallHeight_mm, z_mm: 0 }),
}));

// Header: spans between jamb inside faces at top_mm.
desiredMembers.push(makeMember({
  role: 'header',
  sectionId: headerSectionId(headerType, effective.studSectionId, library), // see below
  start: localToWorld(wall, { x_mm: left_mm + flange,  y_mm: top_mm, z_mm: 0 }),
  end:   localToWorld(wall, { x_mm: right_mm - flange, y_mm: top_mm, z_mm: 0 }),
}));

// Cripples above header, at field stud spacing, between jambs.
const crippleAboveStart = left_mm + flange + effective.studSpacing_mm;
for (let x = crippleAboveStart; x < right_mm - flange; x += effective.studSpacing_mm) {
  desiredMembers.push(makeMember({
    role: 'cripple',
    sectionId: effective.studSectionId,
    start: localToWorld(wall, { x_mm: x, y_mm: top_mm,                     z_mm: 0 }),
    end:   localToWorld(wall, { x_mm: x, y_mm: effective.wallHeight_mm,    z_mm: 0 }),
  }));
}

// Window-only: sill, sill track, and below-cripples.
if (opening.openingType === 'window') {
  desiredMembers.push(makeMember({
    role: 'sill',
    sectionId: effective.studSectionId,
    start: localToWorld(wall, { x_mm: left_mm + flange,  y_mm: bottom_mm, z_mm: 0 }),
    end:   localToWorld(wall, { x_mm: right_mm - flange, y_mm: bottom_mm, z_mm: 0 }),
  }));
  desiredMembers.push(makeMember({
    role: 'sill-track',
    sectionId: effective.trackSectionId,
    start: localToWorld(wall, { x_mm: left_mm + flange,  y_mm: bottom_mm, z_mm: 0 }),
    end:   localToWorld(wall, { x_mm: right_mm - flange, y_mm: bottom_mm, z_mm: 0 }),
  }));
  for (let x = crippleAboveStart; x < right_mm - flange; x += effective.studSpacing_mm) {
    desiredMembers.push(makeMember({
      role: 'cripple',
      sectionId: effective.studSectionId,
      start: localToWorld(wall, { x_mm: x, y_mm: 0,         z_mm: 0 }),
      end:   localToWorld(wall, { x_mm: x, y_mm: bottom_mm, z_mm: 0 }),
    }));
  }
}
```

`headerSectionId(headerType, studSectionId, library)` resolves the header's section. For `box`, `back-to-back`, and `L-header`, the header is built from the same section family as the studs (a 362-series stud framing typically uses 362-series for the header); v1 returns `effective.studSectionId` for these types. `single-track` returns `effective.trackSectionId`. `proprietary` returns `effective.studSectionId` for v1, with a TODO note that proprietary sections require v2 library extensions to model correctly. Built-up assemblies (the box header is conceptually two C-sections plus two tracks) are represented in v1 as a single header member with `headerType` recorded on the parent opening; the multi-piece geometry is rendered by §5.3 as a single beam, with the multi-piece BOM consequences handled by §6 (slice 8). Full sub-member modeling of built-up headers is deferred to v2.

#### Step 7 — Apply role-coalescing

Before emitting the diff, walk the desired-members list and apply the priority rules from §1.4. Two members at the same position-along-wall (within a 1 mm tolerance) collide; the higher-priority role wins:

```typescript
const priority: Record<CFSMemberRole, number> = {
  'chord-stud': 4,
  'king-stud':  3,
  'jamb-stud':  2,
  'stud':       1,
  // Tracks, headers, sills, sill-tracks, cripples never collide on x with
  // each other or with vertical members at the same position-along-wall;
  // they are not in the priority table.
  'top-track': 0, 'bottom-track': 0, 'header': 0, 'sill': 0, 'sill-track': 0, 'cripple': 0,
};
const TOLERANCE_MM = 1;

function coalesce(members: CFSMember[]): CFSMember[] {
  const verticals = members.filter(m =>
    ['chord-stud', 'king-stud', 'jamb-stud', 'stud'].includes(m.role)
  );
  const others = members.filter(m =>
    !['chord-stud', 'king-stud', 'jamb-stud', 'stud'].includes(m.role)
  );
  const byX = new Map<number, CFSMember>();
  for (const m of verticals) {
    const xKey = roundTo(positionAlongWall(m), TOLERANCE_MM);
    const existing = byX.get(xKey);
    if (!existing || priority[m.role] > priority[existing.role]) {
      byX.set(xKey, m);
    }
  }
  return [...byX.values(), ...others];
}
```

This single pass resolves every coalescing case in §1.4 and §1.4's worked example: a king stud at the wall edge collapses with the chord stud (king wins by priority — except priority makes chord win, see worked example below). Two adjacent openings whose kings meet share a single king. A field stud that falls under a king is removed.

**Worked coalescing — opening at wall edge.** §1.4 says "the chord stud and king stud collapse into one member, given the role of king (the structurally more demanding role)." The priority table above gives chord the higher number, which would make chord win. This is intentional: in v1 we coalesce **toward the chord** because the chord is what the adjacent wall expects to find at the shared corner. The structural-role question — does a chord-with-king-duty need a different section than a chord — is deferred to slice 12. The §1.4 wording is reconciled in spec slice G; this section commits to chord-wins and surfaces the role conflict on the framing's cached aggregates so the inspector can flag "this chord also serves as a king" for the user's awareness.

#### Step 8 — Diff and emit

```typescript
const desired = coalesce(desiredMembers);
const diff    = diffMembers(existingMembers, desired);

withinDirtyPass(() => {
  for (const m of diff.toCreate) useScene.getState().createNode(m, framing.id);
  for (const m of diff.toUpdate) useScene.getState().updateNode(m.id, m.changes);
  for (const id of diff.toDelete) useScene.getState().deleteNode(id);

  // Update each opening's generatedMemberIds with the kings/jambs/header/sill/cripples it produced.
  for (const opening of openings) {
    const generated = desired
      .filter(m => isOpeningFramingFor(m, opening))
      .map(m => m.id);
    useScene.getState().updateNode(opening.id, { generatedMemberIds: generated });
  }

  // Update the framing's cached aggregates.
  const totalWeight_kg = sumWeights(desired, library);
  useScene.getState().updateNode(framing.id, {
    cachedTotalWeight_kg: totalWeight_kg,
    cachedMemberCount:    desired.length,
  });
});

scene.dirtyNodes.delete(framing.id);
```

`diffMembers` matches existing members to desired members by `(role, positionAlongWall, verticalSpan)` rounded to 1 mm tolerance. Matched pairs become `toUpdate` only if any field differs; unmatched existing become `toDelete`; unmatched desired become `toCreate`. This minimizes id churn so the registry's `Object3D` instances persist across re-layouts when the actual geometry has not changed — important for §5.3's instancing strategy and for keeping selection stable across edits.

### Edge cases

**Wall shorter than one stud spacing.** Steps 3 emits two chord studs; step 4's loop produces no candidates. Result: a wall with only tracks and chord studs. Allowed.

**Wall length is exactly a multiple of the stud spacing.** The last candidate from step 4 falls at `wallLength_mm - studSpacing_mm`; its distance to the wall end is exactly `studSpacing_mm`, which is more than half. The candidate is kept. If the user sets a spacing that produces a candidate exactly at `wallLength_mm`, it is also dropped by the half-spacing rule (distance to end is zero). The boundary case `distance == half` is included (kept) — see test FRM-04.

**Opening exactly at the wall edge.** `left_mm === 0` produces a king at `x = 0` colliding with the chord stud at `x = 0`. Coalesce per step 7: chord wins; the wall-edge king is removed. `flangeWidth_mm` is added inboard for the jamb, which is then a normal interior member.

**Two openings whose kings would collide.** Opening A's right king at `xA_right` and opening B's left king at `xB_left`, where `xA_right === xB_left` (adjacent openings with no gap). Coalesce: the two kings collapse to one. Both openings' `generatedMemberIds` lists include the shared king's id; the deletion-cascade rule from §3.12 must handle the case where deleting one opening would otherwise orphan a king still claimed by the other — see test FRM-12.

**Opening wider than the wall.** Step 5's check rejects the opening; no opening framing is emitted for it; the wall is framed as if the opening did not exist. The opening is flagged invalid via `flagOpeningInvalid` (a write to a non-undoable side-channel on `useCFS.libraryLoadError`-style state — the field name is finalized in slice 4, the contract here is "the user gets an inspector-visible reason"). Test FRM-13 covers this.

**Opening crossing a panel break.** Not this system's concern. Panelization (§5.5) treats opening edges as forbidden break zones, so this case cannot arise as long as panelization runs after framing. If a project's settings change reduces `panelMaxWidth_mm` below the gap between openings' allowed break zones, panelization fails with a documented error (§5.5).

**Wall length changes mid-frame.** The wall's dirty event triggers a fresh framing pass next frame. `existingMembers` is read fresh; the diff handles arbitrarily large changes (e.g., a wall doubling in length) without special casing.

### Outputs

Through `useScene` mutators:

- `createNode(member, framingId)` for each new member.
- `updateNode(memberId, changes)` for each member whose position, role, or section changed.
- `deleteNode(memberId)` for each member no longer in the desired layout.
- `updateNode(openingId, { generatedMemberIds: [...] })` for each opening this pass touched.
- `updateNode(framingId, { cachedTotalWeight_kg, cachedMemberCount })` once per pass.

Nothing is written to the registry by this system. All visual changes flow from the dirty member ids that §5.3 will consume on the same frame.

### What this system must not touch

- `CFSPanel` nodes or `CFSMember.panelId` — owned by §5.5.
- `CFSServiceHole` nodes or member geometry — owned by §5.4 and §5.3.
- Pascal `Wall` nodes — upstream.
- The registry's `Object3D` for any node.
- `useCFS` of any kind.

### Test cases

| Name | Input | Expected | Rule verified |
|---|---|---|---|
| FRM-01 | Plain wall, length 3600 mm, spacing 600 mm | 2 tracks + 2 chord studs + 5 field studs | §1.4 spacing |
| FRM-02 | Plain wall, length 600 mm, spacing 600 mm | 2 tracks + 2 chord studs + 0 field studs | §1.4 half-spacing omit |
| FRM-03 | Plain wall, length 4200 mm, spacing 600 mm | 2 tracks + 2 chord + 6 field studs | §1.4 spacing |
| FRM-04 | Wall 4500 mm, spacing 600 mm — last candidate at 4200, distance to end 300 = exactly half | Last candidate omitted (boundary case) | §1.4 half-spacing rule, inclusive |
| FRM-05 | Canonical wall (§1.2): 3600 mm, 600 mm spacing, door 900×2100 at x=600 | 13 members per §1.2 worked example | §1.2 worked example |
| FRM-06 | Wall 3600 mm with window 900×1200 at x=600, sill 900 | sill, sill-track, below-cripples present | §1.4 window framing |
| FRM-07 | Door at x=0 (wall edge) | King at x=0 coalesces with chord; chord-stud role wins | §5.1 step 7 worked coalescing |
| FRM-08 | Two doors, kings exactly meeting | Single shared king member | §1.4 adjacent openings |
| FRM-09 | Settings change `defaultStudSpacing_mm` 600 → 400 | All framings re-laid out next frame; member counts increase | §4.8 settings dirty propagation |
| FRM-10 | Delete an opening | `generatedMemberIds` consumed by cascade; wall returns to plain layout | §3.12 deletion cascade |
| FRM-11 | Header-type override on opening | Header member's section reflects override, not project default | §3.6 `headerTypeOverride` |
| FRM-12 | Delete one of two adjacent openings sharing a king | Shared king is **not** deleted; remains under the surviving opening's `generatedMemberIds` | §5.1 edge case |
| FRM-13 | Opening wider than wall | Opening framing not emitted; opening flagged invalid; rest of wall frames normally | §5.1 step 5 |
| FRM-14 | Active library switch in `useCFS` | Every framing dirties; layout re-runs against new sections | §4.8 cross-store reactivity |
| FRM-15 | Performance: 100-wall scene, single wall edited | Only the edited wall's framing is processed; other 99 untouched | §2.1 dirty-node pattern |

### Performance budget

- Per-pass cost: `O(stud_count + opening_count)` for layout; `O(existing + desired)` for diff. Both are linear in the wall's content; a typical wall is under 50 members.
- Frame budget: framing pass for one wall under 2 ms on a modern laptop. A scene with 200 walls editing one wall completes in one frame; editing all 200 walls (e.g., a settings change) completes in a single frame on the target hardware budget but is allowed to span 2 frames if needed.
- Allocation: the desired-members list is a fresh array per pass. Member objects are not pooled in v1; if profiling shows allocation pressure, pool in v2.

## 5.2 (consolidated into 5.1)

The Execution Plan's slice 4 ("CFSOpeningTool + openings") and the §2.9 file list both name an opening system. Per the architectural note at the top of §5.1, the opening framing logic is consolidated into `CFSFramingSystem`. There is no separate `CFSOpeningSystem`.

What slice 4 ships, in this organization:

- **Editor-side:** `CFSOpeningTool` at `apps/editor/cfs/components/tools/OpeningTool.tsx` — UI flow for placing an opening on a wall, dragging to size, choosing door/window. Section 7 covers this in detail.
- **Package-side:** the algorithm extensions in §5.1 steps 5–7 (opening framing emission and coalescing).

This subsection number is reserved to keep §5.3, §5.4, §5.5 stable. Future spec revisions that re-split opening logic into its own system should reuse this number.

## 5.3 `CFSGeometrySystem`

Replaces the placeholder boxes that build slice 3 ships with real extruded C, U, and Z cross-sections. Cuts service holes through member webs via CSG. Owns every visual aspect of every CFS member's mesh.

### Purpose

For every `CFSMember` in the scene, materialize a Three.js mesh whose geometry is the member's section profile extruded along its centerline, with any service holes cut through the web. Keep that mesh in sync with the member, its section, and its child holes. Apply role-based materials. Use instancing where it pays.

### Owned node types

- `CFSMember` — reads, including its `start`, `end`, `orientation_deg`, `sectionId`, and `serviceHoleIds`.
- `CFSServiceHole` — reads when the parent member is dirty, to compute CSG cutouts.

It does **not** own the data side of any node — geometry lives entirely on the registry's `Object3D` instances. It writes nothing to `useScene`.

### Mount point

`apps/editor/cfs/systems/CFSGeometrySystem.tsx`, mounted at the editor app root. Runs unconditionally in CFS mode; the no-op fast path is when no member is dirty.

### Dirty triggers

| Incoming dirty event (§4.8) | Action |
|---|---|
| `CFSMember` becomes dirty | Rebuild that member's mesh: base extrusion (cached), then CSG against its current service holes. Apply role material. |
| `CFSServiceHole` becomes dirty | Mark the parent `CFSMember` dirty (this system does the marking, immediately, as it consumes the hole's dirty event). The member's geometry pass next handles the CSG. |

The system clears each member id and each hole id from `dirtyNodes` after processing.

### Algorithm

Three layers, applied per dirty member:

#### Layer 1 — Cross-section polygon

Built from `section.properties` in 2D, oriented so the web is along the local Y axis and the flanges open toward local +Z. The polygon is constructed once per unique `(sectionId, orientation_deg)` pair and cached in `packages/cfs/src/lib/section-polygon.ts`.

```typescript
function sectionPolygon(p: CFSSectionProperties): Vector2[] {
  const { shape, webDepth_mm: D, flangeWidth_mm: B, lipLength_mm: L, thickness_mm: t, cornerRadius_mm: r } = p;
  switch (shape) {
    case 'C':   return cChannelPolygon(D, B, L, t, r);
    case 'U':   return uChannelPolygon(D, B, t, r);     // lip ignored; U has no lips
    case 'Z':   return zSectionPolygon(D, B, L, t, r);
    case 'HAT': return hatPolygon(D, B, t, r);          // v2; throw 'unsupported in v1' for now
  }
}
```

The polygon is a closed outline — the steel cross-section's outer perimeter and the corresponding inner perimeter, joined as a single non-self-intersecting loop. The thickness `t` is what gives the cross-section its 2D area; the polygon is not zero-thickness. Corner radii are approximated by short arcs of 4 segments each in v1; visually indistinguishable from true arcs at typical zoom levels.

Lipped channels (C, Z) include the lip return as part of the outer polygon. Unlipped channels (U) skip the lip return. Hat sections (HAT) are recognized in the schema but throw at runtime in v1 — the SSMA library v1 ships does not include hat sections, so the path is not exercised.

#### Layer 2 — Extrusion along member axis

The polygon is extruded from `member.start` to `member.end`, producing a Three.js `BufferGeometry`. The extrusion direction is `(end - start).normalize()`. The cross-section is oriented perpendicular to that direction, with its local Y axis aligned to world Y for vertical members (studs, kings, jambs, chords, cripples) and aligned to world Y for horizontal members (tracks, headers, sills) — the orientation is what keeps the flanges horizontal on a stud and vertical on a track.

`member.orientation_deg` rotates the cross-section about the member's axis. Default 0 means flanges horizontal for studs; 90 would turn the flanges vertical. v1 does not expose orientation in the UI; it is set by the framing system per role and respected by the geometry system.

The base extrusion is cached. The cache key is `(sectionId, length_mm rounded to 1 mm, orientation_deg rounded to 1 deg)`. Cache value is a cloneable `BufferGeometry`. Cache lookup is the first thing the layer 2 step does; cache miss builds and stores.

```typescript
function baseExtrusion(member: CFSMember, library: CFSMemberLibrary): BufferGeometry {
  const length = cfsMemberLength_mm(member);
  const key = cacheKey(member.sectionId, length, member.orientation_deg);
  if (extrusionCache.has(key)) return extrusionCache.get(key)!.clone();
  const section = library.sections.find(s => s.id === member.sectionId)!;
  const polygon = sectionPolygon(section.properties);
  const geom    = extrudeAlongAxis(polygon, length, member.orientation_deg);
  extrusionCache.set(key, geom);
  return geom.clone();
}
```

This cache is the answer to slice 5's performance question. A 200-wall scene with 5,000 stud-like members and ~12 unique lengths produces ~12 * (number of unique sections) cached extrusions. Memory cost is bounded; build time is paid once.

#### Layer 3 — Service-hole CSG

If the member has service holes, subtract a hole geometry per hole from the base extrusion using the `three-bvh-csg` library (per §2.10). For the v1 contract, CSG runs only on members that have at least one service hole; members without holes use the base extrusion directly.

```typescript
function applyServiceHoles(base: BufferGeometry, member: CFSMember, scene: SceneState): BufferGeometry {
  if (member.serviceHoleIds.length === 0) return base;
  const holes = member.serviceHoleIds
    .map(id => scene.nodes[id] as CFSServiceHole)
    .filter(Boolean);
  if (holes.length === 0) return base;
  let result = brushFromGeometry(base);
  for (const hole of holes) {
    const cutter = brushFromHole(member, hole);  // a cylinder (round) or rounded-rectangle prism (oblong)
    result = csgEvaluator.evaluate(result, cutter, SUBTRACTION);
  }
  return geometryFromBrush(result);
}
```

The cutter for a round hole is a cylinder of radius `hole.diameter_mm / 2` and length equal to twice the section's flange width (so it cuts cleanly through the web regardless of orientation). The cutter for an oblong hole is a rounded-rectangle prism of `oblongLength_mm × diameter_mm`. Cutter axis is perpendicular to the member's web — i.e., perpendicular to the extrusion axis and parallel to the section's local Z.

CSG re-applies on every dirty pass for members that have holes. Layer 1 (polygon) and layer 2 (base extrusion) are cached and almost always hit. Layer 3 is the only expensive step, and it scales with the number of holes on the dirty member, not the scene.

#### Materials

Materials are cached by role. v1 uses `MeshStandardMaterial` with metallic 0.9 and roughness 0.6 to suggest galvanized steel; the color is the role color from §1.2's worked example (tracks gray, studs blue, end studs dark blue, opening members tinted by role). The full role-to-color table is finalized in section 7; this system reads from a `roleMaterials.ts` constant file.

The material assignment is applied to the mesh after geometry is built. Material instances are shared across members of the same role — there are at most 10 material instances in the scene (one per `CFSMemberRole`).

#### Instancing strategy

For field studs only, an additional optimization: per wall, group field studs by section and orientation, build a single `InstancedMesh` whose instance matrices place each stud at its `(start, end)`. This collapses the typical hundreds of field studs in a building down to a handful of `InstancedMesh` draw calls.

The trigger to rebuild a wall's instanced field-stud mesh is any `CFSMember` with role `'stud'` and parent equal to that wall's framing being dirty. The system rebuilds the entire instanced mesh for that wall — instancing rebuild is fast (a single buffer update per instance count), faster than incremental update.

Non-field-stud members (kings, jambs, chord studs, headers, sills, sill tracks, cripples, tracks) do **not** use instancing in v1. They are individual `Mesh` instances. Reasoning: they are few (low single digits per opening, two per wall for tracks), they vary in length far more than field studs, and they often carry service holes (so their geometry is per-instance unique anyway).

### Outputs

To the registry's `Object3D` for each processed member:

- `mesh.geometry` is replaced with the freshly built `BufferGeometry` (or the instanced equivalent for field studs).
- `mesh.material` is set to the role-shared material.
- `mesh.position`, `mesh.quaternion` are set to place the mesh at `(start + end) / 2` oriented along `(end - start)`.

Nothing is written to `useScene`. Members do not store their geometry; the geometry is regenerated from the data on every dirty pass.

### What this system must not touch

- `CFSMember` data — it reads only.
- `CFSServiceHole` data — it reads only. Compliance verdicts are written by §5.4.
- Pascal scene-graph nodes, walls, slabs.
- Layout decisions — positions come from §5.1, not from here.

### Test cases

| Name | Input | Expected | Rule verified |
|---|---|---|---|
| GEO-01 | Single C-section stud, 2743 mm long | Polygon has correct web depth, flange width, lip length within 0.1 mm tolerance | §3.1 `CFSSectionProperties` |
| GEO-02 | Single U-section track | Polygon has no lip return | §1.3 U has no lips |
| GEO-03 | Z-section member | Z polygon: flanges go opposite directions | §1.3 Z shape |
| GEO-04 | HAT section requested | Throws 'unsupported in v1'; logs an error; member rendered with placeholder box | §5.3 layer 1 |
| GEO-05 | 5,000 field studs of one section | Single `InstancedMesh` per wall; total draw calls ≤ 50 for a 50-wall scene | §5.3 instancing |
| GEO-06 | Add one service hole to a stud | Hole appears as a clean cylindrical cut; geometry valid (no degenerate triangles) | §5.3 layer 3 |
| GEO-07 | Two service holes 50 mm apart on same stud | Both cuts present; geometry valid | §5.3 layer 3 |
| GEO-08 | Oblong service hole | Cut is a rounded-rectangle slot, axis perpendicular to web | §3.8 oblong shape |
| GEO-09 | Member dirty without hole change | Geometry rebuilt; CSG step skipped (member has no holes) | §5.3 fast path |
| GEO-10 | Section change on a stud | Cache miss; new extrusion built and cached; geometry reflects new section | §5.3 cache key |
| GEO-11 | Length change of 1 stud | Cache hit if length rounds to same key; otherwise miss and rebuild | §5.3 cache key |
| GEO-12 | 200-wall scene, idle | Frame rate ≥ 60 FPS measured by Stats.js | §5.3 perf budget |
| GEO-13 | 200-wall scene, edit one wall | Frame rate ≥ 60 FPS during edit; only edited wall's members rebuild | §2.1 dirty-node, §5.3 perf |

### Performance budget

- Idle scene (no dirty members): system early-returns; cost is one `dirtyNodes` iteration over an empty filtered set. Sub-microsecond.
- Single-member dirty pass without holes: cache hit + clone + transform. Target under 0.5 ms per member.
- Single-member dirty pass with N holes: cache hit + clone + N CSG subtractions. Each subtraction with `three-bvh-csg` is sub-millisecond on hundreds-of-tri meshes; target under 5 ms per member with 10 holes.
- 200-wall, ~5,000-member scene: ≥ 60 FPS at idle and during typical single-wall edits. Measured via Stats.js. Verified in test GEO-13.
- Memory: extrusion cache bounded by `(unique sections) × (unique lengths rounded to 1 mm) × (unique orientations rounded to 1 deg)`. For v1 SSMA (12 sections) and a typical scene (50 unique stud lengths), the cache holds 600 geometries, each ~50 KB — under 30 MB total.

## 5.4 `CFSServiceHoleSystem`

Validates every service hole against placement rules and writes the verdict to `CFSServiceHole.compliance`. Drives the green/red badges in the inspector and the tooltips.

### Purpose

For every `CFSServiceHole` in the scene, run the AISI placement validator against the hole, the parent member's geometry, the parent member's other holes, and the section's mill pre-punch pattern. Write the resulting `CFSComplianceVerdict` (§3.1) to the hole. Re-run when any of those inputs change.

### Owned node types

- `CFSServiceHole` — reads and updates `compliance`.
- `CFSMember` — reads to get the member's section and length; never written.

### Mount point

`apps/editor/cfs/systems/CFSServiceHoleSystem.tsx`. Mounted at the editor app root.

### Dirty triggers

| Incoming dirty event | Action |
|---|---|
| `CFSServiceHole` becomes dirty (§4.8) | Validate this hole. Update its `compliance`. |
| `CFSMember` becomes dirty | If the member length changed, every hole on it must re-validate (the 305 mm rule depends on member length). The system marks each child hole dirty for the next frame. |
| `CFSServiceHole` is created | Same as "dirty" — runs the validator on the new hole. |

The system does not consume `CFSWallFraming` dirty events; framing changes that affect hole positions on members would already have changed the hole's parent member's length and triggered re-validation through that path.

### Algorithm

The validator is a pure function:

```typescript
function validateServiceHole(
  hole: CFSServiceHole,
  member: CFSMember,
  section: CFSSection,
  siblingHoles: CFSServiceHole[],   // other holes on the same member
  millPrePunches: PrePunch[],       // from section.prePunchPattern (see below)
): CFSComplianceVerdict {
  const reasons: string[] = [];
  const memberLength = cfsMemberLength_mm(member);
  const webDepth     = section.properties.webDepth_mm;

  // Rule R1 — minimum 305 mm from member end (§1.5).
  const distFromStart = hole.positionAlongMember_mm;
  const distFromEnd   = memberLength - hole.positionAlongMember_mm;
  if (distFromStart < 305 || distFromEnd < 305) {
    reasons.push(`hole within 305 mm of member end (AISI S220, paraphrased)`);
  }

  // Rule R2 — maximum hole width as fraction of web flat. v1 uses 0.65 of webDepth as a placeholder.
  // Exact threshold to be confirmed during build slice 6 against current AISI S100/S220.
  const effectiveWidth = hole.shape === 'oblong' ? hole.oblongLength_mm! : hole.diameter_mm;
  if (effectiveWidth > 0.65 * webDepth) {
    reasons.push(`hole width ${effectiveWidth} mm exceeds 65% of web depth ${webDepth} mm`);
  }

  // Rule R3 — minimum spacing between holes (detailer + mill).
  const allHoles = [
    ...siblingHoles.map(h => ({ pos: h.positionAlongMember_mm, len: holeLength(h) })),
    ...millPrePunches.map(p => ({ pos: p.positionAlongMember_mm, len: p.length_mm })),
  ];
  for (const other of allHoles) {
    const minSpacing = 2 * Math.max(holeLength(hole), other.len);  // 2× larger length, placeholder
    const centerDist = Math.abs(hole.positionAlongMember_mm - other.pos);
    if (centerDist > 0 && centerDist < minSpacing) {
      reasons.push(`spacing ${centerDist} mm to adjacent hole < required ${minSpacing} mm`);
    }
  }

  // Rule R4 — stiffener required above threshold.
  if (effectiveWidth > 0.5 * webDepth && !hole.hasStiffener) {
    reasons.push(`hole > 50% web depth requires web stiffener`);
  }

  return {
    status:   reasons.length === 0 ? 'compliant' : 'non-compliant',
    reasons,
    checkedAt: nowIso(),
  };
}
```

The numeric thresholds in R2, R3, and R4 are the v1 placeholders. The exact thresholds and clause citations for the current edition of AISI S100 and S220/S240 are confirmed during build slice 6 implementation, per the open item raised in spec slice A. The validator's *shape* and the four-rule structure are final; the constants are tuned at build time.

`PrePunch` is a small structure on `CFSSection`:

```typescript
type PrePunch = {
  firstPosition_mm: number;
  spacing_mm:       number;
  length_mm:        number;     // typically 102 mm for SSMA stock
  width_mm:         number;     // typically 38 mm
};
```

`section.prePunchPattern` is added to the `CFSSection` schema in §3.3 — this is the one schema gap §5.4 surfaces. Spec slice G adds the field; the `ssma.json` shipped in build slice 2 populates it (38 × 102 mm holes at 610 mm o.c. starting at the standard mill offset).

### Outputs

- `updateNode(holeId, { compliance: verdict })` for each hole this pass validated.

The compliance verdict is written into the hole node, which means it round-trips through JSON export per §3.8's design decision. A reload shows the same badges as the moment of save without re-running the validator. The validator re-runs whenever the hole, its member, or the section's pre-punch pattern changes.

### What this system must not touch

- The hole's geometry — owned by §5.3.
- The member's data or geometry.
- The framing — holes do not affect layout.
- Editor UI — the inspector reads `hole.compliance` and renders the badge; this system does not.

### Test cases

| Name | Input | Expected | Rule verified |
|---|---|---|---|
| HOL-01 | Hole at center of 2743 mm stud, 38 mm diameter | Compliant | §1.5 R1 satisfied |
| HOL-02 | Hole 200 mm from member start | Non-compliant; reason names R1 (305 mm rule) | §1.5 R1 |
| HOL-03 | Hole 305 mm from start (boundary) | Compliant (rule is `< 305`, not `≤`) | §5.4 R1 boundary |
| HOL-04 | Hole 100 mm wide on a 92 mm web | Non-compliant; R2 violated | §5.4 R2 |
| HOL-05 | Three holes spaced 50 mm apart | Middle hole non-compliant; R3 violated | §5.4 R3 |
| HOL-06 | Hole at 60% web depth, no stiffener | Non-compliant; R4 violated | §5.4 R4 |
| HOL-07 | Same hole at 60% web with `hasStiffener: true` | Compliant | §5.4 R4 |
| HOL-08 | Hole 200 mm from a mill pre-punch at the standard pattern | Non-compliant; R3 violated against mill hole | §1.5 mill interaction |
| HOL-09 | Member length change shortens member to 600 mm | Existing center-line hole now within 305 mm of end; re-validates as non-compliant | §5.4 dirty triggers |
| HOL-10 | JSON round-trip with mixed compliant/non-compliant holes | Verdicts identical after import; no re-validation needed | §3.8 compliance round-trip |

### Performance budget

- Per-hole validation: O(siblings + pre-punches) — typically under 10 comparisons. Sub-millisecond per hole.
- Member-length-change cascade: O(holes on that member) re-validations, scheduled across at most 1 frame after the member dirty.
- No allocations beyond the `reasons: string[]` per verdict.

## 5.5 `CFSPanelizationSystem`

Splits walls into shippable panels respecting project-level constraints, forbidden break zones, and any manual breaks the user has placed. Reassigns every member's `panelId`. Drives the per-panel exporters in section 6.

### Purpose

For every `CFSWallFraming` whose wall has accumulated more length, more weight, or more openings than the panel constraints allow, compute a set of `CFSPanel` nodes that partition the wall. Reassign every `CFSMember.panelId` accordingly. Respect any panels the user has manually placed.

### Owned node types

- `CFSPanel` — creates, updates, deletes.
- `CFSMember.panelId` — updates only this field.
- `CFSWallFraming` — reads only; does not write to its config or aggregates (the framing system owns aggregates).

### Mount point

`apps/editor/cfs/systems/CFSPanelizationSystem.tsx`. Mounted at the editor app root.

### Trigger model — different from the other systems

Panelization is **not** automatic on every dirty event. It runs in two cases only:

1. **User-initiated.** The user invokes "Panelize this wall" from the inspector or via the keyboard shortcut. The action wraps `runPanelization(framingId)` in `withBatchedUndo('panelize')` and dirties the framing for this system to consume.
2. **Settings-driven.** When `CFSProject.settings.panelMaxWidth_mm` or `panelMaxWeight_kg` changes (§4.8 dirties every framing), this system re-runs panelization for every framing that has at least one existing panel. Walls with no panels yet are left alone — opting into panelization is a user act.

The `CFSPanelBreakTool` (build slice 7, editor-side) creates a `CFSPanel` with `isManualBreak: true` directly through the user-initiated flow.

| Incoming dirty event | Action |
|---|---|
| `CFSWallFraming` becomes dirty *after* user invoked panelize | Run the panelization algorithm. |
| `CFSWallFraming` becomes dirty due to settings change *and* the framing already has panels | Re-run panelization, preserving manual breaks. |
| Any other `CFSWallFraming` dirty event | This system ignores it. Framing changes that did not invoke panelize do not re-panelize. |

Walls that have never been panelized have all members with `panelId: null`. This is the default state and is acceptable; exporters that require panels (BOM tabs, DXF) prompt the user to panelize first if they encounter a null panelId.

### Algorithm — greedy with explicit tie-breaks

The panelization is greedy left-to-right with explicit tie-breaking. The algorithm:

```typescript
function panelize(framing: CFSWallFraming, scene: SceneState, settings: CFSProjectSettings): CFSPanel[] {
  const wall          = scene.nodes[framing.parentId];
  const wallLength_mm = wallLengthFromPascalWall(wall);
  const members       = childrenOfType(scene, framing.id, 'cfs_member');
  const openings      = childrenOfType(scene, framing.id, 'cfs_opening');
  const manualBreaks  = childrenOfType(scene, framing.id, 'cfs_panel')
                          .filter(p => p.isManualBreak)
                          .flatMap(p => [p.startAlongWall_mm, p.endAlongWall_mm]);

  const forbiddenZones = computeForbiddenZones(openings, wallLength_mm, settings);
  const candidatePositions = [
    0,
    ...manualBreaks,
    wallLength_mm,
  ].sort((a, b) => a - b);

  const panels: PanelDraft[] = [];
  let panelStart_mm = 0;

  while (panelStart_mm < wallLength_mm) {
    const panelEnd_mm = findNextBreak(
      panelStart_mm,
      wallLength_mm,
      members,
      forbiddenZones,
      manualBreaks,
      settings,
    );
    panels.push({ startAlongWall_mm: panelStart_mm, endAlongWall_mm: panelEnd_mm });
    panelStart_mm = panelEnd_mm;
  }

  return materializePanels(panels, framing.id);
}
```

`findNextBreak` is the heart of the algorithm:

```typescript
function findNextBreak(
  start: number,
  wallEnd: number,
  members: CFSMember[],
  forbiddenZones: Interval[],
  manualBreaks: number[],
  settings: CFSProjectSettings,
): number {
  // 1. If a manual break is upcoming and within max-width budget, use it as the break.
  const nextManual = manualBreaks.find(b => b > start && b - start <= settings.panelMaxWidth_mm);
  if (nextManual !== undefined) return nextManual;

  // 2. Otherwise scan member positions from start, stopping when budget is exceeded.
  let widthBudget  = settings.panelMaxWidth_mm;
  let weightBudget = settings.panelMaxWeight_kg;
  let lastSafeBreak = start;
  let runningWeight = 0;

  for (const m of membersInOrder(members, start, wallEnd)) {
    const x = positionAlongWall(m);
    const w = memberWeight(m);

    // If adding this member exceeds either budget, break before it.
    if ((x - start) > widthBudget || (runningWeight + w) > weightBudget) {
      // Break must not fall in a forbidden zone. Walk back from x to find the latest
      // non-forbidden position. If none exists (zone covers the whole region), error.
      const breakPos = latestNonForbiddenPositionBefore(x, lastSafeBreak, forbiddenZones);
      if (breakPos === null) {
        throw new PanelizationError(
          `cannot break wall: forbidden zones cover the region from ${lastSafeBreak} to ${x}`
        );
      }
      // Tie-break: prefer breaks closer to a stud spacing multiple.
      return snapToStudSpacing(breakPos, settings.defaultStudSpacing_mm);
    }
    runningWeight += w;
    if (!isInForbiddenZone(x, forbiddenZones)) lastSafeBreak = x;
  }

  // Reached wall end without exceeding budgets — wall is one panel.
  return wallEnd;
}
```

`computeForbiddenZones` returns an array of `Interval` (start_mm, end_mm) covering:

- Every opening's full horizontal span, plus a small buffer (default `flangeWidth_mm` of the king section) on each side.
- A clearance band at each wall corner of one stud spacing's width (per §1.6).

`snapToStudSpacing` finds the multiple of `studSpacing_mm` nearest to the candidate break position, but only if that multiple is within the candidate's "safe interval" (between `lastSafeBreak` and `x`). Otherwise it returns the unsnapped position.

`materializePanels` converts the `PanelDraft[]` into `CFSPanel` objects with `label = "P-${i+1}"`, `sequenceNumber = i + 1`, `isManualBreak = manualBreaks.includes(panel.startAlongWall_mm) || ...`, and `cachedWeight_kg` / `cachedMemberCount` computed by walking the members within the panel's span.

After panel creation, the system walks every member and reassigns `panelId` based on which panel the member's position falls in. Per §4.8, this reassignment dirties the member only — not the framing, not the panel. Geometry is unchanged.

#### Member splitting at panel breaks

A track or a header that crosses a panel break must be split into two pieces. v1 contract:

- Tracks (`top-track`, `bottom-track`, `sill-track`) are split at every panel break that crosses them. The single track member is replaced by N members, one per panel.
- Headers and sills are **not** split. They are wholly contained within a panel because forbidden zones around openings prevent breaks from crossing them by construction.
- Studs of any role are never split (they are vertical; panel breaks are vertical lines along the wall; verticals never cross verticals).

The split is implemented in a post-pass after `panelId` reassignment:

```typescript
function splitCrossingMembers(panels: CFSPanel[], framing: CFSWallFraming, scene: SceneState): void {
  const tracks = membersOfRoles(scene, framing.id, ['top-track', 'bottom-track', 'sill-track']);
  for (const track of tracks) {
    const crossings = panels
      .map(p => p.endAlongWall_mm)
      .filter(x => x > positionAlongWall(track.start) && x < positionAlongWall(track.end))
      .sort((a, b) => a - b);
    if (crossings.length === 0) continue;
    splitTrackAtPositions(track, crossings, framing, scene);
  }
}
```

`splitTrackAtPositions` deletes the original track and creates N+1 replacement tracks, each spanning one panel's portion of the original. Each replacement gets the corresponding `panelId`.

Re-panelization handles already-split tracks correctly: in the next pass, the system first merges any colinear, same-section, same-role tracks under the same framing back into a single member, then re-splits per the new panel layout. This merge-then-split pattern means the data remains canonical regardless of how many times panelization runs.

### Edge cases

**Wall shorter than `panelMaxWidth_mm` and lighter than `panelMaxWeight_kg`.** Algorithm produces one panel covering the full wall. `panels.length === 1`.

**Wall with a single opening centered.** Forbidden zone covers the opening; algorithm breaks on either side of it if the budget demands. If the budget does not demand a break, no break is forced.

**Manual break inside a forbidden zone.** Rejected at break-tool time; the user sees an error. The panelization algorithm does not need to handle this case because manual breaks are pre-validated.

**Settings change to a `panelMaxWidth_mm` smaller than the smallest non-forbidden gap between forbidden zones.** Throws `PanelizationError`; the inspector surfaces it; the user must either increase max width or move/remove openings. Tested in PAN-09.

**Re-panelization with manual breaks present.** Manual breaks are inviolable. The greedy algorithm uses them as forced break positions. If a manual break is more than `panelMaxWidth_mm` from the previous break, the algorithm warns ("manual break violates max-width") but emits the panel anyway. The user's manual override is respected over the constraint.

**Weight calculation precision.** `memberWeight(m)` uses `cfsMemberLength_mm(m) * section.linearMass_kgPerM`. Section mass is from the library; length is from member endpoints. The result must match a hand calculation within 2% per slice 7's verification check. The 2% accounts for connection hardware, fasteners, and sheathing not modeled in v1.

### Outputs

- `createNode(panel, framingId)` for each new panel.
- `updateNode(panelId, changes)` for each panel whose bounds or aggregates changed.
- `deleteNode(panelId)` for each panel no longer in the layout.
- `updateNode(memberId, { panelId: newPanelId })` for each affected member.
- For split tracks: `deleteNode(originalTrackId)` plus `createNode(newTrack, framingId)` for each piece.

### What this system must not touch

- `CFSWallFraming` config or cached aggregates.
- `CFSMember` fields other than `panelId` (and the lifecycle of split tracks).
- Member geometry — owned by §5.3.
- `CFSOpening` — read only.
- Pascal `Wall`.

### Test cases

| Name | Input | Expected | Rule verified |
|---|---|---|---|
| PAN-01 | Wall 3000 mm, max width 4000 mm, no openings | One panel covering full wall | §5.5 single-panel case |
| PAN-02 | Wall 20 m, max 4 m | 5 panels, color-coded labels P-01 … P-05 | §1.6 panel max width |
| PAN-03 | Wall 12 m with one window centered | Breaks fall on either side of the forbidden zone, not through it | §1.6 forbidden zones |
| PAN-04 | Wall 12 m, manual break placed at 5 m | Break at 5 m honored even if greedy would prefer 4 m | §5.5 manual break override |
| PAN-05 | `panelMaxWidth_mm` change 4000 → 3000 | Existing panelization re-runs; previously 5-panel wall now 7 panels | §4.8 settings cascade |
| PAN-06 | Top track of a 12 m wall with 3 panel breaks | 4 top-track members, one per panel | §5.5 member splitting |
| PAN-07 | Re-panelize after width increase 3000 → 4000 | Tracks merge then re-split; member ids may change but geometry consistent | §5.5 merge-then-split |
| PAN-08 | Wall weight exceeds `panelMaxWeight_kg` before width does | Break placed by weight, not width | §1.6 weight constraint |
| PAN-09 | Two openings spanning > `panelMaxWidth_mm` with no break possible between them | Throws `PanelizationError`; inspector shows reason | §5.5 settings-too-tight error |
| PAN-10 | Hand-calculated weight comparison | Algorithm result within 2% of hand value | §5.5 weight precision |
| PAN-11 | Header in a panel | Header stays whole; not split | §5.5 split rules |
| PAN-12 | `panelId` reassignment | Member dirties; framing does not | §4.8 panel reassignment rule |

### Performance budget

- Per-wall panelization: O(members + openings) for forbidden-zone build; O(members) for the greedy scan; O(panels × tracks) for the splitting pass. All linear; sub-10 ms for any v1 wall.
- Settings change in a 200-wall scene where every wall has panels: each wall's panelization is independent; total ≤ 1 frame on target hardware. Allowed to span 2 frames if the scene is unusually heavy.
- Allocations: panels array, member-index arrays. No pooling in v1.

## 5.6 System interaction matrix

A single-page reference for which system writes which node types and which system reads which node types. Useful for catching integration gaps.

| Node type | Created by | Updated by | Deleted by | Read by |
|---|---|---|---|---|
| `CFSProject` | §4.4 (mode toggle handler) | §4.5 (settings form) | not in v1 | every system, via `getProjectSettings` |
| `CFSWallFraming` | §5.1 (auto on first wall dirty in CFS mode) | §5.1 (cached aggregates) | cascade from wall delete | every system |
| `CFSMember` | §5.1, §5.5 (split tracks) | §5.1 (layout), §5.5 (panelId) | §5.1, §5.5 | §5.3, §5.4, exporters (§6) |
| `CFSOpening` | `OpeningTool` (editor §7) | `OpeningTool`, §5.1 (`generatedMemberIds`) | user (cascades to §5.1) | §5.1, §5.5 (forbidden zones) |
| `CFSPanel` | §5.5 (auto), `PanelBreakTool` (manual) | §5.5 | §5.5 | exporters (§6), inspector |
| `CFSServiceHole` | `ServiceHoleTool` (editor §7) | §5.4 (`compliance`), `ServiceHoleTool` (other fields) | user | §5.3 (CSG), §5.4 |
| `CFSConnection` | not in v1; reserved for §6 (slice 9 implicit) | §6 (slice 9) | cascade from member delete | §6 (slice 9 shop drawings) |

Two integration rules the matrix makes explicit:

- **No node type has two writer-systems for the same field.** `panelId` is written only by §5.5; `compliance` is written only by §5.4; layout fields (`start`, `end`, `role`, `sectionId`) are written only by §5.1 (and by §5.5 for the narrow case of split-track creation). If a future feature needs to write a field already owned, the spec moves the ownership before the code does.
- **Reads cross system boundaries freely.** Any system may read any node. Reading is cheap and creates no coupling beyond a schema dependency.

## 5.7 Cross-system invariants

These properties must hold at the end of every frame in a healthy build. They are runtime-checkable in development mode and are added to `packages/cfs/src/schema/invariants.ts` as extensions of §3.12.

1. **No orphan members.** Every `CFSMember` has a `parentId` resolving to an existing `CFSWallFraming` in `useScene.nodes`.
2. **No duplicate-position members.** No two `CFSMember` nodes under the same framing share the same `(role, positionAlongWall, verticalSpan)` rounded to 1 mm. Detects accidental double-creation by §5.1.
3. **`generatedMemberIds` consistency.** For every `CFSOpening`, every id in `generatedMemberIds` resolves to an existing member with role in `{king-stud, jamb-stud, header, sill, sill-track, cripple}` and parent equal to the opening's parent. Reverse: for every member with role in that set, exactly one opening lists it in `generatedMemberIds`, **except** for shared kings (which may appear in two openings' lists per the §5.1 edge case).
4. **Panel coverage.** When any framing has at least one panel, the union of its panels' `[startAlongWall_mm, endAlongWall_mm]` intervals covers `[0, wallLength_mm]` exactly, with no gaps and no overlaps.
5. **`panelId` consistency.** Every `CFSMember` whose framing has panels has a non-null `panelId` resolving to a panel under the same framing. Members in framings with no panels have `panelId: null`.
6. **Hole positions in bounds.** Every `CFSServiceHole.positionAlongMember_mm` plus its half-width is less than the parent member's length. (Restates §3.12; included here because the runtime checker runs after §5.1 layout changes that could have shortened a member.)
7. **Compliance freshness.** Every `CFSServiceHole.compliance.checkedAt` is no older than the most recent dirty event for the hole or its parent member. Detects a missed re-validation.
8. **No system mutated outside its ownership.** A debug-only check, run by walking the diff of `useScene.nodes` between frames and comparing each changed field's owner against the §5.6 matrix. Production builds skip this check.

These invariants are the runtime reflection of the contracts above. Failing one is a system bug; the runtime checker pinpoints the offender by listing which invariant was violated and on which node id.

---

## Open items raised by spec slice D

Items surfaced while writing section 5. They are listed here for the appendix, to be resolved in the indicated slice.

1. **`CFSSection.prePunchPattern`.** §5.4 needs a `prePunchPattern` field on `CFSSection` (modelling the SSMA mill pre-punch pattern: `firstPosition_mm`, `spacing_mm`, `length_mm`, `width_mm`). Section 3.3 does not currently include this field. Spec slice G adds it; build slice 2's `ssma.json` must include it for every shipped section. Until then, §5.4 reads it as optional and treats absence as "no pre-punches" (the rule R3 mill check is skipped).

2. **AISI clause numbers and exact thresholds.** §5.4's R2 (65% web), R3 (2× length spacing), and R4 (50% stiffener) are placeholders. Build slice 6 confirms the current AISI S100 / S220 / S240 numeric values and clause references; the validator's `reasons` strings then quote exact clauses rather than paraphrases. The validator's *shape* (four rules, returning a `CFSComplianceVerdict`) is final.

3. **Coalescing-direction reconciliation.** §1.4 says the chord+king coalescing produces a king (the more demanding role); §5.1 step 7 implements it as chord-wins-with-an-annotation. Spec slice G reconciles §1.4 to match §5.1, or §5.1 changes to match §1.4. The decision affects whether the wall-edge coalesced member is presented to the user as "chord (also serving as king)" or "king (replacing chord)." §5.1 commits to the former pending reconciliation.

4. **Built-up header sub-member modelling.** §5.1 step 6 represents box, back-to-back, and L-headers as a single `header` member at the spec level, with the `headerType` recorded on the parent opening. The BOM exporter (§6 / slice 8) needs the multi-piece breakdown — two C-sections plus two tracks for a box — and currently has no schema support. Build slice 8 either expands one header into multiple BOM rows via a fixed mapping table from `CFSHeaderType` to component sections, or §3.6 grows a `headerComponents: CFSMemberId[]` field. Decision deferred to spec slice E (§6 contract).

5. **`CFSWallFraming` auto-creation timing in panelization re-runs.** §5.5 says re-panelization triggers when settings change *and* the framing already has panels. The "already has panels" check requires a query that walks `useScene` for child panels. For a 200-wall scene where every wall has panels, this is 200 queries per settings change. If profiling shows it matters, cache "framing has panels" on `CFSWallFraming` as a denormalized boolean. Decision deferred to build slice 7.

6. **Mount-point gating on `isCFSMode`.** §5.0 says systems are gated on `isCFSMode`. §5.3 (geometry) is the only system that has a meaningful idle behavior with CFS mode off — it could keep updating geometry even when invisible, so toggling back on is instant. Or it could skip work and accept a one-frame catch-up. v1 commits to gating (skip work), keeping the rule uniform. Build slice 5 measures the toggle-on latency; if it is user-perceptible, revisit.

7. **§2.9 file-list reconciliation.** §2.9 lists `framing-system.tsx` and `opening-system.tsx` as separate files; §5.1 consolidates them into `framing-system.tsx` only. Spec slice G removes `opening-system.tsx` from the §2.9 list. Editor-side `OpeningTool.tsx` is unaffected.

---

*End of output for spec slice D — systems contracts. Section 5 is complete. Sections 6 and 7 and the appendix sweep are produced by spec slices E through G.*
