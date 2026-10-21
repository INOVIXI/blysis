# Database: schema, additions and migrations

One PostgreSQL database holds core's tables and every installed module's. The rule that shapes how it changes: **an admin's data is never dropped by the machinery.** Uninstalling a module leaves its tables in place so installing it again brings its data back, and so the database legitimately holds tables the current schema does not mention.

## Where the schema comes from

`prisma/schema.core.prisma` is core's. A module that stores data ships its own `schema.prisma`. `scripts/merge-schemas.ts` (`npm run db:merge`) writes `prisma/schema.prisma` from the core schema and every module in `src/modules/`, then generates the Prisma client from it. The merged file is output, never edited and never committed. A module's relations to `User` go between its `// @@user-relations-start` and `// @@user-relations-end` lines, and the merge adds them to the core model, so core's schema never names a module either.

## Why the install path does not run `prisma db push`

`db push` reconciles the whole database to the schema, so it also removes what the schema no longer declares. After an uninstall, that is a module's retained tables, and push either drops them silently or refuses to run. Neither is acceptable on a live site.

So a running site only adds: `scripts/apply-schema-additions.ts` asks Prisma for the same diff and runs only the statements that create. Installing a module, and every upgrade, goes through it.

`npm run db:push` is for a fresh local database. On an existing Docker installation, the `migrate` service (`scripts/docker-bootstrap.ts`) runs additions first, then a push that tolerates exactly one failure, its refusal to drop a retained table with rows in it, then the migrations. Never pass `--accept-data-loss` to make a push go through.

## Migrations

A schema change after a module or core has shipped, the kind a diff cannot express safely (a rename, a backfill, a constraint on existing rows), is a SQL migration:

- core's in `prisma/migrations/`, a module's in `module-sources/<id>/migrations/`
- named `NNN_<a sentence>.sql`, numbered in order, and never renamed
- applied once by `scripts/apply-migrations.ts`, which records each file's checksum in the `ModuleMigration` table; core's run first, under the owner `core`

A released migration is not edited: the runner stops a module whose applied text no longer matches the file. The one exception is a migration that fails on a fresh install, where nothing later can run before it. Its corrected text carries a `-- supersedes-checksum: <sha256>` line for each text it replaces, and an install that applied the old one skips it; any other edit still fails.

A core migration never reads a module's table, because core cannot know which modules a site has. A module's migration may read core's.

`--dry-run` shows what would run; `--bootstrap` records existing files as applied without running them, for a database that already has their effects.

## Going backwards

Updates are additive and migrations forward-only, which is what makes going back to the previous release safe: the older image runs against the newer schema. A change that only works if the old code never runs again needs a release of its own that the old code tolerates first.
