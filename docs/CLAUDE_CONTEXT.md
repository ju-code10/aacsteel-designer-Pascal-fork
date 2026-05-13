# Claude Code session context

Project-level notes carried forward across Claude Code CLI sessions. These were originally per-machine auto-memory; they're committed here so any clone on any machine picks them up. The structure mirrors auto-memory conventions: lead with the rule/fact, then **Why** and **How to apply**.

When a fact below conflicts with the current state of the code or `docs/PROJECT_SPEC.md`, trust the live source and update this file rather than acting on stale information.

---

## Repo quirks

The repo originally shipped as an extracted snapshot inside an outer folder named `aacsteel-designer-Pascal-fork-slice-4-cfs-opening-tool/`, with the real working tree nested one level deeper. The outer folder name says "slice-4" but the repo has shipped through Slice 9. `.git` IS initialised inside the nested folder.

**Why:** This was a per-slice working folder provided by the user, not a fresh clone. The naming is historical and stale.

**How to apply:**
- If a Slice 9+ session opens at this path layout, all PROJECT_SPEC.md paths (e.g. `packages/cfs/...`) resolve to the **nested** directory.
- A direct `git clone` of [the GitHub repo](https://github.com/ju-code10/aacsteel-designer-Pascal-fork) gives a clean flat layout — no nesting. That's the normal case going forward.
- **`CLAUDE.md` (this file's sibling at repo root) is the canonical auto-loaded context. There is no `AGENTS.md` — early sessions assumed one existed via a now-broken symlink fallback.**
- `.claude/rules/*.md` are still broken symlinks pointing at `.cursor/rules/*.mdc`. The `.mdc` targets do exist — read them directly.
- The execution-plan PDF lives outside the repo at `C:\Users\Juliano\OneDrive\Documentos\Atomic\AACSteel-Designer Project\plano de execução\AACSteel-Designer_Execution_Plan.pdf` (Windows-host only).
- `node_modules` are not bundled. First-time setup: `bun install` from repo root (~75 s), then `cd packages/cfs && bun run build` before running editor tests so `@pascal-app/cfs` resolves.
- `three-bvh-csg` and `three-mesh-bvh` UMD builds fail under Bun's CJS interop (`"superclass is not a constructor"`). Both `packages/cfs/test-setup.ts` and `apps/editor/test-setup.ts` mock them. Any new Bun-runtime entry point must `--preload ./test-setup.ts`.
- SSMA section IDs in the shipped library are UUIDs, not human-readable. Tests look sections up by the `shape` field.

---

## Slice status

As of 2026-05-13, **Slices 1–9 are code-complete** and pushed to branch `slice-9-from-claude` on the GitHub remote. The app is also hosted in Docker on the user's DGX Spark. v1 is gated on the §4.10 manual checklist + the `v1.0.0` tag — both user-driven, not agent-driven.

**Why:** Final v1 slice per the Execution Plan PDF.

**How to apply:**
- Per `docs/PROJECT_SPEC.md` §0.1, spec changes ship as separate logical commits from code changes. Examples on `slice-9-from-claude`: `aab4c6b` (code) vs `96ebc7d` (spec).
- Test status as of Slice 9 completion: **361 pass / 2 skip / 0 fail across 42 files** (after the post-slice multi-story-framing patch the count is 372). Skips: PDF-07 = manual viewer check; JSON-11 = needs §4.9 batched-undo machinery, carried to v2.
- Known v2 carry-forwards (documented in `docs/section-appendix.md` A.5 "Slice 9 carry-forwards"):
  - Box-header BOM 4× expansion mismatch (framing emits 4 members; §6.1 contract is 1 member, BOM expander explodes to 4 rows)
  - JSON-11 one-undo-step revert of import
  - AISI clause numbers in compliance reasons (Slice 6 carry-over)
  - DXF/PDF per-stud tick marks
  - Three light-theme WCAG contrast failures: `top-track` 2.35:1, `header` 1.96:1, `cripple` 1.66:1 (dark theme passes)
- Pre-existing branding errors in `apps/editor/cfs/systems/CFSPanelOverlay.tsx` lines 67/71 (Pascal `NodeId` branding vs `CFSWallFramingId`) are Slice 7 carry-forward, unrelated to Slice 9 work.

**Slice 9 deliverables (one-line summary):**
- `packages/cfs/src/exporters/shop-drawings.ts` — pdf-lib PDF shop drawings (cover + per-panel + summary)
- `packages/cfs/src/exporters/json.ts` + `json-invariants.ts` — byte-deterministic JSON round-trip + 8 invariants
- `packages/cfs/src/schema/scene-file.ts` — top-level `AACSteelSceneFile` Zod
- `apps/editor/cfs/lib/{platform,shortcuts,use-cfs-shortcuts}.ts` — single SHORTCUTS map driving bindings + tooltips + ShortcutsPanel
- `apps/editor/cfs/components/panels/{ShortcutsPanel,WelcomeCallout}.tsx` — `?` panel; first-toggle callout
- `apps/editor/cfs/lib/use-export.ts` — PDF, JSON, file-picker import wiring

**Manual v1 release checklist (Execution Plan §4.10) — user runs before tagging `v1.0.0`:**

1. Fresh clone → `bun install` → `bun dev` works on a teammate's machine.
2. `bun build` succeeds across packages.
3. `bun test` passes.
4. Draw a 2-story building with 10+ walls, place 5+ openings (mix of doors/windows; at least one box header), place service holes, panelize, export BOM/cut list/DXF/PDF/JSON.
5. Open BOM in Excel + LibreOffice Calc.
6. Open one DXF in LibreCAD + AutoCAD + BricsCAD.
7. Open PDF in Preview + Acrobat + Chrome.
8. Reload from exported JSON → scene reconstructed.
9. 15-minute usage session → no console errors.
10. README updated; PROJECT_SPEC v1-complete.
11. Tag: `git tag v1.0.0 && git push --tags` — user runs this.

---

## Pascal Canvas-children injection — chosen approach

Pascal's `<Editor>` does not expose a Canvas-children slot. `packages/editor/src/components/editor/index.tsx:694` renders `<Viewer>` with a hardcoded `<ViewerSceneContent>` child. `<Viewer>` itself accepts `children` (`packages/viewer/src/components/viewer/index.tsx:175`) but is wrapped, so external code can't pass into it.

**Chosen approach (Slice 5):** `apps/editor/cfs/lib/pascal-scene-bridge.ts` walks any registered `Object3D`'s `.parent` chain via `sceneRegistry.nodes` to find Pascal's `THREE.Scene`, then calls `scene.add(ourCfsRootGroup)`. `CFSGeometrySystem` mounts as a headless React component **outside** the Canvas (in `CFSRoot`), uses `useScene.subscribe` for change detection (mirroring the Slice 3 framing-system pattern), and manages all CFS Object3Ds with **raw Three.js — no R3F, no renderer files**.

**Why:** Lowest-coupling path that respects PROJECT_SPEC.md §0.3 (no upstream Pascal edits). Diverges from spec §2.9's "every node type gets a renderer" prescription, but the divergence is bounded to one bridge file — easy to revisit.

**How to apply:**
- Future CFS rendering work belongs in `apps/editor/cfs/systems/` (geometry-pass.ts has the diff/rebuild loop). **Do NOT add R3F renderers under `apps/editor/cfs/renderers/`.**
- The bridge requires at least one Pascal node to have rendered before it can resolve the scene. If `attachToPascalScene()` returns false, retry on the next pass — don't error.
- Pascal calls `sceneRegistry.clear()` on scene reset (`packages/editor/src/lib/scene.ts:342`); the system handles re-attach in `runGeometryPass` by checking `rootGroup.parent`.
- The clean long-term answer is a small upstream PR adding a `viewerCanvasChildren` prop to `<Editor>`. Recorded for v2.

---

## Pascal cascade-delete requires `children` array on every container schema

Pascal's `deleteNodesAction` (`packages/core/src/store/actions/node-actions.ts:365`) cascades to descendants by walking `node.children`. And `createNodesAction:254` auto-appends new child ids to `parent.children` — but only when the field exists:

```ts
if ('children' in parent && Array.isArray(parent.children)) {
  parent.children = [...parent.children, newNode.id]
}
```

If a CFS container schema lacks `children`, three things happen silently:

1. `createNode(child, parent)` runs successfully but never registers the new id under the parent.
2. `deleteNode(parent)` cascades down to the parent then stops — descendants stay alive in `useScene.nodes` with stale parentIds.
3. The geometry system (or any system that reads from `useScene`) keeps rendering the orphans.

**Why:** Diagnosed in Slice 5.1 — user couldn't delete a wall in the editor; CFS framings + members + openings stayed visible because `CFSWallFraming` and `CFSMember` schemas had no `children` field. Two-line fix unblocked the whole feature.

**How to apply:**
- Every new CFS node type in `packages/cfs/src/schema/` that can parent other nodes MUST include `children: z.array(z.string()).default([])`.
- Already added: `CFSWallFraming`, `CFSMember` (Slice 5.1).
- Slice 6 `CFSServiceHole` is a leaf — no children field needed.
- Slice 7 `CFSPanel` is currently a leaf (members reference panels via `panelId`, not parentId). If a future slice makes it a container, add the field.
- The default `[]` keeps schema additions backward-compatible: existing serialized scenes get the field filled in by zod parse on load.

---

## InstancedMesh vs per-instance CSG

Slice 5's `groupFieldStudsByInstance` in `apps/editor/cfs/lib/instanced-stud-group.ts` collapses every field stud on a wall into a single `THREE.InstancedMesh` sharing one cached geometry. CSG, custom cuts, or any other per-stud geometry mutation has no equivalent on a shared geometry.

**Why:** Verified during Slice 6 browser test. Service hole placed on a field stud → inspector + verdict correct but no visible cut in 3D, because the stud was rendering through the instanced path with the shared (uncut) geometry. Fix: `groupFieldStudsByInstance` grew an optional `hasHoles` predicate; matching studs go into `nonInstanced` and render as individual `Mesh` instances built by `build-cfs-mesh`. Shipped as commit `b422026` "Slice 6.1".

**How to apply:**
- Any future slice that adds per-stud geometry customization (web stiffener plates, flange notches, end-cuts, custom punchouts) must extend the predicate or add similar fallbacks. The pattern is **"studs in the instanced group must be geometrically identical except for pose."**
- Slice 7 (panelization) and Slice 8 (exporters) iterate `CFSMember` records, not meshes, so they're unaffected.
- If you ever need true per-instance CSG, look into `BatchedMesh` (Three.js r166+) — but for v1 the drop-out pattern is fine.

---

## Spark Docker hosting

The user hosts AACSteel-Designer on their NVIDIA DGX Spark (aarch64 Linux, hostname `spark`, user `atomicjr`) inside Docker. Repo cloned to `~/aacsteel-designer-Pascal-fork` on the Spark.

**Access URL (through SSH tunnel):** `http://localhost:43002`

**SSH tunnel command** (from the user's Windows machine, must stay open):

```bash
ssh -L 43002:localhost:43002 atomicjr@spark
```

Host port `43002` (chosen to dodge busy Spark ports 3000/3002/5678/8081/8443/9000/11000/11434/11435) maps to container port `3002`.

**Why:** Confirmed working on 2026-05-13 after the user reported the v1 hosted environment loaded successfully in the browser.

**How to apply:**
- If the user asks "how do I reach the app" or "what's the URL", answer `http://localhost:43002` (with the SSH tunnel running).
- The Dockerfile runs `next build && next start` in production mode, **NOT** `next dev`. Next.js 16's Turbopack dev SSR path hash-aliases transitive Node deps (e.g. `rimraf-91da1b57c4b72111`) and can't resolve them at runtime. **Do not switch back to `next dev` for this hosting setup.**
- HMR is unavailable in this mode. To ship code changes the user must rebuild the image:
  ```bash
  git pull && docker compose down && docker compose up -d --build
  ```
- The Dockerfile pre-builds every workspace package via `bunx turbo run build --filter='./packages/*'` (not just `@pascal-app/cfs`) so the editor can resolve `@pascal-app/core` and `@pascal-app/viewer` from their `dist/` directories.
