# Glossary

The words this codebase, its comments and its commit messages use, and what each one means here.

**operator**: whoever installed a site and runs its server. They use the installer and the `blysis` command, rarely the code.

**admin**: a signed-in account holding the `admin` role. `admin` is the one role name core treats specially; every other role is the operator's to create, rename and rank, and is judged by its priority and permissions, never by its name.

**staff**: an account whose role's priority reaches `STAFF_ROLE_PRIORITY`. Not a role name.

**member**: any other signed-in account. **visitor**: someone not signed in.

**the panel**: the admin UI under `/admin`.

**core**: `src/core/` and `src/app/`, what every site runs whatever is installed on it.

**module**: a feature package with a `module.json`. Its **source** is `module-sources/<id>/`; an **installed** module is a copy in `src/modules/<id>/`, compiled into the site. A module is **enabled** or **disabled** per site without being installed or removed.

**theme**: a look, in `src/themes/<id>/`, declared by `theme.json`. One is **active**.

**manifest**: a module's `module.json` or a theme's `theme.json`. Everything a module contributes is declared there.

**registry**: code generated from the installed manifests into `src/core/generated/`. It is how core reaches modules without naming them.

**SDK**: `src/core/sdk/`, the only part of core a module may import, versioned by `CORE_API_VERSION`.

**hook**: a named event (an action) or a value others may change (a filter) that one module emits and others listen to. **slot**: a named place in a page that modules render into.

**marketplace**: `module-marketplace/`, the archives and catalogue sites install modules from.

**install**: copying a module into `src/modules/`, adding its tables and rebuilding the site. **build** is that rebuild; a **staged** build is one finished beside the live build and not yet promoted to it.

**gate**: a test that reads source as text and enforces a convention.

**allow-list**: a gate's list of deliberate exceptions, each with the reason.
