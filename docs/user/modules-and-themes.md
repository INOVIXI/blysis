# Modules and themes

A new Blysis site does nothing on its own. Every feature (a store, a forum, server status, votes, tickets) is a module, and every look is a theme. Both are added from the panel.

## Installing a module

**Admin > Modules** lists the official marketplace. Install one, or tick several and install them together; a batch costs the same wait as a single module.

Installing a module compiles its pages into the site, so the site restarts afterwards. Expect it to be unavailable for anything from a few seconds to a few minutes, depending on the server. On a busy site, install modules at a quiet hour.

A database backup is taken before every install, update and removal.

**Upload ZIP** on the same screen installs a module that is not in the marketplace: a ZIP with a `module.json` at its root. A module runs with the site's full access, so install only modules from someone you trust.

## Updating, switching off and removing

- A module with a newer version in the marketplace shows an update on its row.
- **Disable** switches a module off without removing it: its pages, menu entries and jobs disappear, and its settings and data stay.
- **Delete** removes the module's files. Its database tables are kept, so installing it again later brings its data back.

Each installed module's own settings open from its row.

## Themes

- **Admin > Settings > Theme** is the theme library: switch the active theme, upload a new one as a ZIP, or delete one. An uploaded theme becomes available after the site restarts (`blysis restart`).
- **Admin > Theme > Appearance** changes the active theme's colours, separately for light and dark mode, and its own settings.
- **Admin > Settings > CSS** adds custom CSS on top of the theme.
