# Blysis

Blysis is a self-hosted platform for game-server websites, storefronts and community portals. The core ships empty: every feature is a module and every look is a theme. An operator installs it on a VPS with one command, then picks what the site needs from the marketplace in the admin panel.

## What we never compromise on

### 1. The core knows nothing about any module or theme

No module id, module path, module-specific behaviour or theme name in `src/core/` or `src/app/`, not even in a comment. Everything a module contributes is declared in its `module.json` and reaches core through generated registries. `tests/unit/core-names-no-module.test.ts` and `tests/unit/core-knows-no-category.test.ts` fail the build otherwise. When a feature only makes sense for some sites, it is a module.

### 2. A fresh install works for someone who is not a developer

The person running Blysis rents a VPS, pastes one command and opens a URL. For weeks that URL is `http://<ip>:<port>`, not a domain with HTTPS, so anything that needs a secure context has to work without one. They will never read a log, so a failure has to say what happened on the screen it happened on.

### 3. Every screen speaks the site's language

Twelve locales ship, and a site's visitors and its admin may read any of them. A string in JSX, a toast or an error body is a string a Turkish admin reads in English. Every key goes into every locale in the same change.

### 4. It fails closed

Rate limits deny when Redis is gone in production, a mutation says who may make it, a secret is compared in constant time, and what a person wrote is sanitised on the way to the page. A shortcut that is safe "in practice" is not a shortcut we take.

## How we work

Copy the nearest neighbour. The closest existing route, admin screen or module already solved most of what you are about to do; match its structure, naming, imports and comment voice. Do not introduce a pattern while an established one exists, and do not keep complexity just because it is there. Fight scope creep: do what was asked, in the smallest change that makes the behaviour obvious.

Every problem you hit is ours. A failing test, a broken script, a Windows-only crash, a stale line of documentation: explain the cause and fix it, or name it in your report as left undone. Never call a failure unrelated, pre-existing or environment noise and move on. Comparing against `main` tells you whether you caused something; it never makes leaving it broken acceptable.

Report what happened. Work is done when the gates that cover it ran and passed (see Verifying). A failure is reported with its output, a step you skipped is reported as skipped.

These are good defaults rather than laws. The developer's instructions override anything here. If a rule fights the task in front of you, say so plainly and get a human's sign-off before breaking it.

## A small glossary

- **you** means the agent reading this file and changing Blysis.
- **we** and **maintainers** mean the people building Blysis.
- **operator** is whoever installed a site and runs its server. **admin** is a signed-in account with the admin role. **member** is any other account; **visitor** is anyone not signed in.
- **core** is `src/core/` and `src/app/`: what every site runs.
- **module** is a feature package. Its source is `module-sources/<id>/`; once installed it is a copy in `src/modules/<id>/`, compiled into the app.
- **theme** is a look, in `src/themes/<id>/`, declared by `theme.json`.
- **manifest** is a module's `module.json` or a theme's `theme.json`. Routes, endpoints, permissions, settings, slots, hooks and crons are declared there.
- **registry** is code generated from the installed manifests into `src/core/generated/`, which is how core reaches modules without naming them.
- **SDK** is `src/core/sdk/`, the only part of core a module may import.
- **hook** is a named event or filter one module emits and another listens to. **slot** is a named place in a page a module can render into.
- **the panel** is the admin UI under `/admin`.
- **gate** is a test that reads source as text and enforces a convention. Most of `tests/unit` is gates.
- **marketplace** is `module-marketplace/`: the ZIPs and `index.json` a site installs modules from.

## The ways to hurt yourself

1. **Killing by pattern.** This machine may run other projects' containers and dev servers, and a developer's own Blysis. Never kill a process you found by name or by a path match. Stop only a PID you started, or the owner of a port you opened.
2. **Writing to state that is not yours.** Never point a script at a database you did not create for the task, never `docker compose down -v` a stack you did not start, and never run `prisma db push --accept-data-loss`. A fresh database needs no such flag.
3. **Reseeding someone's modules.** `src/modules/` is a developer's install state. Never copy `module-sources` over it or delete it to make a test pass; a test run on a checkout with nothing installed does that for itself, and only then.
4. **Spawning `npx` or `npm` directly.** It fails on Windows (`ENOENT`, or `EINVAL` for `npx.cmd` since Node's CVE-2024-27980 fix). Spread `toolCommand([...])` from `src/core/lib/tool-command.ts` into the `child_process` call instead. `tests/unit/a-tool-starts-on-every-platform.test.ts` rejects the direct form.

## Hit every surface

The most common defect here is a change that works where it was tried and is missing everywhere else. Before you call work done, walk this list and say which entries applied:

- **Core and modules.** A rule changed in core usually has copies in `module-sources/`. A module change needs `npm run validate:module module-sources/<id>`, a `version` bump in its `module.json` (patch for a fix, minor for a feature) and `npm run build:marketplace`, in the same commit.
- **Locales.** A new core key goes into all twelve files in `messages-core/`; a module key into all twelve locales of its manifest. Unused keys fail the build.
- **Both halves of the panel.** A behaviour reachable from a list is usually reachable from its detail screen, its bulk actions and its public page.
- **The way back.** If you added a way in, add the way out and the way to see it. A one-way door is a bug.
- **Light and dark.** Colours are theme tokens; dark mode is `[data-mode="dark"]`, not the `dark:` variant.
- **Linux and Windows.** Paths compare through `relativePath` in tests, files are read with Node rather than `sh` or `grep`, and every tool starts through `toolCommand`.
- **Docs.** Check whether the change makes existing guidance wrong. Apply the documentation rules below.

## Dev servers and services

- `npm install` runs the generators through its postinstall. If a module or the Prisma client looks missing, run `npx tsx scripts/postinstall.ts`.
- `npm run services:up` starts Postgres and Redis from `docker-compose.dev.yml` on 127.0.0.1. When a port is taken, set `DEV_DB_PORT` / `DEV_REDIS_PORT` and move `DATABASE_URL` with it. `npm run services:down` stops them and keeps the data.
- `npm run dev` serves on port 3001. If something already listens there, it may be the developer's own install; use another port rather than stopping it.
- A production build is `npm run build`, started with `npm start`, never a bare `next start`: its `prestart` promotes the staged build an install left behind.
- Stop what you started, by the PID you started.

The full runbook, including running the end-to-end suite against a real build, is [docs/operations/development.md](docs/operations/development.md). The `run-blysis` skill in [.claude/skills/run-blysis/SKILL.md](.claude/skills/run-blysis/SKILL.md) walks an agent through it.

## Verifying

- While you iterate, run the narrowest test: `npm test -- tests/unit/<file>.test.ts`, with `-t "<name>"` for one case. A bare `npx vitest` skips `scripts/with-scratch.ts`, so its temp files land in the shared system directory and `tests/unit/a-run-does-not-share-a-full-disk.test.ts` fails.
- Before you say done, run `npm run verify`. It runs every gate CI's check job runs, in CI's order, and reports all failures at once. On a checkout with no module installed it installs every module for its own run, as CI does.
- Run `npm run test:e2e` when a change touches the interface. It needs a served build; see the runbook.
- A bug in logic, data, state or a protocol gets a failing test first, in the module's existing test file where there is one, then the fix. Watch the test fail for the right reason before you trust it.
- Test behaviour, not source text, wherever the behaviour can be run. A gate that reads source is for a convention, not for a feature.
- A gate must be able to fail. Read the tree with Node (`grepTree` in `tests/unit/source-text.ts`), never by spawning `sh`, `grep` or `ls`; compare paths through `relativePath`; assert the scan saw something; and when you widen a gate, add the case it missed as a fixture and watch it go red on the old rule.
- An allow-list entry carries a `why` a reviewer would accept and names a file that exists.
- Mock the specifier the code under test imports. A relative `vi.mock` path resolves from the test file, not from the importer; `tests/unit/a-mock-names-a-module-that-exists.test.ts` rejects a mock of nothing.
- Coverage thresholds in `vitest.config.mts` are a ratchet: raise them when you add tests, never lower them.

## Commits and pull requests

- Never commit, push, open a PR, publish a release or change `.github/` unless the developer asks.
- Branch from `main` as `type/short-name`.
- Conventional Commits, lowercase, and the subject states the resulting behaviour as a sentence, not the code change: `fix(ui): the navigation stays one row in every language`. The scope is the area or the module id.
- The body is prose: what happened before, why it was wrong, what happens now.
- A pull request follows `.github/PULL_REQUEST_TEMPLATE.md`. UI changes carry before/after screenshots, uploaded to the PR and never committed.
- Code written by an agent is accepted only from the models [CONTRIBUTING.md](CONTRIBUTING.md#models) names. The PR's last line names the model and harness that did the work.
- Release commits are only `chore: X.Y.Z`; see [docs/operations/release.md](docs/operations/release.md).

## Documentation

Most code changes need no documentation change. Agents and people can read the code.

- `docs/internals/` holds architectural decisions and their reasons, constraints that span components, and traps that are hard to find from the source. Before adding a paragraph, ask what a maintainer would get wrong without it. If reading the code answers the question, leave it out.
- Do not document every feature, enumerate fields, narrate control flow, keep file catalogs or append change summaries. Counts drift: write "every module", not a number.
- A local explanation belongs in a comment beside the code. Link to the source rather than copying it.
- When a documented decision changes, rewrite or remove the text. Do not append a second account of the new behaviour.
- `docs/user/` helps operators and admins get a task done, in the product's voice, with no contributor tooling in it.
- `docs/operations/` is maintainer setup, release and publishing procedure.
- Every relative link, every repository path in backticks and every `npm run` script named in these files must exist; `tests/unit/a-document-points-at-what-exists.test.ts` checks.

## Plans and work artifacts

Do not commit plans, research notes or scratch files; keep them outside the tree. The merged change and its commit message are the record. Track open work in the issue that owns it, not in a checklist in the repository.

## How it works

Next.js 16 App Router, TypeScript strict, Prisma 7 on PostgreSQL, Redis for rate limits and caches.

A module is compiled, not loaded. Installing one copies it into `src/modules/`, merges its Prisma schema into the core one, adds its tables, regenerates the registries and builds the app beside the one being served. The process then exits and its supervisor starts it on the new build. Core reaches modules only through the generated registries, and modules reach core only through the SDK. Modules never import each other; they talk through hooks and slots.

Read [docs/internals/overview.md](docs/internals/overview.md) for the architecture and its constraints, and [docs/internals/glossary.md](docs/internals/glossary.md) for the vocabulary.

## Where code lives

| Path | Holds | Rule |
|---|---|---|
| `src/app/[locale]/(admin)/admin/` | core admin screens | module screens go through `adminRoutes`, never here |
| `src/app/[locale]/(public)/`, `(auth)/`, `(setup)/` | core public, sign-in and first-run pages | |
| `src/app/api/v1/` | core REST API | module endpoints are declared in the manifest and served by `src/app/api/v1/[...path]/route.ts` |
| `src/core/lib/` | services and helpers, one concern per file | kebab-case `.ts` |
| `src/core/components/ui/` | primitives | kebab-case; exported through `src/core/sdk/ui.ts` |
| `src/core/components/` | composed components | PascalCase `.tsx` |
| `src/core/hooks/` | client hooks | `useCamelCase.ts` |
| `src/core/sdk/` | the module-facing contract | explicit named re-exports only |
| `src/themes/` | themes | `theme.json`, `schemaVersion: 2` |
| `messages-core/` | core strings, one file per locale | every key in every locale |
| `prisma/schema.core.prisma` | the core schema | the only schema edited by hand in core |
| `prisma/migrations/` | core data migrations | the file name is a sentence: `003_a_role_may_say_never.sql` |
| `module-sources/` | first-party module sources | the ZIP in `module-marketplace/` must match |
| `module-template/` | what `npm run create:module` copies | |
| `scripts/` | codegen, migrations, marketplace and operations tooling | |
| `tests/unit/` | core logic and gates, flat | |
| `tests/integration/` | multi-part flows | |
| `tests/modules/<id>/` | a module's behaviour | imports `@/modules/<id>/...` |
| `tests/e2e/` | browser flows (Playwright) | |

Generated, never hand-edited, never committed: `src/core/generated/`, `prisma/schema.prisma`, the Prisma client in `node_modules/.prisma/`, `src/modules/`. The marketplace ZIPs, `module-marketplace/index.json` and `module-marketplace/manifest-schema.json` are committed but only ever written by `npm run build:marketplace`.

The layers:

| Layer | Lives in | Declared by | May import |
|---|---|---|---|
| Core | `src/core/`, `src/app/` | | anything in core |
| Module | `module-sources/<id>/` | `module.json` | only `@/core/sdk*` |
| Theme | `src/themes/<id>/` | `theme.json` | `@/core/sdk/theme`, UI |

Module code reaching into `@/core/lib/*` or `@/core/components/*` fails `scripts/validate-module.ts --all` and ESLint. The SDK entry points are the files in `src/core/sdk/`. Adding an SDK symbol is a minor bump of `CORE_API_VERSION` in `src/core/lib/core-version.ts`; changing or removing one is a major bump, and each bump gets its paragraph in that file's doc comment. `CORE_API_VERSION` is not the product version in `package.json`.

## What already exists

Search `src/core/lib/`, `src/core/components/` and `src/core/sdk/` before writing a helper. Duplicating one, or working around something you wrongly believed was missing, is the most common way to damage this codebase. The pieces most often written twice:

**API and requests**
- `src/core/lib/api-utils.ts`: `apiSuccess`, `apiError`, `apiPaginated`, `withRateLimit`, `devOnlyDetail`
- `src/core/lib/api-body.ts`: `readJsonBody` (1 MiB cap); `src/core/lib/api-query.ts`: `intParam`, `enumParam`
- `src/core/lib/page-params.ts`: `pageParams` and the page-size limits
- `src/core/lib/prisma-errors.ts`: Prisma not-found and unique errors as client errors
- `src/core/lib/read-json.ts`, `src/core/lib/shared-request.ts`: client fetches, one request per URL
- `src/core/lib/write-result.ts`: `writeError`, `errorMessage`; `src/core/lib/bulk-delete.ts`: `deleteEach`

**Auth, permissions, safety**
- `src/core/lib/permissions.ts`: `hasPermission`, `requirePermission`, `isAdmin`, `isStaff`, `hasResourcePermission`
- `src/core/lib/roles.ts`: grant, revoke, `rolesHeldBy`. A role's name decides nothing except `admin`.
- `src/core/lib/rate-limit.ts`: Redis with a memory fallback, closed in production
- `src/core/lib/password-hash.ts`: `verifyPassword`, never bcrypt directly; `src/core/lib/password-policy.ts`
- `src/core/lib/constant-time.ts`: `secretsMatch` for any secret a caller sends
- `src/core/lib/safe-redirect.ts`, `src/core/lib/url-safety.ts`, `src/core/lib/safe-object.ts`, `src/core/lib/svg-sanitizer.ts`, `src/core/lib/css-sanitizer.ts`
- `src/core/lib/write-guard.ts` (`refuseSilenced`), `src/core/lib/restrictions.ts`

**Data, settings, secrets**
- `src/core/lib/db.ts`: `prisma` (modules take it from `@/core/sdk/server`)
- `src/core/lib/module-cache.ts`: `isModuleEnabled`, `moduleSettings`, `getModuleStates`
- `src/core/lib/setting-values.ts`, `src/core/lib/secret-settings.ts`, `src/core/lib/secret-storage.ts`
- `src/core/lib/cache.ts`: `cached`, `invalidate`; `src/core/lib/redis.ts`
- `src/core/lib/activity-log.ts`: `logActivity`; `src/core/lib/revisions.ts`: `recordRevision`

**Mail, storage, time, text**
- `src/core/lib/email.ts`: `sendEmail`, `queueEmail`; `src/core/lib/mailer.ts`: the active provider
- `src/core/lib/storage.ts`: `uploadFile`, `sanitizeFilename`, `StorageProvider`
- `src/core/lib/scheduler.ts`, `src/core/lib/cron-schedules.ts`: jobs and the schedule names allowed
- `src/core/lib/logger.ts`: `log.info/warn/error`, `errorText`
- `src/core/lib/utils.ts`: `cn`, `formatDate`, `formatCurrency`, `formatRelativeTime`, `slugify`, `truncate`
- `src/core/lib/site-time.ts`, `src/core/lib/site-currency.ts`, `src/core/lib/markdown.ts` (`renderMarkdown`), `src/core/lib/app-url.ts`, `src/core/lib/copy-text.ts`
- `src/core/lib/validations.ts`: shared Zod schemas

**UI and admin scaffolding**, through `@/core/sdk/ui` and `@/core/sdk/admin`
- Primitives: `Button` (and `buttonClassName`), `Badge`, `Card`, `Checkbox`, `Radio`, `Input`, `Textarea`, `Select`, `NativeSelect`, `PasswordInput`, `Slider`
- Lists: `Pagination` (and `usePagedRows`), `ListControls`, `SegmentedTabs`, `FilterChips`, `BulkBar`, `RowActions`
- Dialogs: `useConfirm`, `usePrompt`, `ModalLayer`. Never `confirm()`, `alert()` or `prompt()`.
- States: `Skeleton`, `Waiting`, `LoadFailed`
- Media: `FileUpload`, `MediaPicker`, `UrlOrFile`, `RichTextEditor`, `RichContent` (the only renderer of what a person wrote)
- Pickers: `ReferencePicker`, `UserPicker`, `IconPicker`, `NavIcon` (a Lucide icon by name)
- Screens: `AdminPageHeader`, `AdminCrudPage` (a whole list, create and edit screen from `fields`), `SettingsForm`
- Hooks: `useRowList`, `useFormRoute`, `useSettingsLoad`, `useSiteSettings`, `useModalDialog`, `useLocalDate`
- Toasts: `toast` from `sonner`; the `<Toaster>` is already mounted

**Tooling and tests**
- `src/core/lib/tool-command.ts`: `toolCommand`, how anything starts `npx` or `npm`
- `src/core/lib/runtime-paths.ts`: `PROJECT_ROOT`, `resolveWithin`
- `tests/unit/source-text.ts`: `stripComments`, `relativePath`, `grepTree`, `moduleSourceDirs`
- `tests/modules/game-connect/fake-prisma.ts`: an in-memory Prisma; `tests/stubs/core-auth.ts`; `tests/e2e/helpers/login.ts`

## Taste

**Code**
- 4-space indentation, double quotes, semicolons, trailing commas on multi-line literals. There is no formatter; match the file.
- The `@/` alias across folders, never `../../`.
- Named exports, and `export function` over `export const f = () =>`. Default exports only where Next.js requires them.
- Strict TypeScript: no `any`, no `@ts-ignore` or `@ts-expect-error`, no `enum`. Prefer `interface`; props are `XxxProps`; constants are `SCREAMING_SNAKE`; an unused name starts with `_`.
- Zod 4, always `safeParse`, errors read from `.issues`.
- `catch {` when the error is deliberately ignored, `catch (err)` when it is used. Log through `log`, never `console.*`. Keep internals out of responses with `devOnlyDetail`.
- No dead code: no unused exports, unreachable files, commented-out code or leftover scaffolding.

**API routes** follow one shape: `await auth()`, then 401 without a session, 403 without permission, `readJsonBody` (return early if it returned a response), Zod `safeParse`, Prisma with an explicit `select` and `$transaction` for multi-row writes, then `logActivity(...).catch(() => {})`. A refusal is always `{ error, code? }`. There are no server actions.

**Client and server.** Server components by default. Never pass a function from a server component to a client one. Client code never imports server-only lib. Links use `@/core/lib/i18n/navigation` (modules: `@/core/sdk/navigation`), never `next/link`.

**Files.** One responsibility per file; past about 300 lines, look for the seam before adding more. No `helpers.ts`, `misc.ts` or `common.ts`, and no barrel nobody imports. A new admin screen is a route of its own, not an inline form inside a list.

**Comments** say why: a constraint, a decision, the incident that shaped the code. They do not narrate what the next line does. A doc comment on a file or its main export when the reason it exists is not obvious, in full sentences, with no `@param` boilerplate. When a rule is guarded by a test, name the test. Never `TODO`, `FIXME` or `HACK`, banner separators, notes about the author, emoji, or a history of what the code used to be unless it explains why the current shape is required.

**No em dashes** anywhere in tracked text; `npm run check:style` fails on one. Use a spaced hyphen, a comma or two sentences.

**UI.** Theme tokens only (`primary`, `destructive`, `success`, `warning`, `muted`, `border`, `card`, `foreground`, with tints such as `bg-primary/10`), never palette colours. Icons from `lucide-react` by name, or `NavIcon` for a name known at runtime; no emoji. Use the primitives above: no bare `<select>`, `type="checkbox"`, file input or raw id field, no copied button classes. Admin titles only through `AdminPageHeader`. Every destructive action asks first. Every icon-only control and every form control has an accessible name.

**i18n.** No user-facing string in JSX or a toast. `useTranslations` on the client, `getTranslations` on the server. Keys are `area_camelKey` inside a camelCase namespace. Turkish uses Turkish characters.

**Database.** Core: edit `prisma/schema.core.prisma`, add a `prisma/migrations/NNN_*.sql` for a data-bearing change, then `npm run db:merge`; a core migration never reads a module's tables. A module has its own `schema.prisma`, model names prefixed with the module, cuid ids, its relations to `User` between the `// @@user-relations-start` and `// @@user-relations-end` lines, and later changes in `module-sources/<id>/migrations/`. Never design a change that needs a destructive push; see [docs/internals/database.md](docs/internals/database.md).

**Dependencies.** Three are held back on purpose; read [docs/internals/dependencies.md](docs/internals/dependencies.md) before upgrading `eslint`, `typescript` or `next-auth`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes - APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` - verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
