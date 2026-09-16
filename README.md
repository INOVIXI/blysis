<div align="center">
  <h1>Blysis</h1>

  <p><strong>A plugin-first platform whose core ships empty.</strong></p>
  <p>Game-server websites, digital storefronts and community portals. Every feature is a module installed at runtime from a built-in marketplace, or uploaded as a ZIP.</p>

  [![CI](https://github.com/INOVIXI/blysis/actions/workflows/build-and-test.yml/badge.svg)](https://github.com/INOVIXI/blysis/actions/workflows/build-and-test.yml)
  [![Release](https://img.shields.io/github/v/release/INOVIXI/blysis?display_name=tag&sort=semver)](https://github.com/INOVIXI/blysis/releases)
  [![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

  ![Next.js](https://img.shields.io/badge/Next.js-16.3-black?logo=next.js)
  ![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue?logo=typescript)
  ![Prisma](https://img.shields.io/badge/Prisma-7.10-2D3748?logo=prisma)
  ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-4169E1?logo=postgresql&logoColor=white)
  ![Tailwind](https://img.shields.io/badge/Tailwind-4-38BDF8?logo=tailwindcss)
  ![Auth.js](https://img.shields.io/badge/Auth.js-v5-purple)
</div>

---

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/INOVIXI/blysis/main/install.sh | sudo bash
```

One command on a fresh VPS. It installs Docker if the machine does not have it,
generates every secret, pulls a prebuilt image, starts Postgres, Redis and the
app, waits until the site answers, and prints the URL and the admin password.
Three questions, each with a default. Give it a domain and it also obtains and
renews an HTTPS certificate on its own.

Afterwards the machine has a `blysis` command: `update`, `backup`, `restore`,
`logs`, `status`, `restart`.

Then open the site, finish the setup wizard, and install modules from
**Admin > Modules > Marketplace**.

---

## What makes it different

**The core knows nothing about any module or theme.** No module names, no module
paths, no module-specific code anywhere in `src/core/`. No theme names
hardcoded. Everything is registry-driven from manifests, and three CI gates fail
the build if that stops being true. When a module is not installed, zero traces
of it exist in core.

That constraint is the product. It is what lets a site be assembled from parts
at runtime without the parts leaking into each other, and it is why a module
author only ever edits their own directory.

### Three strict layers

1. **Core** (`src/core/`) is site-type-agnostic infrastructure: auth, RBAC,
   i18n, navigation and footer structure, health, rate limiting (Redis with a
   memory fallback), maintenance mode, uploads, SEO. It declares a fixed set of
   canonical slots: the generic `layout.beforeMain`, `layout.afterMain`,
   `head.extra`, plus layout-position slots `layout.top`, `layout.bottom`,
   `navbar.start`, `navbar.end`, `footer.top`, `mobile.nav`.
2. **Modules** (`src/modules/<id>/`) are the feature layer. Everything a module
   contributes is declared in its `module.json`.
3. **Themes** (`src/themes/<id>/`) are presentation and composition, declared in
   `theme.json` (`schemaVersion: 2`).

### Modules are compiled, not loaded

This is the one architectural fact that leaks into operations, so it belongs
above the fold rather than buried in a deployment guide.

A module ships React server components, and Next.js compiles those at build
time. There is no runtime loader that could render them. **Installing a module
therefore rebuilds the app and replaces the process**, on a 3-second debounce so
a bulk install of thirty modules produces one build:

```
db:merge → apply-schema-additions → apply-migrations → generate-registry
         → npm run build → record the build fingerprint → SIGTERM
```

Two consequences worth knowing before you deploy:

- **Run the app under a supervisor.** Docker Compose (`restart: unless-stopped`),
  systemd (`Restart=always`) and pm2 all qualify. A bare `npm start` in a
  terminal does not: the process exits after an install and nothing brings it
  back. The Docker install gets this right with no configuration.
- **One app process per installation.** Not one per core. Two processes sharing
  the modules volume would both build into the same `.next` and the loser would
  serve a half-written build.

Expect a gap of seconds to minutes while a build runs, so install modules during
a quiet window on a busy site. A rebuild that fails is loud in the logs but does
not stop the boot: the previous build keeps being served, so the admin panel
stays reachable and the offending module can be removed. On every boot,
`scripts/reconcile-build.ts` compares a fingerprint of `src/modules/` against
the one recorded beside the build and rebuilds only when they disagree.

---

## Modules

78 first-party modules ship in `module-marketplace/` as ZIPs with an
`index.json` catalog. Their sources live in `module-sources/<id>/` and are
tracked in git; the ZIPs are built from those sources by
`npm run build:marketplace`, and CI fails if the two drift apart.

| Category | Modules |
|----------|---------|
| Commerce | credits, currency, leaderboard, license-keys, store, vote, wheel |
| Payment gateways | coinbase-commerce-gateway, coinpayments-gateway, iyzico-gateway, mercadopago-gateway, midtrans-gateway, mollie-gateway, nowpayments-gateway, param-gateway, paymentwall-gateway, paypal-gateway, paysafecard-gateway, paytr-gateway, razorpay-gateway, stripe-gateway |
| Community | blog, changelog, forum, in-app-notifications, referral, suggestions, trophies |
| Gaming | downloads, minecraft-link, player-profiles, punishments, servers |
| Management | announcements, help-center, login-protection, popups, staff, tickets, two-factor-auth |
| Content | cookie-consent, custom-forms, custom-pages, email-templates, seo, slider |
| Sign-in | apple-auth, battlenet-auth, discord-auth, epicgames-auth, facebook-auth, faceit-auth, github-auth, google-auth, instagram-auth, kakao-auth, kick-auth, line-auth, microsoft-auth, naver-auth, patreon-auth, reddit-auth, roblox-auth, spotify-auth, steam-auth, tiktok-auth, twitch-auth, vk-auth, x-auth, yandex-auth |
| Integration | cloudflare-r2, cloudflare-turnstile, csv-import-export, discord-integration, discord-widget, google-analytics, resend-provider, webhook-logs |

A `module.json` declares everything the module contributes: routes, admin
routes, API endpoints, sidebar menu, dashboard cards, widgets, navbar/footer/
layout components, profile tabs, settings cards, OAuth buttons, dependencies,
conflicts, RBAC permissions, cron jobs, webhook receivers, hook listeners, slot
contributions, search providers, page-builder blocks, notification types and
translations.

**Compatibility contract.** A manifest declares `coreVersion`, a semver range
over `CORE_API_VERSION` (the module-facing contract version, deliberately
separate from the product version), and may pin dependencies as
`"store@^1.2.0"`. Install, update and enable all refuse a module the running
core or the installed dependencies cannot satisfy, rather than failing later at
runtime.

**Module SDK.** Modules import core through `@/core/sdk` (isomorphic),
`@/core/sdk/server`, `@/core/sdk/auth`, `@/core/sdk/navigation`,
`@/core/sdk/blocks` and `@/core/sdk/theme`, split by runtime so a client
component can never pull `prisma` into its bundle. Core's internal layout
(`@/core/lib/*`) is not part of the contract; reaching into it fails
`npm run validate:module`, the marketplace build and ESLint.

**Dependency resolution.** Every install path plans before it installs.
`resolveInstallPlan` expands the selection transitively, orders it topologically
so prerequisites are extracted first, reports what it added on the operator's
behalf, and refuses cycles, conflicts, unknown ids and version mismatches rather
than installing part of a set.

**Lifecycle.** install (extract ZIP, regenerate registry, create tables, run
module SQL migrations, create the `ModuleConfig` row, sync translations) →
enable → disable (vanishes from every UI surface, data preserved) → uninstall
(files removed, `ModuleConfig` deleted, admin-overridden translations and module
tables preserved so a reinstall keeps the data). `ModuleConfig.enabled` in the
database is the single source of truth for whether a module is active.

**Install safety.** A Postgres advisory lock prevents two installs from racing.
Registry regeneration runs synchronously and rolls back the filesystem on
failure, so there are no silent partial installs. Uploaded ZIPs are checked for
path traversal, reserved ids, manifest schema violations, id mismatches and
manifest file references that point outside the module directory.

---

## Themes

Themes live in `src/themes/<id>/` behind a `theme.json` manifest;
`schemaVersion: 2` is required and v1 manifests are rejected at upload. Modes
(light, dark, or any named variant) live inside a single manifest: there are no
separate dark-variant themes and no parent inheritance.

A theme manifest can declare:

- **`modes`**: the default mode plus per-mode token values (`tokens.colors`, `tokens.fonts`).
- **`tokens.colors` / `tokens.fonts` / `tokens.radius` / `tokens.space`**: field definitions for the customizer.
- **`settings.<group>.fields.<key>`**: schema-driven admin settings. Core auto-renders `/admin/theme/<group>` with labels, inputs and save/reset, so a theme author writes zero React for these. Field types: `text`, `url`, `color`, `richtext`, `image`.
- **`components.<Name>: "components/Foo.tsx"`**: React component overrides, wired via `<ThemeComponentSlot name="...">`.
- **`slots` / `slotContents`**: declare named slots, and contribute into your own or core-declared ones.
- **`adminNav.label` / `adminNav.icon`**: the sidebar "Theme" group label and Lucide icon for this theme.
- **`adminRoutes`**: an escape hatch for custom React admin pages.
- **`suggestedModules`**: an opt-in banner recommending modules. Never auto-installs.
- **`translations`**: synced to the `Translation` table on activation.

**Shipped themes:**

| Theme | Description |
|-------|-------------|
| `flat` | The default. Light and dark modes in one manifest, on a neutral gray palette with a single blue accent; every token pair meets WCAG AA. No component overrides, no settings. |

**Data model.** `ThemeState` (singleton, `id = 1`) holds the active theme id and
mode. `ThemeCustomization` (`@@unique([themeId, mode])`) holds mode-scoped token
overrides. `ThemeSetting` (`@@unique([themeId, groupKey, key])`) holds settings
values; `groupKey` is named that way because `group` is a SQL reserved word.
There is no `Theme` model: the filesystem plus codegen is the source of truth
for whether a theme exists.

---

## Develop locally

Requires Node.js 24+ and PostgreSQL 14+. Redis is optional locally and required
in production, where the rate limiter fails closed without it.

```bash
git clone https://github.com/INOVIXI/blysis.git
cd blysis
npm install                            # postinstall runs db:merge + generate-themes + generate-registry

cp .env.example .env
# Edit .env - at minimum DATABASE_URL, AUTH_SECRET, AUTH_URL

npm run db:merge                       # merge core + module schemas
npm run db:push                        # push the merged schema to a fresh database
npm run db:seed                        # 3 roles + admin user
npx tsx scripts/seed-translations.ts   # default locale strings
npm run dev                            # Turbopack on http://localhost:3001
```

The seed creates `admin@example.com` with a **randomly generated password,
printed once** in the seed output. Copy it before the terminal scrolls, or set
`SEED_ADMIN_PASSWORD` (and optionally `SEED_ADMIN_EMAIL`) beforehand to choose
your own. Re-seeding never resets an existing admin's password.

`db:push` is for a fresh local database only. The running app never pushes: it
applies additive schema statements instead, because uninstall deliberately
leaves module tables behind and a push would drop or refuse them.

`install.sh` covers production setup, environment variables, backups and
hardening on a fresh machine.

---

## Project structure

```
src/
  app/[locale]/             Next.js App Router, i18n locale segment
    (admin)/                Admin panel
    (auth)/                 Auth pages
    (public)/               Public pages
    (setup)/                First-run wizard: site-type presets, categorised module picker
    [...slug]/              Catch-all for module-contributed public routes
  app/api/v1/               Core REST API + [...path] catch-all for module APIs
  core/                     Site-type-agnostic infrastructure
    components/             Shared UI primitives, layout, admin shell
    generated/              Codegen output (gitignored)
    lib/                    Utilities and services: db, auth, hooks, scheduler, ...
    sdk/                    The module-facing contract
    providers/              ModuleProvider, ThemeProvider
  modules/                  Installed module state (gitignored, populated at runtime)
  themes/                   Installed themes (flat ships in-tree)
  proxy.ts                  Middleware: i18n, module route gating, CSRF

messages-core/{en,tr}.json       Core translation seed sources
module-sources/<id>/             Authoritative source for the 42 first-party modules
module-marketplace/              Distributable ZIPs + index.json catalog
module-marketplace/presets.json  Site-type presets read by the setup wizard (data, not core code)
theme-marketplace/               Distributable theme ZIPs
module-template/                 Starter for `npm run create:module`
scripts/                         Codegen, migration, backup and marketplace tooling
prisma/schema.core.prisma        Core schema (never edit the merged schema.prisma)
```

---

## Commands

```bash
# Development
npm run dev              # Dev server (Turbopack, port 3001, 0.0.0.0)
npm run build            # Production build (prebuild regenerates schema, themes, registry, openapi)
npm run start            # Production server

# Database
npm run db:merge         # Merge core + module schemas into prisma/schema.prisma
npm run db:generate      # prisma generate
npm run db:push          # Push the merged schema to a fresh database
npm run db:migrate       # Apply per-module SQL migrations
npm run db:seed          # 3 roles + admin user
npm run db:studio        # Prisma Studio
npm run db:backup        # Gzipped SQL dump to ./backups/
npm run db:restore       # Restore from a backup file

# Code generation
npm run generate:themes                       # theme registry, tokens CSS, components, admin routes
npx tsx scripts/generate-registry.ts          # module registry, routes, hooks, crons, ...
npx tsx scripts/generate-openapi.ts           # src/core/generated/openapi.json from manifests
npx tsx scripts/seed-translations.ts          # Sync translations from messages-core + manifests into the DB
npx tsx scripts/apply-schema-additions.ts     # Additive-only schema sync (what installs run)
npx tsx scripts/reconcile-build.ts            # Rebuild if src/modules/ no longer matches the build

# Module authoring
npm run create:module <id> "Name" "Desc"      # Scaffold from module-template/
npm run module:add-block                      # Add a page-builder block
npm run module:add-hook                       # Add a hook listener
npm run module:add-slot                       # Add a slot contribution
npm run module:add-cron                       # Add a cron job
npm run module:add-search                     # Add a search provider
npm run module:list                           # List modules and what they declare
npm run validate:module module-sources/<id>   # Validate one manifest (--all for every module)
npm run build:marketplace                     # Rebuild every ZIP from module-sources/
npx tsx scripts/migrate-module-imports.ts <path>   # Rewrite @/core/lib imports onto the SDK

# Quality gates (all of these run in CI)
npm run typecheck                             # tsc --noEmit over core + app
npm run typecheck:modules                     # tsc --noEmit over module-sources/
npm run lint                                  # ESLint, including the SDK boundary rules
npm run check:style                           # House style: hyphens, never em dashes
npx tsx scripts/check-marketplace-sync.ts     # ZIPs match module-sources/ and index.json
npm test                                      # Vitest
npm run test:coverage                         # Vitest with coverage thresholds
npm run test:e2e                              # Playwright

npm run clean                                 # Clear .next + node_modules/.cache
```

---

## Authoring a module

```bash
npm run create:module my-module "My Module" "Short description"
# Creates module-sources/my-module/ from module-template/ with placeholders replaced.

# Edit module.json, and optionally schema.prisma, components, pages, api/
npm run db:merge && npm run db:push           # if you added DB models
npm run validate:module module-sources/my-module
npm run build:marketplace                     # package as a ZIP and update index.json
```

Install it via **Admin > Modules > Upload ZIP** or the marketplace, then flip the
toggle on the module card.

For a faster local loop you can copy the source straight into
`src/modules/<id>/` and run `npx tsx scripts/generate-registry.ts` to wire it up
without packaging.

[module-template/README.md](module-template/README.md) is a walkthrough of the
starter.

---

## Contributing

Issues and pull requests are welcome. `npm run typecheck && npm run lint &&
npm test` should be green before you open one, and a change to core which
mentions a module by name will be rejected by CI regardless of how well it
works. [SECURITY.md](SECURITY.md) covers reporting a vulnerability and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) the community expectations.

---

## License

MIT. See [LICENSE](LICENSE).
