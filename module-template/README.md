# Module Template

Starter for new Blysis modules. The `npm run create:module` script copies this directory into `module-sources/<id>/` and rewrites placeholders in every file.

---

## Scaffold a module

```bash
npm run create:module my-module "My Module" "Short description"
```

Arguments:

| Position | Value | Required | Default |
|----------|-------|----------|---------|
| 1 | Module ID | Yes | - (lowercase, letters/digits/hyphens, starts with a letter, no double hyphens) |
| 2 | Display name | No | Title-cased from the ID |
| 3 | Description | No | `"<Name> module for Blysis"` |

The script:

1. Copies `module-template/` into `module-sources/<id>/`.
2. Walks every text file and replaces these placeholders:

   | Placeholder | Replaced with |
   |---|---|
   | `my-module` | `<id>` |
   | `My Module` | `<name>` |
   | `MyModule` | `<id>` PascalCase |
   | `myModule` | `<id>` camelCase |
   | `mymodule` | `<id>` with hyphens stripped |
   | `MyModuleItem` | `<PascalCase>Item` |
   | `myModuleItems` | `<camelCase>Items` |
   | `"myModule"` (in translations) | `"<camelCase>"` |
   | `A template module for Blysis` | `<description>` |

3. Rewrites `module.json` cleanly (sets `id`, `name`, `description`; strips the `_comment` field).
4. Prints the next-steps checklist.

---

## What's in the template

```
my-module/
├── module.json              Complete manifest with every common field - delete what you don't need
├── schema.prisma            Example Prisma model with @@user-relations marker block
├── api/
│   └── route.ts             Example handler with GET (paginated list) + POST (admin-only create)
├── pages/
│   ├── public/page.tsx      Public landing page
│   └── admin/page.tsx       Admin management page
├── components/
│   └── ExampleWidget.tsx    Generic reusable component (used by layoutComponents / navbarComponents demo)
├── widgets/
│   └── ExampleWidget.tsx    Homepage sidebar widget component
└── messages/                Locale JSON files (en / tr / de) - translations are ALSO inline in module.json
    ├── en.json
    ├── tr.json
    └── de.json
```

Only `module.json` is required. Delete any directory or file you don't need.

---

## module.json - what to keep, what to delete

The template manifest enumerates every common UI registration so you can see all the options in one place. Remove fields you don't use.

### Required

| Field | Description |
|-------|-------------|
| `id` | Unique identifier. Must match the directory name. |
| `name` | Display name shown in marketplace and admin UI. |
| `description` | Short description. |
| `version` | Semver string. |

### UI registration (all optional)

| Field | Purpose |
|-------|---------|
| `routes` | Public pages → `/[locale]/[path]` |
| `adminRoutes` | Admin pages → `/[locale]/admin/[path]` |
| `api` | API handlers → `/api/v1/[path]` |
| `menu` | Admin sidebar items |
| `navLinks` / `footerLinks` | Public navbar and footer entries |
| `navbarComponents` / `footerComponents` | Navbar right-side and footer components |
| `layoutComponents` | Site-wide components with URL include/exclude filters |
| `homepageSections` / `widgets` | Homepage main content and sidebar widgets |
| `profileTabs` | Tabs added to the user profile page |
| `dashboardCards` + `statsApi` | Admin dashboard stat cards + data endpoint |
| `settingsCards` | Cards on the admin Settings page |
| `oauthButtons` | OAuth login/register buttons |
| `slotContents` | Render into core (`layout.beforeMain`, `layout.afterMain`, `head.extra`) or theme-declared slots |

### Behavior (all optional)

| Field | Purpose |
|-------|---------|
| `dependencies` | Module IDs that must be installed and enabled |
| `conflicts` | Module IDs that cannot be active simultaneously |
| `permissions` | RBAC permission strings this module registers |
| `settings` | Admin-editable settings, read with `moduleSettings("<id>")` |
| `cronJobs` | Background scheduled tasks |
| `webhookReceivers` | Inbound webhook endpoints (HMAC verification supported) |
| `hookListeners` | Action/filter listeners auto-wired at build time |
| `searchProviders` | Contributors to `GET /api/v1/search` |
| `storageProviders` | File-storage backends implementing `StorageProvider` |
| `seoRoutes` | Sitemap contribution handler |
| `notificationTypes` | Event types surfaced in user notification preferences |
| `translations` | Inline `{ locale: { namespace: { key: value } } }` synced to the `Translation` DB table |

---

## Database models

The template ships a `schema.prisma` with one example model and a commented `@@user-relations-start` block. Edit or delete it.

```prisma
// @@user-relations-start
items MyModuleItem[]
// @@user-relations-end

model MyModuleItem {
  id        String   @id @default(cuid())
  title     String
  status    String   @default("ACTIVE")
  createdAt DateTime @default(now())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([status])
}
```

Naming rules:

- Prefix model names with your module name (e.g. `MyModuleItem`) so two modules can't collide on a table name. The merger aborts on conflict.
- Use `cuid()` for primary keys.
- Add `@@index` for frequently queried fields.

To add fields on the core `User` model, declare them inside the marker block - `scripts/merge-schemas.ts` injects them into the core schema at the `// @@MODULE_RELATIONS` marker.

After editing the schema:

```bash
npm run db:merge      # merge core + every module schema into prisma/schema.prisma + run prisma generate
npm run db:push       # apply the diff to the database
```

For schema changes against an already-deployed module, write a SQL migration in `migrations/NNN_description.sql`.

If your module has no database models, delete `schema.prisma` entirely.

---

## Local development workflow

```bash
# 1. Scaffold
npm run create:module my-module "My Module" "What it does"

# 2. Edit module.json - keep only the fields you need
# 3. Edit schema.prisma - define your models (or delete the file)

# 4. Merge schema and push to DB (skip if no schema)
npm run db:merge && npm run db:push

# 5. Validate the manifest
npm run validate:module module-sources/my-module

# 6. Install locally - fast path (bypass the marketplace UI)
cp -r module-sources/my-module src/modules/my-module
npx tsx scripts/generate-registry.ts

# 7. Start the dev server
npm run dev
# Enable the module from /admin/modules
```

Or install through the admin marketplace UI after packaging:

```bash
npm run build:marketplace
# Upload module-marketplace/my-module.zip via Admin > Modules > Upload ZIP,
# or install from Admin > Modules > Marketplace.
```

`build:marketplace` rebuilds every ZIP from `module-sources/` and regenerates `module-marketplace/index.json`.

---

## Conventions (quick reference)

- **Server components by default** - add `"use client"` only when needed.
- **No hardcoded UI strings** - use `useTranslations()` (`next-intl`) or declare `translations` in `module.json`.
- **Auth checks** - admin pages call `isAdmin()` from `@/core/sdk/server`; write API endpoints verify `session.user.id` + `hasPermission()`.
- **Imports** - the SDK (`@/core/sdk`, `/server`, `/auth`, `/navigation`, `/blocks`, `/theme`, `/ui`, `/layout`, `/admin`) for core, relative paths within the module. Reaching into `@/core/lib/*` or `@/core/components/*` fails `npm run validate:module`.
- **No `any`** - TypeScript strict mode.
- **No `confirm()` / `alert()`** - use `useConfirm()` + `toast` from `sonner`.
- **No emojis in UI** - Lucide icons only.
- **API responses** - `{ ok: true, data }` / `{ ok: false, error, code?, details? }` via `apiSuccess` / `apiError` / `apiPaginated` from `@/core/sdk/server`.
- **Zod 4** - read validation issues from `.issues`, not `.errors`.
- **Routing** - `Link`, `usePathname`, `redirect` from `@/core/sdk/navigation`, not `next/link`.

---

## Validate

```bash
npm run validate:module module-sources/my-module
```

Runs structural and manifest checks against the module source.

---

## Build and publish

```bash
# Rebuild every marketplace ZIP from module-sources/
npm run build:marketplace
# Writes module-marketplace/my-module.zip + updates module-marketplace/index.json
```

Commit the source tree under `module-sources/<id>/`, the generated `module-marketplace/<id>.zip`, and the updated `module-marketplace/index.json` together in the same commit. Never commit anything under `src/modules/` (gitignored runtime state) or `src/core/generated/` (codegen output).
