# AACSteel-Designer

Cold-formed steel (CFS) detailing tool for residential and light-commercial wall framing. Draws walls, places openings, auto-frames studs/tracks/headers/jambs/cripples, runs AISI S100 punchout compliance checks, panelizes for shipping, and ships BOM (xlsx), cut list (csv), per-panel DXF, shop-drawing PDF, and round-trippable scene JSON.

Built as an extension to [Pascal Editor](https://github.com/pascalorg/editor) — a 3D building editor on React Three Fiber + WebGPU. AACSteel adds the `@pascal-app/cfs` package plus a thin CFS UI layer on top of Pascal's architectural primitives. The upstream packages stay untouched (`@pascal-app/core`, `@pascal-app/viewer`, `@pascal-app/editor`); rebases against Pascal are trivial.

![Screenshot placeholder](docs/img/aacsteel-screenshot.png)

> Screenshot capture is part of the v1 release checklist — see [`docs/PROJECT_SPEC.md`](docs/PROJECT_SPEC.md) appendix A.4.

## Quickstart

```bash
bun install
bun run --filter packages/cfs build
bun dev   # → http://localhost:3002
```

Open the app, click the **CFS** segment of the mode toggle in the top toolbar, and draw a wall. The `CFSFramingSystem` populates tracks, studs, and chord studs automatically. Place an opening with **T** (door) or **W** (window), drag a service hole with **H**, and press **P** to panelize. Press **?** any time for the full shortcut list.

Exports live behind the `Export ▾` menu and the quick-export shortcuts:

| Shortcut | Action |
|---|---|
| `M` | Toggle CFS / Architectural mode |
| `T` / `W` / `H` / `B` | Door / Window / Service-hole / Panel-break tool |
| `P` | Panelize |
| `?` | Open shortcuts panel |
| `Cmd/Ctrl+E` | Open Export menu |
| `Cmd/Ctrl+Shift+B` | Quick-export BOM (.xlsx) |
| `Cmd/Ctrl+Shift+D` | Quick-export Panel DXFs (.zip) |
| `Cmd/Ctrl+Shift+P` | Quick-export Shop drawings (.pdf) |
| `Cmd/Ctrl+Shift+E` | Quick-export Scene (.json) |

## v1 deliverables

- **CFS framing system** — auto-generates top/bottom tracks, chord studs, field studs, king/jamb studs, headers (box, L-, back-to-back, single-track, proprietary), sills, sill tracks, cripples.
- **Real C/U/Z section geometry** — extruded cross-sections from the SSMA library.
- **Service holes with AISI S100 compliance checks** — placement rules R1–R4 enforced live; non-compliant holes flagged with reasons.
- **Panelization** — splits walls into shippable panels respecting max width, max weight, and forbidden-break zones (openings, corners).
- **Exporters**:
  - BOM xlsx (ExcelJS): cover + per-panel + totals tabs, real `=SUM()` formulas, built-up header expansion.
  - Cut list csv: UTF-8 BOM, CRLF, one row per physical member, encoded service holes.
  - Per-panel DXF zip (@tarikjabiri/dxf + fflate): 14 spec layers, LWPolylines, circles, dimensions, title block, fastener schedule.
  - Shop drawings PDF (pdf-lib): cover + per-panel pages + summary, US Letter, scaled elevations with member labels and service-hole circles.
  - Scene JSON: byte-deterministic round-trip via Zod-validated schemas; eight round-trip invariants enforced.

## v2 roadmap

Tracked in [`docs/PROJECT_SPEC.md`](docs/PROJECT_SPEC.md) appendix A.5:

- IFC4 Reference View export.
- CNC outputs: DSTV NC1, FRAMECAD, Scottsdale KFS/KFD.
- Engineering analysis per AISI S100: wind/seismic loads, stud/header/jamb utilization, deflection limits, shear-wall design.

## Repository layout

```
packages/
  cfs/                  # @pascal-app/cfs — schemas, store, systems, exporters
  core/                 # @pascal-app/core (Pascal upstream, do not modify)
  viewer/               # @pascal-app/viewer (Pascal upstream, do not modify)
  editor/               # @pascal-app/editor (Pascal upstream, do not modify)
apps/
  editor/
    cfs/                # CFS-side editor additions: tools, panels, toolbar
    app/                # Next.js app shell (Pascal upstream)
docs/
  PROJECT_SPEC.md       # Architecture + build contract — read before any non-trivial change
  AACSteel-Designer_Execution_Plan.pdf  # Slice-by-slice build guide
```

The single inviolable rule from `docs/PROJECT_SPEC.md` §0.3: **never modify the upstream Pascal packages.** All CFS work lives in `packages/cfs/` and `apps/editor/cfs/`.

## Tooling

- **Bun** as the package manager and dev runner. `npm` / `yarn` are forbidden.
- **Turborepo** for the monorepo orchestrator.
- **TypeScript 5.9** with strict mode. No `any` in `packages/cfs/src/schema/`.
- **Biome** for linting and formatting.
- **React 19 + Next.js 16** for the editor app.
- **Three.js with the WebGPU renderer** (WebGL fallback automatic).
- **Zustand** for state, **Zundo** for undo/redo, **Zod** for schema validation.

## Contributing

Read [`docs/PROJECT_SPEC.md`](docs/PROJECT_SPEC.md) — the architectural source of truth — before opening a PR. The full execution plan with slice-by-slice goals is in `docs/AACSteel-Designer_Execution_Plan.pdf` (or its source in `OneDrive/.../plano de execução/`).

## License

MIT. See [`LICENSE`](LICENSE).

Pascal Editor upstream is also MIT-licensed; see https://github.com/pascalorg/editor for credit and contribution to the underlying engine.
