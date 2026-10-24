# The homepage's arrangement

The homepage is a list of rows, each split into cells, each cell holding blocks. A module offers blocks; a theme says where they stand. This note keeps the decisions behind that and the traps in it. The code is `src/core/lib/page-layout.ts` (the resolver), `src/core/lib/page-layout-schema.ts` (the document), `src/core/lib/page-blocks.ts` (the catalogue) and `src/core/components/layout/PageLayoutView.tsx` (the drawing).

## The arrangement is the theme's code, and nothing is stored

A theme that needs a homepage of its own ships it as `layouts.home` in its `theme.json`. A theme that ships none gets core's, which is the page Blysis always drew: the sections in the main column, the widgets beside them. There is no layout editor and no table holding an arrangement. One was designed and dropped: the people who change a theme's page are the theme's authors, a document in a manifest is reviewed and versioned with the CSS that styles it, and a saved copy would have gone stale the first time the theme changed underneath it.

What an operator has is **Settings > Widgets**, and it holds over any arrangement. A block switched off there is drawn nowhere, whoever placed it, and the blocks the page adds by itself come in the order saved there. A block keeps the switch and the place in that order it had as a widget or section through `replaces` in its manifest.

## Words only the site knows

A layout can only say what the theme knows. Two ways carry the rest:

- A text setting that names a message key (`"quarry.newsTitle"`) is drawn translated, by `useBlockText`, so a theme's headings follow the reader's language. Anything else is drawn as written.
- `{ "$theme": "<group>.<field>" }` fills a setting from one of the theme's own settings, which the operator fills in on the theme's settings screen. The manifest schema refuses a reference to a field the theme does not declare.

## A block is laid out by its box

A block can stand in a full row, a wide cell or a narrow one, and the screen says nothing about which. Its box is a container (`@container`), and its component uses container variants only; `tests/unit/a-block-is-laid-out-by-its-box.test.ts` refuses a viewport breakpoint. A block declares the widths it works at, and the resolver leaves it out of a cell of any other width.

## What the page adds by itself

A block nobody placed and nobody hid, a module installed after the theme was written for instance, goes to the row the document marks `rest`. In a row of equal cells it is dealt across them from the rest cell on, so a row of three cards does not end with one column several cards taller than the others. A document with no rest cell gets rows of its own for them. `hidden` lists blocks a theme placed something else in place of, such as a widget whose content a block of its own already shows.

`tests/unit/a-theme-places-only-blocks-that-exist.test.ts` checks every theme's arrangement against the blocks core and the first-party modules offer. The resolver drops a block it cannot place without a word, as it must on a site that lacks the module, so a misspelt id would otherwise be invisible.

## A block that drew nothing takes no room

A block with nothing to show renders nothing, and its box is `:empty`. A row in which no block drew is hidden, and the space between rows is counted only between rows that drew (`--blysis-row-gap`, which a theme sets instead of writing a spacing rule of its own). Two traps shaped the CSS in `src/app/globals.css`: `:has()` may not be nested inside `:has()`, and a selector that does so is dropped without an error; and React streams a `<template>` in place of a block that has not resolved, which a plain `:empty` would count as nothing.

A block whose content is other modules' slot content, such as core's stats row, is an empty frame when they all drew nothing, and is hidden by name for that reason.

## Places a module can reach on a theme's page

Core's own blocks are listed in `src/core/lib/core-blocks.ts` under the reserved module id `core`. The stats row draws the `home.stats` slot first, where a module gives a live tile with `StatTile`. A theme's hero draws `hero.tags` before its own label, where a module gives a short status such as whether the server is open, and `hero.bottom` under its buttons. A theme's sign-in screens may draw `auth.login.aside`, for someone coming back, and `auth.register.aside`, for someone new, beside the form. These slots are a convention between themes and modules rather than core chrome, so a theme that draws none of them simply shows none.
