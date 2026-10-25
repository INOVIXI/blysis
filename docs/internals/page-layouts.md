# Arranged pages

The homepage, and every page a module declares in `pages`, is a list of rows, each split into cells, each cell holding blocks. A module offers blocks; a theme says where they stand. This note keeps the decisions behind that and the traps in it. The code is `src/core/lib/page-layout.ts` (the resolver), `src/core/lib/page-layout-schema.ts` (the document), `src/core/lib/page-blocks.ts` (the catalogue), `src/core/components/layout/PageLayoutView.tsx` (the homepage), `src/core/components/layout/arranged-rows.tsx` (a page's rows) and `src/core/lib/arrangeable-pages.ts` (every page there is to arrange).

## The arrangement is the theme's code, and nothing is stored

A theme that needs a homepage of its own ships it as `layouts.home` in its `theme.json`, and a page of a module's as `layouts["<module>.<page>"]`. A theme that ships none gets the default: for the homepage core's, which is the page Blysis always drew, the sections in the main column and the widgets beside them; for a module's page the arrangement the module declares beside it. There is no layout editor and no table holding an arrangement. One was designed and dropped: the people who change a theme's page are the theme's authors, a document in a manifest is reviewed and versioned with the CSS that styles it, and a saved copy would have gone stale the first time the theme changed underneath it.

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

## A module's page

Every public page is arranged, and `a-page-looks-like-the-page-next-to-it` fails on one drawn straight into `PageFrame`. A page a module draws, a product or the cart, declares in its manifest the blocks it is built from and a default arrangement. A page that reads its data on the server draws them through `ArrangedPage` from `@/core/sdk/page`, handing it a function per block, so a block is the page's own markup and may be a server component. A page that reads its data in the browser draws them through `ArrangedClientPage` from `@/core/sdk/layout`, which resolves the same arrangement from the theme manifest the browser already holds, so the page does not move once it has painted. Core's own public pages are declared the same way in `src/core/lib/arrangeable-pages.ts`, under `core`. The blocks are not in the homepage's catalogue and cannot be placed on any other page, and a theme's arrangement for a page may name only that page's blocks, which `a-theme-places-only-blocks-that-exist` checks.

A page that is still reading, or has nothing to show, passes no blocks and says so as the frame's children: a block the page hands no way to draw is not drawn, and a row left with none is not drawn either. The waiting page therefore stands in the same frame as the answer, header hidden or not.

The default arrangement must draw the page exactly as it stood before it was arranged, because Flat and every theme without an arrangement for it show that default. Four things in `ArrangedPage` exist for that and nothing else: a page's rows stand `1.5rem` apart unless the theme sets `--blysis-row-gap` (the homepage's are `2rem`); a block alone in its cell fills the cell, so cards side by side end level as they did in a grid of the page's; a page's two halves sit side by side from a tablet up; and a page whose third beside two thirds is its own column rather than a sidebar says `sidebar={false}`, so the column is not drawn, styled or spaced as a sidebar. A block that sticks, such as a product's buy box, sticks only when its box is as tall as its column, which the filling gives it. When an arrangement moves something, compare the page under a theme without one before and after, at a desk and on a phone.

An arrangement may hide the header band (`header: "hidden"`) for a page that opens on something naming it already. The title stays the page's one `h1`, read but not seen, so a block that shows the name draws it as a paragraph hidden from screen readers, and the crumb trail the header carried has to be offered as a block of its own if the page needs one.

