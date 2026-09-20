/**
 * Version of the module-facing contract - NOT the product version in
 * package.json.
 *
 * These are deliberately separate. The product version moves for reasons that
 * do not affect modules (UI work, dependency bumps, releases), and coupling
 * the two would force every module to widen its `coreVersion` range for
 * changes that cannot possibly break it.
 *
 * Bump the minor when the SDK gains a symbol, or when the manifest gains an
 * optional capability a module might need to require. Bump the major when a
 * symbol changes shape or is removed - that is the signal a module's declared
 * range is meant to catch.
 *
 * 5.12.0 - `Badge` takes `solid`, and `aspect-card` is the shape every cover
 * picture is drawn in. Every tone was a ten percent wash over whatever sits
 * behind it, which is right on a panel and wrong on a photograph: the shop
 * drew "Featured" in warning-on-warning-tint over a saturated product banner
 * and the word disappeared into the picture. A badge that sits on an image
 * brings its own background now. Additive on both counts: a badge without
 * `solid` is drawn exactly as before.
 *
 * 5.11.0 - `MemberAvatar`, `MemberLink` and `CountBadge` join `@/core/sdk/ui`.
 * Five screens drew a member's face and each one disagreed about size, shape
 * and what to draw for the members who have no picture, which is most of
 * them: a grey silhouette twenty times over says nothing about who is in the
 * list. A face is initials on a colour the name itself picks, so the same
 * person is the same colour everywhere, and `MemberLink` puts the name beside
 * it pointing at their profile where a module that serves profiles is
 * installed. `CountBadge` is the number on the corner of the bell and the
 * cart, which were written twice and identically wrong.
 *
 * 5.10.0 - `AdminCrudPage` marks a row that is switched off, and takes
 * `activeField` for a screen whose switch is not called `isActive`. Twelve
 * module screens declared such a toggle and not one drew it in the list, so a
 * deactivated download, slide, prize or server looked exactly like a live one
 * until somebody opened it. Additive: a screen that passes nothing gets the
 * convention, and a screen with no such toggle is untouched.
 *
 * 5.9.0 - a mail transport is a module. `emailProvider` in a manifest takes
 * a `handler` exporting `isConfigured` and `send`, the generator collects them
 * into `EmailProviderRegistry`, and `emailProviders` and
 * `ACTIVE_EMAIL_PROVIDER_KEY` join `@/core/sdk` so a provider's own screen can
 * offer the choice between the transports installed. Core used to import a
 * vendor's client and call it, which named a vendor in core and meant there
 * was exactly one way to send mail on the whole platform. Called directly
 * rather than through the hook bus: every listener there is raced against a
 * five second timeout, and an SMTP send that times out at the bus while
 * arriving at the relay is a message the queue sends twice.
 *
 * 5.8.0 - `recordWebhookDelivery`, `redactWebhookTarget` and the
 * `WebhookDelivery` type join `@/core/sdk/server`, and core fires
 * `core.webhook.delivered` after every webhook it sends. The table that keeps
 * them belongs to a module and had no writer at all: it was read, searched,
 * paged and expired after thirty days while nothing anywhere inserted a row.
 * The address is cut to its origin on the way, because a webhook URL is the
 * key to whatever is behind it and a log outlives the key.
 *
 * 5.7.0 - a challenge is offered to any form that takes something written.
 * `Challenge` and `useChallenge` join `@/core/sdk/ui`; `runChallenge`,
 * `challengeFieldsFrom`, `CHALLENGE_FIELD`, `challengePoints` and the
 * `ChallengeResult` and `ChallengePoint` types join `@/core/sdk/server`; and a
 * manifest may declare `challengePoints`, the forms it takes writing through.
 * Core had both halves of a challenge and neither was reachable from a
 * module, and the action was a closed union of three auth words. The wire
 * names still say `auth.challenge` and `auth.form.challenge`: they are the
 * module-facing contract and every module declares `coreVersion ^5.0.0`, so
 * renaming them would refuse all of them until each was republished.
 *
 * 5.6.0 - `listBackups`, `getBackupPath` and `BackupMeta` join
 * `@/core/sdk/server`. Every dump lived on the same disk as the database, so
 * the box that lost one lost the other; a destination is a module's job
 * because a module has the credentials and the vendor, and these two are the
 * half core owes it.
 *
 * 5.5.0 - `AdminCrudPage` takes `listPath`. An endpoint a visitor reads
 * filters - it hides what is inactive, it takes one - and a panel handed that
 * same answer cannot see what was hidden, which is the one thing the panel is
 * for. A module points this at its operator's answer and writes still go to
 * `apiPath`. An addition: a screen that passes none behaves as it did.
 *
 * 5.4.0 - `ReferenceList` and `ReferenceListProps` join `@/core/sdk/admin`.
 * A field that holds several records showed their ids; this picks them by
 * name and draws what was picked.
 *
 * 5.3.0 - `activityKinds` and `activityTypeLabel` join `@/core/sdk/ui`. Every
 * kind of activity anything writes is declared in a manifest and named in
 * both languages, and until now only core could read that list. The trophies
 * module asked an operator to type one of those strings into a free text box
 * beside fourteen suggestions it kept by hand - three of which named nothing
 * that is ever written, one a misspelling of a real one - and a mistake made
 * a trophy that could never be awarded to anybody, silently.
 *
 * 5.2.0 - `RichTextEditor` takes `minHeight`. Three hundred pixels is right
 * for an article and wrong for a sentence: on the shop's shelf form the
 * editor stood in the middle of the page as though a category's one-line
 * blurb were the point of the screen. A style rather than a class, because a
 * class assembled at runtime is a class Tailwind never sees.
 *
 * 5.1.0 - `FilterTabs` joins `@/core/sdk/admin`, and `BulkBar` takes `idle`.
 * Three screens drew a strip that narrows a list to one named kind and all
 * three drew it differently. The moderation queue set its count in a
 * ten-pixel span pressed against the label, so the name and the number ran
 * together, and a kind with nothing waiting got no count at all - so that tab
 * was visibly shorter than the ones beside it, which is what "broken and out
 * of proportion" was. The orders screen put its count in brackets, also only
 * when it was not zero. The ticket queue had no counts on its tabs and four
 * cards above them holding the same five numbers.
 *
 * A count of zero is shown: dropping it is what made the strip jump, and it
 * takes information away at the same time, because an operator cannot tell
 * "nothing is waiting here" from "this screen does not count that".
 *
 * 5.0.0 - `@/core/sdk/blocks` is gone, and so is `pageBlocks` in the manifest.
 * A custom page has one `content` column and two editors were pointed at it: a
 * rich text box and a drag-and-drop block builder whose output was a JSON
 * document in the same column. An operator chose an editor before writing
 * anything, and the choice decided what the other one would show them
 * afterwards - a page built from blocks opened in the text editor as a wall of
 * JSON, and whichever was used last won. The builder carried a dependency, a
 * stylesheet that fetched a font from somebody else's server, six block
 * components across five modules, four files of core machinery to merge them,
 * and a second grammar for what a page is. What a person writes is Markdown,
 * which is already true of an article, a forum post and a ticket reply.
 *
 * A module that declared `pageBlocks` no longer validates, which is what this
 * bump is the signal for. `CrudField` also gains an optional `group`, which
 * would be a minor on its own.
 *
 * 4.6.0 - `ReferencePicker` joins `@/core/sdk/admin`, and `CrudField` takes
 * `type: "reference"`. The bulk discount screen asked for a product id and a
 * category id in two text boxes and the creator code screen asked for a user
 * id in a third; nothing in the panel shows any of those ids, so the only way
 * to fill one in was to open the database - and a mistyped id is refused by
 * nothing, it just makes a rule that never applies.
 *
 * 4.5.0 - `RowActions` joins `@/core/sdk/admin`. Measured across the panel:
 * 40 controls sitting in a row of a list, 23 an icon with a name and 17 an
 * icon with its label written beside it - so Edit was a small grey pencil on
 * one screen and a button reading "Edit" two screens over. Neither shape is
 * wrong; making the choice forty times is. A caller passes what its rows can
 * do and nothing about how they look.
 *
 * 4.4.0 - `BulkBar` joins `@/core/sdk/admin`, `deleteEach` joins `@/core/sdk`
 * and `useRowPicks` joins `@/core/sdk/ui` for the screens whose rows are paged
 * by the endpoint rather than held in the browser. The shell kept its destructive
 * button in the page header beside "Add new", so an operator ticked three
 * rows halfway down a table and the button that would delete them was at the
 * top of the screen next to the one that makes another - never visible at the
 * same time as the rows it named. The strip above the rows already existed to
 * hold the select-all box; it holds the action now, and a module drawing its
 * own table gets the same two answers in the same place.
 *
 * 4.3.0 - `useRowList` joins `@/core/sdk/ui`. A list that grows had to be
 * searched, paged and picked on 67 admin screens and three of them offered
 * any of it. A shell owning the markup would have to own every table's
 * columns and row actions, which is why nobody wrote one; this owns the
 * behaviour instead, and the three parts of it that have to agree - a search
 * returns the reader to page one, the selection is narrowed to the rows
 * listed, and the header box says "some" while some are unticked.
 *
 * 4.2.0 - `ModalLayer` joins `@/core/sdk/ui`. A dialog that draws itself where
 * it stands is a descendant of whatever opened it, and an admin screen that
 * edits a row is one `<form>`: the media library's search box was a form
 * inside a form, and every control in it was a submit button, because a
 * `<button>` with no type is one. Drawing into the body answers both, and the
 * two an overlay always fights as well - an ancestor's `overflow` clipping it
 * and an ancestor's stacking context burying it.
 *
 * 4.1.0 - `memberStanding` and `refuseSilenced` join `@/core/sdk/server`, and
 * `member.standing` joins the filter registry. Three things on this site
 * thought they decided who may take part and none of them agreed: a punishment
 * record nothing read, so a muted member posted and a banned one signed in; a
 * warning counter whose threshold action promised an auto-mute and had no
 * listener; and `User.isBanned`, which refused a sign-in and knew nothing about
 * either. They were three answers to one question. Core asks it now, a module
 * answers by restricting - never by granting, or a row in a module table would
 * be a way to unban an account - and core enforces the answer at the sign-in
 * and through one refusal every endpoint that takes member-written content
 * returns. Additive.
 *
 * 4.0.0 - A member holds a set of roles. `TimedRoleGrant` is gone from the
 * schema and a module that wrote it no longer compiles: `grantRole`,
 * `revokeRole` and `rolesHeldBy` join `@/core/sdk/server` and are the way a
 * role is handed out, because the write has a second half - the displayed role
 * is a cache of the top of the set - that a module must not be the one to
 * remember. `effectivePermissions` joins them.
 *
 * The break is the point rather than a cost of it. One role per member is why
 * handing out a rank had to remember what to put back, so selling somebody a
 * rank took away whatever else they were until it lapsed, and two jobs at once
 * could not be expressed at all. A lapsed role now takes back only itself.
 *
 * A manifest also declares who may reach each of its surfaces:
 * `menu[].permission`, `adminRoutes[].permission`, and `permission` or
 * `openTo` on a write. `validate-module` refuses a surface that declares
 * neither, so this is a break for a manifest as well as for code.
 *
 * 3.0.0 - What a person writes is Markdown. `RichContent` takes `markdown`
 * where it took `html`, `renderMarkdown` joins `@/core/sdk`, and the seed
 * context's `html(n)` is `paragraphs(n)`. This is a break in both directions: a
 * module passing `html` no longer compiles, and one that stored the HTML its
 * editor produced now has that HTML rendered as the text it is.
 *
 * The reason is what was being stored rather than how it was typed. Content
 * was authored in a Quill toolbar and saved as whatever HTML Quill emitted,
 * so the database held the editor's output format: a paragraph was a `<p>`
 * because Quill said so, and the writing could not outlive the editor.
 * Markdown is the text somebody typed. It reads as itself in a database
 * client, it diffs, and the HTML subset a layout needs survives it, because
 * the sanitiser rather than the parser is the boundary.
 *
 * 2.3.0 - `listCataloguePages` joins `@/core/sdk/server`, and `seo.pageMeta`
 * joins the filter registry. Between them they are how a module manages this
 * site's search engine metadata without knowing which pages exist: the first
 * answers what the site serves and what each page says about itself by
 * default, the second is core asking, per page, whether it has been told
 * otherwise. Before this, a per-page override could only be applied by
 * rewriting `document.head` in the browser, which no crawler reads.
 * `routes[].ogType` lands with them: core writes a module page's head, had
 * nothing to go on, and called every one of them an article - the cart, the
 * leaderboard and the staff list included. `PrismaTransaction` is exported in
 * the same release: a module writing inside a transaction another module
 * opened had no name for the handle it was passed. Additions.
 *
 * 2.2.0 - `Waiting` is how a module says a region is still fetching. The
 * product stopped drawing page shaped placeholders: they were a second copy
 * of a layout nothing kept in step with the first, and the generic ones were
 * already wrong by twelve table rows and 24 pixels of card. `Skeleton` is
 * still exported, because removing a name modules are written against is a
 * major bump rather than a tidy up, but nothing here draws one any more.
 *
 * 2.1.0 - `menu[].section` lets a module say which section of a group its
 * admin page belongs to, and a group declares its own `order` rather than
 * being appended after everything core ships. Without the first, a module with
 * a single page had nowhere to say what kind of thing it was and fell into a
 * pooled drawer; fourteen payment providers ended up there, under Settings,
 * while the page that configures payment was in Commerce. Both are additions:
 * a manifest that names neither is arranged exactly as it was.
 *
 * 2.0.0 - The product is called Blysis. Every name it published moves with it,
 * and two of them are a module's to declare: the global interfaces a module
 * augments to type its own hooks are `BlysisHookPayloads`,
 * `BlysisFilterPayloads` and `BlysisFilterContexts`, and a module built against
 * the old names will not compile. That is a renamed symbol rather than a
 * removed one, so nothing about the shape changed - but a declared range is
 * exactly the thing that should catch it, which is what a major is for.
 *
 * The CSS custom properties a theme reads are renamed on the same principle
 * (`--blysis-color-*`, `--blysis-radius`), as is the API key prefix. Keys
 * already issued keep working: a key is found by the prefix stored beside it,
 * so only new ones carry the new word.
 *
 * 1.44.0 - `readSettingValues`, `readSettingStrings`, `settingsForStorage` and
 * `withoutSecrets` join `@/core/sdk/server`, and the manifest gains
 * `secretSettings` and `emailProvider`. A module's gateway keys were written to
 * the settings store exactly as an operator typed them, which put every signing
 * secret on the site in a JSON column and in the admin screen's own JSON
 * response. Encrypting them only works if one place does it, so a module now
 * declares which of its keys are credentials and reads them back through the
 * SDK; reading the row directly returns ciphertext. `emailProvider` is the same
 * move for the mailer: core owns it but the key's name was a module's, and core
 * was reading that name literally. Additive.
 *
 * 1.43.0 - `isUnsafeKey` joins `@/core/sdk`. A module building an object out of
 * keys that came from a request needs the same three names core checks, and a
 * module that copies them is one that will not hear about a fourth. The
 * market's listing payload is written by a member, stored as JSON and read
 * back by whichever module claims the kind. Additive.
 *
 * 1.42.0 - `RoleBadge` joins `@/core/sdk/ui`, beside the `RoleName` that was
 * already there and which nothing rendered. The declarations an operator wrote
 * for a role had a writer and no readers: five screens drew a role out of
 * `role.color` by hand, so a gradient showed up nowhere and the column may as
 * well not have existed. Both components now write the rule, both check it
 * again at the render site, and a gate keeps a sixth screen from being written
 * the old way. Additive.
 *
 * 1.41.0 - `normalisedMatrix` and `clearedMatrix` join `@/core/sdk`, beside the
 * `accessByRole` that reads what they write. A grid sending only its ticked
 * rows sends nothing when an operator unticks everybody, and nothing is read as
 * "nobody has ruled on this": the strictest thing a screen can say produces the
 * loosest thing the site can do. The forum wrote the answer first and the
 * support desk needs the same one. `AdminCrudPage` takes `rowHref` and
 * `rowActionLabel` in the same change: some rows are a door as well as a
 * record, and without a link a module had to abandon the component and write
 * the list again to add one. Additive.
 *
 * 1.40.0 - `verifyPassword` joins `@/core/sdk/server`. Which algorithm hashed a
 * password is now an operator setting, so a module comparing with one of them
 * by name starts refusing correct passwords the day the setting moves: the
 * two-factor module could disable nothing and close no account on a site that
 * had switched, while the same members signed in normally. Additive.
 *
 * 1.39.0 - `IconPicker` joins `@/core/sdk/ui`, beside the `NavIcon` that draws
 * what it picks. A module that stores a lucide icon name could render one and
 * not choose one, so every icon field in a module admin was a free text box;
 * the forum's offered an emoji as its placeholder and the public board drew
 * nothing for it. Additive.
 *
 * 1.38.0 - `admin.customer.panels` and `readUserAgent`. An operator opening one
 * member needs what is spread across everything installed - what they bought,
 * what they are owed, what they have asked for - and core cannot gather that
 * without knowing which modules exist. So it asks and never learns who
 * answered. `readUserAgent` turns a login's user agent into a browser and a
 * system, and keeps the string when it fits nothing: an unfamiliar string
 * serves "was this me" better than a confident wrong answer. Additive.
 *
 * 1.37.0 - `restrictedFrom`, `SITE_WIDE`, `isRestrictedFrom`, `safeRoleCss` and
 * `RoleName`. Two additions that both belong to a member rather than a module.
 *
 * A restriction keeps somebody out of one part of the site rather than all of
 * it; the scope is the asking module's own word and core never interprets it,
 * so `tickets` and `comments` do not become names core knows. The whole site
 * covers every part of it, and a lapsed one does not bite.
 *
 * A role can carry declarations an operator wrote, judged as a browser reads
 * them: escapes and comments are folded before the text is judged, and a brace
 * is refused because it ends the rule this site wrote and starts one of
 * theirs. Additive.
 *
 * 1.36.0 - `accessByRole` joins `@/core/sdk`. Which roles may read, write and
 * reply in a container, with two silences that mean opposite things and a
 * child that is never more open than its parent. The forum needed it first and
 * the support desk needs the same answer about its departments; a second copy
 * of those rules is a second thing to fix, and the lines that would drift are
 * the ones deciding who gets in. The modules keep their own tables. Additive.
 *
 * 1.35.0 - `routing.redirects` and `resolveRedirect`. A page that moved has to
 * be answered before anything renders, which is the proxy, which is core - and
 * a module cannot reach in there. So core asks for the rules through a filter
 * and never learns who answered, and the decisions that make a redirect safe
 * rather than a hazard (a circle, an open redirect, the locale prefix) are
 * made in one place. Additive: a site with nothing answering redirects
 * nothing.
 *
 * 1.34.0 - `UserPicker` joins `@/core/sdk/admin`. Two core screens ask "which
 * account?" and share one debounced search; a module screen that had to ask
 * the same question could not reach it, and the first one to try wrote the
 * query, the debounce and the result list a third time. Additive.
 *
 * 1.33.0 - `TimedRoleGrant`, and the sweep that acts on it. A member holds one
 * role, so handing one out for a while means remembering what they held before
 * and putting it back; nothing did, which made a rank sold by the month a rank
 * sold once. Who granted it is a string the granter chooses, so the core still
 * names nothing. Additive: a platform that writes no grant sweeps nothing.
 *
 * 1.32.0 - `StandardSidebarLayout` takes a `heading`. A section in the content
 * column is a heading and then its cards; a widget is a card with its heading
 * inside, so a page that wrote the heading itself started every widget beside
 * it a heading's height too high. Passing it in lets one component draw the
 * heading and the spacer that answers it. Optional, so a layout that passes
 * none is unchanged.
 *
 * 1.31.0 - the site's clock. `siteTimeZone()` joins `@/core/sdk/server` and
 * the pure readers - `zonedNow`, `weekdayIn`, `minutesInto`,
 * `wallClockToInstant`, `instantToWallClock` - join `@/core/sdk`. "Opens
 * Friday at 18:00" is not a moment until somebody says whose clock, and the
 * only answer that starts a limited run at the same instant for everybody is
 * the operator's. Additive; nothing scheduled existed before it.
 *
 * 1.30.0 - `NavIcon` joins `@/core/sdk/ui`. Modules store an icon as a Lucide
 * name - a forum category, a help category, a nav link - and had no way to
 * draw one, so the forum printed the name beside the category ("MessageSquare
 * General" in every install's sidebar) and the help centre hand-rolled a map
 * of the six icons its author thought of. An addition.
 *
 * 1.29.0 - `@/core/sdk/seed` carries the types for `seed.ts`, the file a
 * module may ship beside its manifest to fill an install with data worth
 * looking at. An empty site answers every question with "nothing here yet",
 * which is the one state nobody needs to test: pagination, ordering,
 * truncation, a name too long for its column and empty-against-failed all
 * hide until there is data. `scripts/seed-demo.ts` finds those files, orders
 * them by what they declare they need, and can take back exactly what it
 * wrote. Types only, and additive.
 *
 * 1.28.0 - `PageFrame` joins `@/core/sdk/layout`. Every module wrote its own
 * public page shell, and thirty-one hand-written shells drifted: nine content
 * widths, a breadcrumb on nine of the thirty-one, two page backgrounds, and a
 * couple of titles wearing an icon nobody else's title had. Moving between two
 * modules moved the left edge of the text. The frame owns the measure, the
 * trail and the header, so a page cannot set a width of its own - it never
 * writes the element that would carry one. An addition; `StandardSidebarLayout`
 * is unchanged and still exported.
 *
 * 1.27.0 - `buttonClassName` joins `@/core/sdk/ui`, beside `Button` the way
 * `badgeClassName` sits beside `Badge`. A control that navigates has to be an
 * anchor, and forty module call sites were wrapping a `<Button>` in a `<Link>`
 * instead, which renders `<a><button>`: forbidden by the HTML spec, two tab
 * stops for one control, and the accessible name on the inner element where a
 * screen reader announces the outer one. Core fixed its own with this function
 * and a module could not reach it.
 *
 * 1.26.0 - `sharedJson`, `peekShared` and `invalidateShared` join
 * `@/core/sdk`. A widget that fetches in an effect gets its own request, and
 * four store widgets wanting the same totals made fifteen of them on one
 * homepage. Deduplicating in a module-level variable does not survive code
 * splitting, which had already put two copies of the settings hook on the
 * same page; the shared store lives on `globalThis` instead. Addition.
 *
 * 1.25.0 - `errorMessage` joins `@/core/sdk`, beside `writeError`. A handler
 * that needs the body on success cannot hand the response to `writeError`
 * afterwards, so thirty-three screens had settled on `data.error ||
 * t("saveFailed")` instead: a shape that reads as a translated fallback and
 * is the reverse of one, since `error` is the English the route wrote and is
 * almost never absent. `errorMessage` answers the same question for a body
 * the caller already read. Addition.
 *
 * 1.24.0 - `pageParams` joins `@/core/sdk/server`, with `MAX_PAGE`,
 * `MAX_PAGE_SIZE` and `DEFAULT_PAGE_SIZE` beside it. Sixteen list endpoints
 * had hand-rolled the same page and limit parse in six wordings, and all of
 * them clamped the page from below only: a large enough `?page=` reached an
 * OFFSET past what a 32-bit integer holds, and the driver threw where the
 * handler had nothing to say - a 500 for a number in a query string. A module
 * that pages a list needs the fix as much as core does. Addition.
 *
 * 1.23.0 - A `number` module setting may declare `step`. A number input's
 * default step is 1, so a manifest could declare a setting whose real values
 * are fractional - a price of 0.013 a credit - and the browser marked every
 * usable value invalid. The setting existed and could not be set. Optional
 * addition to the manifest.
 *
 * 1.22.0 - `shouldNotify` joins `@/core/sdk/server`. The notification
 * preferences grid in /profile wrote a row for every toggle and nothing ever
 * read one: the check that consults it sat in core, unexported, and its own
 * doc comment described a caller that did not exist. A module that sends
 * something to a person is the caller, so it has to be able to ask.
 * Addition.
 *
 * 1.21.0 - `RichContent` joins `@/core/sdk/ui`. Author-written HTML was
 * rendered by seven module screens, each importing its own DOMPurify and each
 * styling the result with `prose dark:prose-invert` - class names that match
 * nothing here, since the typography plugin was never installed. One
 * component now sanitises and styles it, in the theme's colours, and works on
 * the server as well as in the browser.
 *
 * 1.20.0 - `useSettingsLoad` and `readJson` join `@/core/sdk/admin`. A module
 * settings screen that read `/api/v1/settings` with a bare `.then((r) =>
 * r.json())` could not tell a 500 from an empty answer, so it rendered its
 * defaults and its save button wrote them back over the site's real
 * settings. Core had the same hole in six screens; the fix has to be
 * reachable from a module or the gate that enforces it is a rule a module
 * cannot follow. Additions.
 *
 * 1.19.0 - `Radio` and `RadioField` join `@/core/sdk/ui`. The one-of-several
 * to `Checkbox`'s any-of-several, and bare for the same reason the
 * checkboxes were. Additions.
 *
 * 1.18.0 - `Slider` joins `@/core/sdk/ui`. The two range inputs in the panel
 * were bare, so both were drawn in the operating system's blue beside
 * controls painted in the theme's own primary. An addition.
 *
 * 1.17.0 - `AdminPageHeader` joins `@/core/sdk/admin`. Eighty admin screens
 * had written their own title row, between them using twelve heading sizes
 * and six different layouts, so moving from one screen to the next changed
 * the size of the title and the height of the button beside it. One header,
 * one set of choices. An addition.
 *
 * 1.16.0 - `Checkbox` and `CheckboxField` join `@/core/sdk/ui`. There were
 * twenty-nine bare `<input type="checkbox">` between core and the modules,
 * wearing ten different class strings, all of them painted by the operating
 * system rather than by the theme - the system's blue on a light box, and a
 * white box with a black hairline on a dark panel. Same treatment
 * `NativeSelect` got: the real element, with its appearance taken off.
 * Additions.
 *
 * 1.15.0 - `copyText` joins `@/core/sdk`. `navigator.clipboard` only exists
 * in a secure context, so on a self-hosted site reached by IP over http://
 * every "Copy" button on the site threw `TypeError` and did nothing. The
 * helper uses the real API where there is one, falls back to an offscreen
 * textarea where there is not, and returns whether the text landed. An
 * addition.
 *
 * 1.14.0 - `Badge` joins `@/core/sdk/ui`. Every screen had hand-rolled its
 * own status pill out of `bg-green-100 text-green-700` and friends, so a
 * badge was a fixed light chip whatever the theme said, unreadable on a dark
 * panel, and no two of them agreed on radius, padding or shade. The component
 * has five tones drawn from the theme's own colour tokens, which dark mode
 * and every theme already redefine. An addition.
 *
 * 1.13.0 - `useFormRoute` joins `@/core/sdk/ui`. A create or edit form used
 * to unfold as a card above the list it belonged to, which on a screen with
 * two hundred rows pushes the row you came to edit off the bottom, gives the
 * back button nothing to close, and leaves a half-filled form that cannot be
 * reloaded or linked because nothing about it is in the URL. The hook reads
 * `?form=new` or `?form=<id>` off the current path; the screen renders the
 * form and returns early. Core's own screens use route segments instead - a
 * module's field definitions live in its one page file, and a child route
 * would need them copied into two more files per module.
 *
 * 1.12.0 - `Pagination` and `usePagedRows` join `@/core/sdk/ui`, and the
 * manifest gains `dashboardSections`. Eight admin screens had written the same
 * two chevrons and a "Page 2 / 9" caption, and nine lists that grow had no
 * pager at all; with only previous and next, reaching page forty takes
 * thirty-nine clicks. Numbered pages, first and last, and a box to type a page
 * number into. `dashboardSections` lets a module declare the panels its
 * `statsApi` returns so the dashboard customizer can offer them. Both
 * additions.
 *
 * 1.11.0 - `NativeSelect` joins `@/core/sdk/ui`. The panel had a themed
 * `Input` and no themed dropdown, so every "pick one of these strings"
 * control was a bare `<select>` wearing the browser's own chrome next to it.
 * This is the same element with the appearance taken off. An addition.
 *
 * 1.10.0 - `usePrompt` joins `@/core/sdk/ui`. It opens the same dialog
 * `useConfirm` does, with a field in it, so a module can ask for a line of
 * text without falling back to the browser's `prompt()`. An addition.
 *
 * 1.9.0 - `LoadFailed` joins `@/core/sdk/ui`. A module that fetches its own
 * content has the same two ways of being empty core does, and had the same
 * one way of saying so; this is the panel for the other one. An addition, so
 * a module written against 1.8.0 is unaffected.
 *
 * 1.8.0 - `useSiteCurrency` joins `@/core/sdk/ui`, and core mounts the
 * provider behind it. A module that shows a price no longer has to guess the
 * currency: the base is the setting the payment gateways charge in, the
 * formatting follows the reader's locale, and a module that knows exchange
 * rates can put every price on the site into another currency with
 * `setDisplay({ code, rate })`.
 *
 * 1.7.0 - `writeError` and the `Translator` type join `@/core/sdk`. A handler
 * that sends a POST and then shows a green toast without reading the response
 * reports success for a 403, a 429 and a 500 alike; the helper is the check,
 * in one line, in the reader's language.
 *
 * 1.6.0 - `useModalDialog` and `ModalDialogOptions` join `@/core/sdk/ui`. A
 * module that draws its own `role="dialog"` gets Escape, a Tab trap and focus
 * returned to whatever opened it, instead of hand-rolling a keydown listener
 * that covers a third of the problem.
 *
 * 1.5.0 - `readJsonBody` and `INVALID_JSON_BODY` join `@/core/sdk/server`.
 * A route that calls `request.json()` directly answers a malformed body with
 * a 500; the helper answers it with the 400 it deserves, in one wording.
 *
 * 1.4.0 - `authProviders[].standardCallback` lets a module that builds its own
 * provider say the provider still returns through Auth.js's own callback, so
 * the admin panel can show the redirect URL to register. Nothing else needs
 * it: a built-in provider always has that URL, and a module running its own
 * flow documents its own.
 *
 * 1.3.0 - `FilterContext`, and the typed context registry
 * `BlysisFilterContexts` behind it. A filter that declares a context now has
 * both halves of its contract checked, at the call site and in every listener;
 * a filter that declares none behaves exactly as it did, so this is an
 * addition rather than a break.
 *
 * 1.2.0 - `authProviders[].factory` lets a module ship its own sign-in
 * provider instead of naming one Auth.js already has, `oauthButtons[].href`
 * lets that provider's button start a flow Auth.js does not know how to
 * start, and `resolveAppUrl` joins `@/core/sdk/server`. All three are
 * additions: a manifest written against 1.1.0 is unaffected.
 *
 * 1.1.0 - `searchProviders[].indexes` lets a module ask core to create its
 * full-text indexes. Requiring `coreVersion` in the manifest landed in the
 * same release but is not a major bump: a module that declared a range still
 * installs, and a module that declared none had no range for a major to
 * protect.
 */
export const CORE_API_VERSION = "5.12.0";
