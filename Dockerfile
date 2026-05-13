# syntax=docker/dockerfile:1.7
#
# AACSteel-Designer — single-stage dev/host image.
#
# Base: oven/bun:1.3.0-slim (Debian slim, multi-arch — works on x86_64 +
# aarch64; tested on DGX Spark). Installs every workspace dep and pre-
# builds every workspace package via Turbo so the editor can resolve
# `@pascal-app/core`, `@pascal-app/viewer`, `@pascal-app/editor`, and
# `@pascal-app/cfs` from their `dist/` directories at startup. The
# editor then runs `next dev` bound to 0.0.0.0:3002 inside the container
# so Docker's port mapping reaches it.
#
# Why dev mode and not next build / next start?
#  - Next.js production build re-checks the whole monorepo and is slow.
#  - Dev mode gives HMR if someone bind-mounts source later.
#  - For the v1 manual checklist the difference is invisible.
# If you want a true production image, swap CMD for `bun next build &&
# bun next start -p 3002 -H 0.0.0.0` and set NODE_ENV=production.

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

ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1
# Disable Next.js telemetry & give the dev server a stable host binding.
# next dev defaults to localhost (container-only); -H 0.0.0.0 makes
# Docker's host-port mapping reach it.

WORKDIR /app/apps/editor

EXPOSE 3002

CMD ["bun", "next", "dev", "-H", "0.0.0.0", "-p", "3002"]
