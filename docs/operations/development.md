# Development runbook

The app runs on the host, on Linux, macOS or Windows alike. Docker provides the database and Redis.

## First checkout

Requires Node.js 24+, and Docker or a PostgreSQL 14+ of your own.

```bash
git clone https://github.com/INOVIXI/blysis.git
cd blysis
npm install                 # its postinstall merges the schema and generates the registries
npm run services:up         # Postgres and Redis from docker-compose.dev.yml, on 127.0.0.1
cp .env.example .env        # DATABASE_URL already points at that Postgres
```

Set `AUTH_SECRET` in `.env` (`openssl rand -base64 32`), and `REDIS_URL="redis://localhost:6379"` to use the Redis too. Then create the database and its first admin:

```bash
npm run db:push                          # a fresh database only
npm run db:seed                          # roles and an admin account
npx tsx scripts/seed-translations.ts     # the strings in every locale
npm run dev                              # http://localhost:3001
```

The seed prints the admin's password once. Set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` before seeding to choose them instead.

When 5432 or 6379 is already taken on your machine, start the services with `DEV_DB_PORT` and `DEV_REDIS_PORT` set, and change the port in `DATABASE_URL` and `REDIS_URL` to match. `npm run services:down` stops them; the data stays in a volume.

## Working with modules

A checkout has no module installed. To develop against one, copy its source in and create its tables:

```bash
cp -R module-sources/<id> src/modules/<id>
npm run db:merge
npx tsx scripts/apply-schema-additions.ts    # adds the module's tables, never drops anything
npm run dev                                  # its predev regenerates the registries
```

The source of truth is still `module-sources/<id>/`; edit there and copy again, or the change never reaches the marketplace. Writing a new module is in [module-template/README.md](../../module-template/README.md).

## Tests

```bash
npm test -- tests/unit/<file>.test.ts        # one file while you work
npm test                                     # the whole suite
npm run verify                               # every gate CI's check job runs
```

On a checkout with no module installed, `npm test` and `npm run verify` install every module from `module-sources` for the length of the run and remove them afterwards, the way CI does. A checkout with modules installed is tested as it is. A run stopped half way leaves a marker in `.tmp/`, and the next run cleans up after it.

`npm run verify` builds into `.next-prod`, so a dev server on 3001 keeps serving while it runs.

## The end-to-end suite

The browser tests run against a production build with every module installed, signed in as a seeded admin, the way CI's e2e job runs them:

```bash
npm run services:up
rm -rf src/modules && cp -R module-sources src/modules
npm run db:merge && npm run generate:themes
npx tsx scripts/generate-registry.ts && npx tsx scripts/generate-openapi.ts
npx prisma db push
SEED_ADMIN_EMAIL=admin@blysis.com SEED_ADMIN_PASSWORD=e2e-admin-password npx tsx prisma/seed.ts
npx tsx scripts/seed-translations.ts --register-modules
npm run build
npm start -- --port 3011 --hostname 127.0.0.1 &
npx playwright install chromium
E2E_BASE_URL=http://127.0.0.1:3011 E2E_ADMIN_EMAIL=admin@blysis.com E2E_ADMIN_PASSWORD=e2e-admin-password npm run test:e2e
```

The server needs `AUTH_URL=http://127.0.0.1:3011` and a `SECRET_ENCRYPTION_KEY` in its environment. Use a database of its own for this: the suite writes to it. Afterwards stop the server by its PID, then `rm -rf src/modules` and run the generators again to put the checkout back.

## Backups

`npm run db:backup` takes the same backup as the panel's backup screen, into `backups/`, and `npm run db:restore -- <id>` restores one it lists; without an id it prints them. Both need the PostgreSQL client tools, `pg_dump` and `psql`, on the PATH.

## Windows

The npm scripts run from any shell. The command blocks on this page are written for a POSIX shell (`rm -rf`, `VAR=value command`, a trailing `&`); Git Bash runs them as they are. Two more things differ:

- `install.sh` is a Linux installer. Its tests run through WSL when a distribution is installed, and report themselves skipped when none is.
- The checkout is LF everywhere (`.gitattributes`), whatever `core.autocrlf` says.
