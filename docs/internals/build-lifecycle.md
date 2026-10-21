# How an install becomes a build

A module's pages are React server components, compiled by Next.js at build time. There is no runtime loader that could render them, so installing a module means rebuilding the site. Everything here follows from that one decision.

## On install

`scheduleBuild()` in `src/core/lib/install-lock.ts` waits three seconds after the last install, so thirty modules installed together cost one build, then runs:

1. Merge the core schema with every installed module's (`scripts/merge-schemas.ts`).
2. Add the tables the merged schema declares and the database lacks (`scripts/apply-schema-additions.ts`). Never `prisma db push`; see [Database](./database.md).
3. Apply the modules' SQL migrations (`scripts/apply-migrations.ts`).
4. Regenerate the registries (`scripts/generate-registry.ts`).
5. Build into `.next/.staging`, beside the build being served.
6. Mark the staged build ready and ask the process to stop with `SIGTERM`, after a short delay so the request that installed the module gets its answer.

Steps 1 to 4 are logged by name and do not stop the pipeline; only a failed build does. The install lock is a Postgres advisory lock, so a second process cannot start an install while one is running.

## On boot

Two paths start the app, and both repair the build before serving. In Docker, `scripts/docker-entrypoint.sh` runs `scripts/reconcile-build.ts` and then `next start`. Elsewhere, `npm start` runs `scripts/promote-staged-build.ts` as its `prestart`. Between them:

- A finished staged build is promoted. The live build moves to `.next/.previous`, the new one moves in, and its `BUILD_ID` moves last: a live `BUILD_ID` is the commit point, so a promotion cut off by a crash is finished or rolled back on the next boot. `src/core/lib/staged-build.ts` explains why the staging directory has to live inside `.next`, and why Turbopack's relative symlinks have to be re-pointed when a build moves.
- In Docker, if the build on disk was not made from the modules on disk, it is rebuilt before anything is served. That is the case after an update: the new image was built with no modules. It is why the first start on a new release takes minutes on a site with modules and seconds on one without.
- A rebuild that fails is loud but not fatal while some build exists: the admin still needs the panel to remove the module that broke it. Only a boot with no build at all stops.

## Why the app restarts, and only through those two paths

`next start` reads its manifests once, at boot. A build finished underneath a running process changes nothing it serves, and a staged build that is never promoted is never served. So the process has to stop, and a supervisor (Docker's `restart: unless-stopped`, systemd, PM2) has to start it again, through the entrypoint or `npm start`. A bare `next start` skips the promotion and serves the old build for ever; an app started by hand in a terminal exits after an install and stays down.

## One process per installation

Two app processes sharing one `src/modules` would both build into the same `.next`, and one would serve the other's half-written build. The install lock narrows that window; it does not make it safe. A site that outgrows one Node process needs a CDN in front of its public pages and a read replica, not a second app container. Scaling the app horizontally would mean moving the build out of the app process, which is a design change.

## Where the build lives in Docker

`/app/.next` is the `nextbuild` named volume, so a build survives the container being replaced; otherwise every restart of a site with modules would pay for a full build. `docker compose down -v` deletes it with everything else, and the next boot builds again.
