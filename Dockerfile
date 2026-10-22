# syntax=docker/dockerfile:1.7
# Multi-stage build for Blysis. Node 24 matches package.json engines.node.
#
# Stages:
#   deps    - install every dep (dev + prod) so the builder can compile TS.
#   builder - runs prisma generate + next build, produces .next + generated files.
#   runner  - minimal runtime with a non-root user and a HEALTHCHECK that
#             probes /api/health.
#
# Runtime notes:
#   - src/modules/ is NOT copied. The runner starts with zero modules
#     installed, matching the "fresh install" motto. An admin installs
#     modules from module-marketplace/*.zip via the admin UI after boot.
#   - HEALTHCHECK uses wget (Alpine ships BusyBox wget) to hit the probe
#     endpoint - any 200/degraded response keeps the container healthy.
#   - The runner can re-run `next build` in place (on module install, and at
#     boot via scripts/reconcile-build.ts). Everything `next build` reads must
#     therefore be present in this stage, not just what `next start` reads -
#     that is why postcss.config.mjs and src/instrumentation.ts are copied
#     below. Omitting postcss.config.mjs is silent: the rebuild succeeds and
#     ships a stylesheet that Tailwind never processed.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# The postinstall hook is `npx tsx scripts/postinstall.ts`, and this stage
# copies only the manifests, so npm ci used to die on the missing file before
# the script could read its own SKIP_POSTINSTALL escape hatch. Copy the script
# so the hook resolves, and set the flag so it exits immediately: everything
# it would do (merge-schemas, generate-theme-registry, generate-registry) the
# builder stage below runs explicitly. Dependency install scripts still run.
COPY scripts/postinstall.ts ./scripts/postinstall.ts
RUN SKIP_POSTINSTALL=1 npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Regenerate the Prisma client + merged schema + module + theme registries
# from committed source. scripts/postinstall.ts does this automatically on
# `npm ci`, but we also need a full `next build` here.
#
# `npm prune --omit=dev` at the end drops the test and lint toolchain (vitest,
# playwright, jsdom, eslint and their trees) from the node_modules the runner
# inherits. It can only drop that much because the packages the *runtime* build
# needs - typescript, tailwind, tsx, prisma, dotenv, the @types, and the
# bundle analyzer next.config.ts imports at the top level - are declared
# as real dependencies rather than devDependencies. That is not bookkeeping:
# this image rebuilds itself when a module is installed, so those packages are
# needed in production, and calling them "dev" was the inaccurate part.
# `node_modules/.prisma` survives: npm skips dot-prefixed entries.
RUN npx tsx scripts/merge-schemas.ts && \
    npx tsx scripts/generate-theme-registry.ts && \
    npx tsx scripts/generate-registry.ts && \
    npx tsx scripts/generate-openapi.ts && \
    npm run build && \
    rm -rf .next/cache && \
    cp .next/BUILD_ID .blysis-image-build-id && \
    npm prune --omit=dev

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# pg_dump and psql. The backup feature spawns both, and without them the
# scheduled job records `spawn pg_dump ENOENT` once a day and the admin backup
# screen cannot take or restore anything - the image shipped that way.
# The client major must be at least the server's: pg_dump refuses a server
# newer than itself, while an 18 client dumps 16 and 17 servers fine. 3.3MB.
RUN apk add --no-cache postgresql18-client

# Non-root user so an RCE via a module hook cannot write outside /app.
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

# The channel to the updater. Created here with the right owner because Docker
# seeds a fresh named volume from the image: without this the app would find a
# root-owned directory it cannot write an update request into.
RUN mkdir -p /var/lib/blysis/update && chown -R 1001:1001 /var/lib/blysis

# Minimal runtime surface - the builder's .next, the generated Prisma
# client, marketplace ZIPs, and the scripts the runtime still invokes
# (generate-registry runs on module install, merge-schemas on module
# schema updates, apply-migrations on module install).
#
# .next/cache is deleted above, not copied around: Turbopack's build cache is
# ~580MB and `next start` never reads it. Next recreates the directory itself
# if a runtime cache (ISR, fetch) needs one.
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
# Unmasked copy of .next/BUILD_ID. In production .next is a named volume, so a
# freshly pulled image's own build id would be hidden behind the previous
# image's build. This file rides in the image layer where the volume cannot
# mask it, and is how scripts/reconcile-build.ts notices the image changed.
COPY --from=builder --chown=nextjs:nodejs /app/.blysis-image-build-id ./.blysis-image-build-id
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/next.config.ts ./next.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/postcss.config.mjs ./postcss.config.mjs
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json
# Generated by `next build`, gitignored, and rewritten by any later build.
# Without it an in-place rebuild would try to create it in a root-owned /app.
COPY --from=builder --chown=nextjs:nodejs /app/next-env.d.ts ./next-env.d.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/core ./src/core
COPY --from=builder --chown=nextjs:nodejs /app/src/app ./src/app
COPY --from=builder --chown=nextjs:nodejs /app/src/themes ./src/themes
COPY --from=builder --chown=nextjs:nodejs /app/src/proxy.ts ./src/proxy.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/instrumentation.ts ./src/instrumentation.ts
COPY --from=builder --chown=nextjs:nodejs /app/module-marketplace ./module-marketplace
COPY --from=builder --chown=nextjs:nodejs /app/module-sources ./module-sources
COPY --from=builder --chown=nextjs:nodejs /app/messages-core ./messages-core

# src/modules starts empty; admin installs from /admin/modules after boot.
# backups is where every dump is written: the nightly one, the panel's and
# the one taken before an update. Both are volume mount points, and Docker
# gives a new volume the owner of the directory it is mounted over. Without
# the directory in the image that owner was root, nothing running as nextjs
# could write a backup, and an update from the panel refused to start.
RUN mkdir -p src/modules backups && chown -R nextjs:nodejs src/modules backups

# WORKDIR creates /app owned by root. `next build` writes next-env.d.ts and
# touches tsconfig.json at the project root, so the rebuild path needs the
# directory itself writable - not just its contents. Only the directory entry;
# the copied trees above already carry the right owner.
RUN chown nextjs:nodejs /app

USER nextjs
EXPOSE 3001

# start-period covers a boot-time rebuild. reconcile-build.ts rebuilds before
# the server binds when the image changed under an installed module set, and a
# full `next build` on a small VPS runs several minutes - a 60s grace window
# would mark the container unhealthy while it was doing exactly the right thing.
HEALTHCHECK --interval=30s --timeout=10s --start-period=600s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3001/api/health >/dev/null || exit 1

# The entrypoint reconciles the build against the installed modules and then
# `exec`s the server, so `next start` still ends up as PID 1 and the shutdown
# registry still sees SIGTERM. The `exec` is what makes the shell safe here -
# a wrapper that forks instead would swallow the signal.
CMD ["/app/scripts/docker-entrypoint.sh"]
