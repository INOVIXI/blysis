---
name: run-blysis
description: Start Blysis on this machine, as a dev server or as a production build with every module installed, and run the end-to-end suite against it. Use when asked to run, start or screenshot the app, to see a change working in the real app, or to run the Playwright tests.
---

# Running Blysis

The commands are in [docs/operations/development.md](../../../docs/operations/development.md): "First checkout" for a dev server, "The end-to-end suite" for a production build with modules. Follow them; this file adds only what an agent gets wrong on the way.

## Before starting anything

- Look at what is already listening. A developer's machine often has other Postgres, Redis or Blysis containers on 5432, 6379 and 3001. Never stop, remove or reuse a container or process you did not start. Pick free ports instead: `DEV_DB_PORT` and `DEV_REDIS_PORT` for `npm run services:up`, with `DATABASE_URL` and `REDIS_URL` changed to match, and another port (3011 in the runbook) for the app.
- The end-to-end suite writes to its database. Give it a database of its own, never the developer's.

## Choosing what to run

- A change to a screen or route with no module involved: `npm run dev` is enough.
- Anything a module serves, or the end-to-end suite: a production build with every module installed, started through `npm start`. A bare `next start` serves a stale build after an install.

## Traps

- Prisma refuses `prisma db push --accept-data-loss` when an AI agent runs it. Do not look for a way around that: on a fresh database the flag is not needed, and on an existing one data loss is the thing to avoid.
- Stop the server you started by its PID, not by name.

## Afterwards

Put the checkout back the way you found it: stop what you started, `rm -rf src/modules` if you installed every module, and run `npx tsx scripts/postinstall.ts` so the generated registries match an empty `src/modules` again. Report what you ran, on which ports, and what you saw.
