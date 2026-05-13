# syntax=docker/dockerfile:1.7
#
# AACSteel-Designer — single-stage production-build hosting image.
#
# Base: oven/bun:1.3.0-slim (Debian slim, multi-arch — works on x86_64 +
# aarch64; tested on DGX Spark). Installs every workspace dep, pre-
# builds every workspace package via Turbo (`@pascal-app/core`,
# `@pascal-app/viewer`, `@pascal-app/editor`, `@pascal-app/cfs`), then
# runs `next build` for the editor and serves with `next start -H
# 0.0.0.0 -p 3002` so Docker's port mapping reaches it.
#
# Why production build and not `next dev`?
#  Next.js 16's Turbopack dev SSR path externalizes some transitive
#  Node-only deps (e.g. rimraf, pulled in by fstream/tar) under a
#  hash-aliased name like `rimraf-91da1b57c4b72111`, then fails to
#  resolve them back at runtime with `Failed to load external module`.
#  Production build sidesteps the dev-externals path entirely. The
#  trade-off is a slower image build (~2–5 min for `next build`), but
#  runtime is faster and stable. HMR is unavailable in this mode —
#  rebuild the image to ship code changes.

FROM oven/bun:1.3.0-slim

WORKDIR /app

# Copy the full repo. .dockerignore strips node_modules, .next, dist,
# .git, .turbo, etc. so the build context stays small.
COPY . .

# Install workspace dependencies (Bun handles the apps/* + packages/* +
# tooling/* workspace expansion automatically). --frozen-lockfile keeps
# bun.lock authoritative.
RUN bun install --frozen-lockfile

# Pre-build every workspace package. The editor imports `@pascal-app/core`,
# `@pascal-app/viewer`, `@pascal-app/editor`, and `@pascal-app/cfs` from
# their `dist/` directories (emitted by `tsc --build`). Without this step
# Next.js's resolver throws `Module not found: Can't resolve
# '@pascal-app/viewer'` and the whole compile fails. Turbo walks the
# workspace dependency graph so packages build in the correct order.
RUN bunx turbo run build --filter='./packages/*'

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Telemetry off, production env so Next.js applies the right
# optimisations. The build below produces `.next/` ahead of time.

WORKDIR /app/apps/editor

# Production build. `typescript.ignoreBuildErrors: true` in
# next.config.ts keeps the build from failing on monorepo type slop;
# real errors surface at `bun check-types` time on the host.
# DOTENV_CONFIG_PATH unset is fine — the editor's package.json `build`
# script wraps with `dotenv -e ./.env.local` and tolerates a missing
# file.
RUN bun run build

EXPOSE 3002

# `next start` honours -H/-p just like `next dev`. 0.0.0.0 lets Docker's
# port mapping reach the server.
CMD ["bun", "next", "start", "-H", "0.0.0.0", "-p", "3002"]
