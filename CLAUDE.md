# AACSteel-Designer — agent onboarding

This file is auto-loaded by Claude Code at session start. It's intentionally short. Read the linked files when their topics come up.

## What this project is

AACSteel-Designer is a CFS (cold-formed steel) detailing tool built on top of the Pascal Editor (a Turborepo + Bun monorepo with Next.js 16, React 19, Three.js + R3F, Zustand state). Architectural editing is Pascal; CFS framing/openings/service-holes/panelization/exports are everything in `apps/editor/cfs/` and `packages/cfs/`. Slices 1–9 are code-complete on branch `slice-9-from-claude`; v1 is gated on a manual checklist + `v1.0.0` tag.

## Read these on first relevant task

- **`docs/CLAUDE_CONTEXT.md`** — distilled session memory: repo quirks, slice status, the Pascal-Canvas bridge decision, the Pascal cascade-delete pattern, instancing-vs-CSG, Spark Docker hosting. Start here when context is unclear.
- **`docs/PROJECT_SPEC.md`** — the v1 spec (data model, state, systems, exporters, UI contract, appendix). The contract this codebase honors.
- **`README.md`** — quickstart, shortcut table, v1 deliverables.
- **`.cursor/rules/*.mdc`** — Pascal architectural rules (events, layers, renderers, scene-registry, selection-managers, spatial-queries, systems, tools, viewer-isolation). The `.claude/rules/*.md` symlinks are broken in this repo; read the `.mdc` files directly.

## Working conventions

- **Spec vs code commits are separate** per PROJECT_SPEC §0.1. Don't mix them.
- **Pascal upstream is read-only.** `apps/editor/cfs/` and `packages/cfs/` are the CFS surface. Modifying `packages/{core,viewer,editor}` is out of scope for v1.
- **`bun install` from repo root, then `cd packages/cfs && bun run build`** before running editor tests. `three-bvh-csg` / `three-mesh-bvh` are mocked in `test-setup.ts` because their UMD builds break under Bun CJS interop.
- **Slice 9 hosting:** the app runs in Docker on the user's DGX Spark, reached at `http://localhost:43002` via `ssh -L 43002:localhost:43002 atomicjr@spark`. The Dockerfile builds in production mode (Next 16 Turbopack dev has a hash-alias resolve bug that breaks SSR). See `CLAUDE_CONTEXT.md` for details.
