# Architecture overview

Blysis is one Next.js 16 application with an empty core. What a particular site is (a store, a forum, a server list) comes from the modules installed on it and the theme it wears.

## Three layers

| Layer | Lives in | May import |
|---|---|---|
| Core | `src/core/`, `src/app/` | anything in core |
| Module | `module-sources/<id>/`, copied to `src/modules/<id>/` when installed | only the SDK, `@/core/sdk*` |
| Theme | `src/themes/<id>/` | `@/core/sdk/theme` and the UI primitives |

The constraint that shapes everything else: **core never names a module.** Not an id, not a path, not a behaviour that only makes sense for one kind of site. If core knew that a store exists, every site without a store would carry it, and a third-party module could never be a first-class one. So everything a module contributes is declared in its `module.json`, and core reads it through code generated from those manifests.

## How core reaches a module it cannot name

`scripts/generate-registry.ts` reads every manifest in `src/modules/` and writes `src/core/generated/`: the routes, the API endpoints, admin screens, permissions, settings, slots, hook listeners, cron jobs and search providers the installed modules declare. Core imports the generated registries, never a module. A site with nothing installed gets empty registries and works.

A module's public pages are served by the catch-all `src/app/[locale]/[...slug]/page.tsx`, its endpoints by `src/app/api/v1/[...path]/route.ts`, both by looking the path up in the registry. Before either is asked, `src/proxy.ts` checks whether the module that owns the path is enabled, and answers 404 for one that is not, exactly as for a path nothing declares.

## How a module reaches core

Only through `src/core/sdk/`, a set of explicit named re-exports. That boundary is the module API: `CORE_API_VERSION` in `src/core/lib/core-version.ts` versions it, and a module's manifest says which version it was built against. `scripts/validate-module.ts` fails a module that imports anything else, and the marketplace build refuses to package one.

## How modules reach each other

They do not import each other. A module that has something to say emits a hook (`src/core/lib/hooks.ts`) and declares it in its manifest's `hooksEmitted`; another lists it in `hookListeners`. A module that wants to render into another's page fills a slot (`src/core/lib/slot-registry.ts`). The marketplace build fails a listener on a hook nothing emits, because at runtime such a listener simply never fires.

## Site placeholders

A module can also publish a live value for anyone writing for the site: `placeholders` in its manifest, each answered by a handler and written `{<module>.<name>}`, core's own under `site`. The generator lists them, `src/core/lib/placeholders.ts` asks them through the cache, and the page fills them in a theme's marked text settings and in a block's words. Three things are easy to get wrong:

- A value is public. The handler is called with no session and every visitor sees its answer, so it never answers about whoever is asking.
- The dot is what separates these from an event's blanks, `{player}` in a delivery command or a Discord message. Those are filled by the module sending the event and escaped for where it goes; they are not site placeholders and do not become them.
- The root layout waits only 200 ms for the values. One that is not ready is fetched by the browser from `/api/v1/placeholders` after the page paints, so a slow handler costs its own value a moment and never the page.

## Compiled, not loaded

A module ships React server components, and Next.js compiles those at build time. There is no runtime loader, so installing a module rebuilds the site and restarts it. That decision has operational consequences, from the restart window to a single app process per installation; they are in [How an install becomes a build](./build-lifecycle.md).

## Themes

A theme is a directory in `src/themes/<id>/` with a `theme.json`, validated by `src/core/lib/theme-manifest-schema.ts`, which is the reference for every field. Its modes (light, dark or any named variant) live in that one manifest; there are no separate dark themes and no inheritance between themes. Settings a theme declares are rendered by core at `/admin/theme/<group>`, so a theme author writes no React for them, and a theme overrides a core component only through a `ThemeComponentSlot` that core places. Those slots include the whole frame of a public page (`SiteShell`, `PageHeader`, `AuthFrame`), so a theme changes where things sit by replacing the frame, never by editing a page.

Every installed theme is compiled into every build, and two things follow from that. A theme's `stylesheet` lands in the one stylesheet the site serves, so the generator prefixes every selector with `[data-theme="<id>"]` (`scripts/lib/theme-stylesheet.ts`); it is unlayered, which means it wins over Tailwind's utilities. A theme's `fontFiles` become `next/font/local` calls with preloading off, or a site would download the fonts of themes it is not wearing.

The filesystem is the source of truth for which themes exist: there is no `Theme` table. `ThemeState` holds the active theme and mode, `ThemeCustomization` an admin's token overrides per theme and mode, and `ThemeSetting` the values of a theme's settings.

## Data

One PostgreSQL database. The core schema is `prisma/schema.core.prisma`; each module that stores data ships its own `schema.prisma`, merged into `prisma/schema.prisma` for the installed set. How tables come and go without ever dropping an admin's data is in [Database](./database.md).

Redis holds rate-limit counters and caches. Production refuses to run its rate limiter without it rather than fall back to a per-process counter anyone can sidestep.

## Conventions are tests

Most rules in [AGENTS.md](../../AGENTS.md) are enforced by tests in `tests/unit/` that read the source as text. Why, and how to write one that can actually fail, is in [Conventions as tests](./gates.md).
