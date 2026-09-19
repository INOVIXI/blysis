/**
 * What a module is allowed to say about itself.
 *
 * A manifest arrives in a ZIP from outside, so this is a trust boundary
 * rather than a convenience: every route it wants mounted, every API handler,
 * every hook, block, widget and translation is described here first and
 * checked before anything is written to disk or added to a registry. A field
 * this file does not name does not exist as far as the platform is concerned.
 *
 * Use it as one call:
 *
 *     const parsed = moduleManifestSchema.safeParse(json);
 *     if (!parsed.success) reject(parsed.error.issues);
 *
 * Everything above `moduleManifestSchema` is a piece of that one grammar and
 * is deliberately not exported. Depends on `zod` and on `semver-range` for the
 * compatibility ranges a module declares.
 *
 * ## Why this is one file
 *
 * It is past the 700 line mark the house rules ask about. The thirty odd
 * schemas here are not thirty subjects: they are the clauses of a single
 * declaration, they are read top to bottom the way the manifest is written,
 * and every consumer imports the composed schema and nothing else. Adding a
 * manifest field touches its clause and the composition together, which is
 * the case the rule names for keeping a file whole.
 */
import { z } from "zod";
import { CRON_SCHEDULES } from "./cron-schedules";
import { isValidRange } from "./semver-range";

const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;
const SAFE_SLUG = /^[A-Za-z0-9_-]+$/;

/**
 * A semver range the module declares it accepts. Validated eagerly so an
 * unparseable range is a manifest error rather than something that silently
 * fails every comparison at install time.
 */
const semverRange = z
    .string()
    .min(1)
    .max(64)
    .refine(isValidRange, { message: "must be a semver range (e.g. ^1.2.0, >=1.0.0 <2.0.0, 1.x)" });

/**
 * `id` or `id@range`. The range is optional so every manifest written before
 * the compatibility contract existed stays valid, and an entry without one
 * keeps the original meaning: any installed version will do.
 */
const DEPENDENCY_SPEC = /^([a-z0-9][a-z0-9-]*)(?:@(.+))?$/;
const dependencySpec = z
    .string()
    .min(1)
    .max(96)
    .superRefine((value, ctx) => {
        const m = DEPENDENCY_SPEC.exec(value);
        if (!m) {
            ctx.addIssue({ code: "custom", message: `"${value}" must be a module id, optionally suffixed with @range` });
            return;
        }
        if (m[2] !== undefined && !isValidRange(m[2])) {
            ctx.addIssue({ code: "custom", message: `"${m[2]}" is not a valid semver range in "${value}"` });
        }
    });

const relativePath = (label: string) =>
    z.string()
        .min(1, `${label} is required`)
        .max(256, `${label} is too long`)
        .refine((v) => !v.startsWith("/") && !v.startsWith("\\"), {
            message: `${label} must be a relative path`,
        })
        .refine((v) => !/(^|[\\/])\.\.(?:[\\/]|$)/.test(v), {
            message: `${label} must not contain ".."`,
        })
        .refine((v) => !/^[A-Za-z]:[\\/]/.test(v), {
            message: `${label} must not be an absolute Windows path`,
        });

const routePath = z.string().min(1).max(512).regex(
    /^\/[A-Za-z0-9/_\-:.\[\]*]*$/,
    "Route path must start with / and use URL-safe characters",
);

const iconName = z.string().min(1).max(64).regex(SAFE_SLUG, "Icon must be a Lucide name");

/**
 * A path inside the admin panel, written without the `/admin` prefix.
 *
 * Core adds the prefix (see `adminHref`), so a manifest that includes it too
 * produces `/admin/admin/...`: a link to a page that does not exist, from a
 * menu or a search result for one that does. Five first-party modules had it
 * that way and nothing said so, because only the spotlight ever built a URL
 * from `settingsCards[].href`.
 */
const panelRelativePath = routePath.refine(
    (p) => p !== "/admin" && !p.startsWith("/admin/"),
    { message: "Admin paths are relative to the panel: drop the leading /admin" },
);

/**
 * A permission name, in the one shape core enforces: `namespace.action`.
 *
 * The namespace is the module that owns it, or `admin` for a module that
 * extends core's own panel rather than adding a surface of its own.
 */
const permissionName = z.string().min(3).max(128).regex(
    /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/,
    "permission must be namespace.action in lower case",
);

/**
 * Who an endpoint is for when no permission gates it.
 *
 * Most of a module's writes are not an operator's job: posting a topic,
 * adding to a cart, voting, redeeming a code. Gating those would mean
 * granting every member a permission, which is a permission that means
 * nothing. `member` is anybody signed in, `public` is anybody at all, and
 * saying which is how an endpoint stays a decision rather than an omission.
 */
const openTo = z.enum(["member", "public"]);

const menuItem = z.object({
    label: z.string().min(1).max(100),
    path: panelRelativePath,
    icon: iconName.optional(),
    group: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/).optional(),
    /**
     * The section inside that group, shared with every other module naming it.
     *
     * Without it, a module that ships one admin page has no way to say what
     * kind of thing it is, and lands in the group's pooled drawer. Fourteen
     * payment providers landed there one at a time, under Settings, while the
     * page that configures payment was in Commerce.
     *
     * The heading is translated from `navSection_<id>`, so the name here is a
     * slug and not display text.
     */
    section: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/).optional(),
    /**
     * What opens the screen this links to.
     *
     * The sidebar draws only what the reader could actually open, so a link
     * with no permission would be a link to a refusal. It has to be a name the
     * module also declares in `permissions`, or nobody could ever be granted
     * it.
     */
    permission: permissionName.optional(),
});

const routeEntry = z.object({
    path: routePath,
    component: relativePath("component"),
    layout: relativePath("layout").optional(),
    /**
     * Keeps the page out of the sitemap and marks it `noindex` for crawlers.
     * For the pages that exist to be walked through rather than found: a cart,
     * an order confirmation, anything whose content belongs to one visitor.
     */
    noindex: z.boolean().optional(),
    /**
     * The page's name, as a key into the translations this module ships.
     *
     * A route pattern is a URL and a URL is written once, in English, so a
     * title built from it read "Store" to a visitor whose page said "Mağaza",
     * and `/store/vip` was titled "Vip". Format is `namespace.key`, resolved
     * against the merged catalogue in the visitor's locale; a key that does
     * not resolve falls back to the humanized route segment rather than
     * shipping the key itself as a title.
     */
    titleKey: z.string().min(1).max(128).regex(/^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_-]+)+$/, "titleKey must be namespace.key").optional(),
    /**
     * What the page is about, as a key into the translations this module ships.
     *
     * Same format and same fallback rules as `titleKey`. Without one, a page's
     * description was the site's: thirty-eight module pages shipped the single
     * `site_description` row as their meta description and their og:description,
     * so a search result for the store, the forum and the leaderboard said the
     * same sentence, and the SEO screen had nothing to show as a default.
     */
    descriptionKey: z.string().min(1).max(128).regex(/^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_-]+)+$/, "descriptionKey must be namespace.key").optional(),
    /**
     * What kind of thing this page is, for the card a link unfurls into.
     *
     * Core titles and describes a module's pages for it, and it had nothing to
     * go on here, so it called every one of them an article: the cart, the
     * leaderboard, the staff list and the vote page all announced themselves
     * as `og:type: article` to anything that read a link to them. Defaults to
     * `website`; a route that really is a piece of writing says so, and a
     * route that is somebody's page says `profile`.
     */
    ogType: z.enum(["website", "article", "profile"]).optional(),
    /**
     * Lets core title the page from the last URL segment.
     *
     * Only true where the page resolves the resource on the server and calls
     * `notFound()` when there is none, because then a URL that names nothing
     * answers 404 and the title never ships. A page that answers 200 and
     * renders "not found" in the browser hands the visitor the site's own
     * `<title>` and `og:title`, which is what an unfurled link shows in chat.
     * `validate-module` checks the page really is that shape.
     */
    titleFromPath: z.boolean().optional(),
    /**
     * A server-side existence check for a dynamic route, run by core's
     * catch-all before the page renders.
     *
     * A page that fetches its subject in the browser has already answered 200
     * by the time it learns there is nothing there, so `/u/nobody` and
     * `/store/product/99999` were soft 404s: indexable, invisible to link
     * checkers and to any monitor watching for a status. Rewriting seven
     * interactive pages as server components would be a large change for a
     * small question, so the module answers the question separately: a file
     * that default-exports `(params) => Promise<boolean>`, false meaning
     * `notFound()`. Only routes with a dynamic segment need one.
     */
    resolver: relativePath("resolver").optional(),
    /**
     * This route is where a person's public profile lives.
     *
     * Core writes a username in a few places of its own - the activity feed
     * on the home page, the audit log - and used to link every one of them to
     * `/profile/<username>`, which is not a route: `/profile` is the signed-in
     * visitor's own page and takes no segment. Every one of those links was a
     * 404, and core cannot fix it by hardcoding `/u/<username>` either,
     * because that path belongs to a module that may not be installed.
     *
     * So the module that serves profiles says so, core asks the registry, and
     * a username with nowhere to point renders as plain text. Exactly one
     * dynamic segment, which is the username; `validate-module` checks that.
     */
    userProfile: z.boolean().optional(),
});

const adminRouteEntry = z.object({
    path: panelRelativePath,
    component: relativePath("component"),
    /**
     * What opens this screen. An admin route is never public: core denies a
     * panel path it has no permission for, so an undeclared screen is one
     * only an administrator reaches.
     */
    permission: permissionName.optional(),
});

const apiEntry = z.object({
    path: routePath,
    handler: relativePath("handler"),
    method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH", "ALL"]).optional(),
    description: z.string().max(500).optional(),
    /**
     * What allows a write to this endpoint.
     *
     * Writes only. A reader is gated by the screen that does the reading, and
     * an entry declared `ALL` commonly serves a public list from GET and an
     * operator's create from POST: gating the pair together would take the
     * list off a public page.
     *
     * Exactly one of `permission` and `openTo` belongs on an entry that
     * writes, unless it is a `providerCallback`, which authenticates the
     * caller itself because there is no session to read.
     */
    permission: permissionName.optional(),
    openTo: openTo.optional(),
    /**
     * An endpoint a payment provider or other external service posts to
     * directly, with no browser and therefore no `Origin` header.
     *
     * The proxy's CSRF gate rejects exactly that shape, so every gateway
     * webhook was answered 403 before its handler ran and no payment ever
     * settled. Core cannot know a module's callback paths - the gate's
     * hardcoded `/api/v1/webhook/` prefix only ever matched core's own route -
     * so the module declares them and the proxy reads the declaration.
     *
     * The exemption is only safe because such a handler authenticates the
     * request itself: a signature it verifies, or reading the payment back
     * from the provider with this site's own credentials. `validate-module`
     * fails a `providerCallback` whose handler does neither.
     */
    providerCallback: z.boolean().optional(),
    /**
     * A stricter rate limit than the default for this one endpoint.
     *
     * Every module endpoint is limited whether or not it says so - the
     * dispatcher applies `RATE_LIMIT_API` per endpoint per client, and
     * `RATE_LIMIT_PROVIDER_CALLBACK` to a `providerCallback`, which a real
     * provider retrying a burst must never trip. This field is for the
     * endpoints where the default is far too generous to mean anything: one
     * that sends mail, mints a reward, or opens a ticket.
     *
     * It can only tighten. A module cannot raise its own ceiling and cannot
     * turn the limit off, because the point of enforcing this in core is that
     * an endpoint may not opt out of it.
     */
    rateLimit: z
        .object({
            maxRequests: z.number().int().min(1).max(10_000),
            windowMs: z.number().int().min(1_000).max(3_600_000),
        })
        .optional(),
});

// A widget carried no name at all. The screen that switches widgets on and
// off derived one by splitting the component id on its capitals, so an admin
// read "Featured Product Widget" in every locale, and a widget whose id was
// not written in English read as nonsense. `label` is the fallback and
// `labelKey` is what the screen renders, resolved in the `admin` namespace -
// the same contract dashboard cards and sections already use.
//
// Both are optional here and required by the gate, because a manifest already
// installed on a live site does not have them: rejecting it would take a
// working homepage's widgets away on the upgrade that introduced the field.
const widgetEntry = z.object({
    id: z.string().min(1).max(64).regex(SAFE_SLUG),
    label: z.string().min(1).max(100).optional(),
    labelKey: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/).optional(),
    component: relativePath("component"),
    defaultOrder: z.number().int(),
    defaultVisible: z.boolean(),
});

// `label` is the fallback shown when the key is missing; `labelKey` is what
// the navbar, footer and mobile bar actually render, resolved in the `nav`
// namespace. Without it a module's most visible string - its own name in the
// navigation - stayed English in every locale, next to a translated "Home".
const navLink = z.object({
    label: z.string().min(1).max(100),
    labelKey: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/).optional(),
    href: routePath,
    icon: iconName.optional(),
    position: z.number().int().optional(),
});

const footerLink = z.object({
    label: z.string().min(1).max(100),
    labelKey: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/).optional(),
    href: routePath,
    section: z.enum(["quick", "legal"]).optional(),
});

const profileTab = z.object({
    id: z.string().min(1).max(64).regex(SAFE_SLUG),
    /** English prose, and only ever the fallback. See `labelKey`. */
    label: z.string().min(1).max(100),
    /**
     * Where the tab's name lives in this module's own `translations`, as
     * `namespace.key`.
     *
     * Without it a tab is named by `label`, which is one language. The names
     * used to come from core's message file instead, keyed by the tab's id -
     * so core knew a module called `ProfileOrdersTab` existed, and the five
     * tabs nobody had added a key for printed English to Turkish readers.
     */
    labelKey: z.string().min(3).max(120).regex(/^[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+$/).optional(),
    component: relativePath("component"),
    order: z.number().int(),
});

const oauthButton = z.object({
    id: z.string().min(1).max(64).regex(SAFE_SLUG),
    provider: z.string().min(1).max(64).regex(SAFE_SLUG),
    label: z.string().min(1).max(100),
    color: z.string().min(1).max(32),
    svgIcon: z.string().min(1).max(8192),
    /**
     * Send the visitor here instead of calling `signIn(provider)`.
     *
     * Auth.js starts a login by POSTing to its own signin endpoint, which
     * suits OAuth2 and nothing else. A provider that opens its flow some
     * other way - Steam hands you an OpenID 2.0 redirect - points the button
     * at its own entry route instead. Same-origin only: an absolute URL here
     * would let a manifest aim the sign-in button at any site it likes, and
     * so would a protocol-relative one, which is why a second leading slash
     * is rejected too.
     */
    href: z
        .string()
        .min(1)
        .max(200)
        .regex(
            /^\/(?![/\\])[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*$/,
            "href must be a same-origin path starting with a single /",
        )
        .optional(),
});

const navGroup = z.object({
    id: z.string().min(1).max(64).regex(SAFE_ID, "Nav group id must be a lowercase slug"),
    label: z.string().min(1).max(64),
    icon: iconName.optional(),
    order: z.number().int().min(0).max(9999).optional(),
});

// A channel id is stored in settings and matched against this list, so it is
// held to the same slug rule as other registry keys.
const webhookChannel = z.object({
    id: z.string().min(1).max(64).regex(SAFE_ID, "Webhook channel id must be a lowercase slug"),
    label: z.string().min(1).max(64),
    layout: z.enum(["json", "embed", "attachment"]),
    // Hostnames the admin's webhook URL must match. Omitted means core applies
    // its own conservative rule instead of a per-vendor allowlist.
    hosts: z.array(z.string().min(1).max(253)).max(10).optional(),
    urlPlaceholder: z.string().max(300).optional(),
});
// The provider id is interpolated into a `next-auth/providers/<id>` import, so
// it is held to the strict slug rule rather than the looser SAFE_SLUG used for
// display-only ids - a "/" or ".." here would escape the providers directory.
const ENV_VAR_NAME = /^[A-Z][A-Z0-9_]*$/;

/**
 * An identity provider a module contributes to the sign-in page.
 *
 * Two shapes, and which one you get depends on whether Auth.js already ships
 * the provider:
 *
 * - **Built in.** Give `envIdVar` and `envSecretVar`. The id resolves as
 *   `next-auth/providers/<id>` and receives exactly a client id and secret.
 *   This covers every ordinary OAuth2 login.
 * - **Module supplied.** Give `factory` and `envVars`. The module ships the
 *   provider itself, from a file in its own tree, and names the env vars it
 *   needs. This is the only way to reach an identity system Auth.js does not
 *   ship - Steam speaks OpenID 2.0, not OAuth2 - and it is also the way to
 *   configure a built-in that needs more than two credentials, such as
 *   Battle.net's required region issuer or Apple's signed-JWT secret.
 *
 * Either way the provider stays inactive until every env var it names is set,
 * so an installed but unconfigured module contributes nothing.
 */
const authProvider = z
    .object({
        id: z.string().min(1).max(64).regex(SAFE_ID, "Auth provider id must be a lowercase slug"),
        envIdVar: z.string().min(1).max(128).regex(ENV_VAR_NAME, "envIdVar must be an env var name").optional(),
        envSecretVar: z
            .string()
            .min(1)
            .max(128)
            .regex(ENV_VAR_NAME, "envSecretVar must be an env var name")
            .optional(),
        /** Module-relative path to a file whose default export builds the provider. */
        factory: relativePath("factory").optional(),
        /**
         * Set when a module-supplied provider is an ordinary Auth.js OAuth
         * provider - built here only because it needs more than a client id and
         * secret - so its redirect URL is the usual `/api/auth/callback/<id>`
         * and the admin panel can show it. A provider whose flow runs in the
         * module's own routes leaves this off and documents its URLs itself.
         */
        standardCallback: z.boolean().optional(),
        /** Env vars a module-supplied provider needs. All must be set for it to activate. */
        envVars: z
            .array(z.string().min(1).max(128).regex(ENV_VAR_NAME, "envVars entries must be env var names"))
            .min(1)
            .max(10)
            .optional(),
    })
    .superRefine((value, ctx) => {
        if (value.factory) {
            if (!value.envVars) {
                ctx.addIssue({
                    code: "custom",
                    message: "an auth provider with a factory must also declare envVars",
                });
            }
            if (value.envIdVar || value.envSecretVar) {
                ctx.addIssue({
                    code: "custom",
                    message:
                        "an auth provider with a factory takes its credentials from envVars, " +
                        "not envIdVar/envSecretVar",
                });
            }
            return;
        }
        if (value.envVars) {
            ctx.addIssue({ code: "custom", message: "envVars only applies to an auth provider with a factory" });
        }
        if (value.standardCallback !== undefined) {
            ctx.addIssue({
                code: "custom",
                message:
                    "standardCallback only applies to an auth provider with a factory - a built-in " +
                    "provider already uses the standard callback URL",
            });
        }
        if (!value.envIdVar || !value.envSecretVar) {
            ctx.addIssue({
                code: "custom",
                message: "an auth provider without a factory needs both envIdVar and envSecretVar",
            });
        }
    });

const navbarComponent = z.object({
    id: z.string().min(1).max(64).regex(SAFE_SLUG),
    component: relativePath("component"),
    order: z.number().int(),
});

const footerComponent = z.object({
    id: z.string().min(1).max(64).regex(SAFE_SLUG),
    component: relativePath("component"),
    section: z.string().max(64).optional(),
    order: z.number().int().optional(),
});

const storageProvider = z.object({
    id: z.string().min(1).max(64).regex(SAFE_SLUG),
    name: z.string().min(1).max(100),
    handler: relativePath("handler"),
});

const contextProvider = z.object({
    id: z.string().min(1).max(64).regex(SAFE_SLUG),
    component: relativePath("component"),
    order: z.number().int().optional(),
});

const HOOK_NAME = /^[a-zA-Z0-9._-]+$/;

const hookListener = z.object({
    hook: z.string().min(1).max(128).regex(HOOK_NAME),
    type: z.enum(["action", "filter"]),
    handler: relativePath("handler"),
    priority: z.number().int().optional(),
});

/**
 * A hook this module fires. Declaring it makes the module's half of the
 * cross-module contract inspectable: `validate:module` checks the declaration
 * against the `doAction`/`applyFilters` calls in the source, and the
 * marketplace build rejects a `hookListeners` entry naming a hook no module in
 * the catalog emits - which is the only thing that can catch a typo in a hook
 * name, since nothing fails at runtime when a listener never fires.
 */
const hookEmitted = z.object({
    hook: z.string().min(1).max(128).regex(HOOK_NAME),
    type: z.enum(["action", "filter"]),
    description: z.string().max(200).optional(),
});

const slotContent = z.object({
    id: z.string().min(1).max(64).regex(SAFE_SLUG),
    slot: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/),
    component: relativePath("component"),
    order: z.number().int().optional(),
});

const slotContribution = z.object({
    name: z.string().min(1).max(128).regex(/^[a-zA-Z0-9.-]+$/),
    component: relativePath("component"),
    order: z.number().int().optional(),
    id: z.string().min(1).max(64).regex(SAFE_SLUG).optional(),
});

const cronJob = z.object({
    id: z.string().min(1).max(64).regex(SAFE_SLUG),
    // A name the scheduler cannot turn into an interval is a job that never
    // runs, and it used to reach an install unremarked.
    schedule: z.enum(CRON_SCHEDULES),
    handler: relativePath("handler"),
});

/**
 * A full-text index the module needs on one of its own tables.
 *
 * Modules declare identifiers, never SQL. Core builds the `to_tsvector(...)`
 * expression from them, so a module cannot inject anything into the DDL - and
 * the regex below is what makes that guarantee hold rather than assume it.
 */
const searchIndex = z.object({
    table: z.string().min(1).max(63).regex(/^[A-Za-z][A-Za-z0-9_]*$/, "table must be a plain SQL identifier"),
    columns: z
        .array(z.string().min(1).max(63).regex(/^[A-Za-z][A-Za-z0-9_]*$/, "column must be a plain SQL identifier"))
        .min(1)
        .max(10),
});

const searchProvider = z.object({
    id: z.string().min(1).max(64).regex(SAFE_SLUG),
    label: z.string().min(1).max(100),
    handler: relativePath("handler"),
    icon: iconName.optional(),
    /**
     * Core used to carry a hardcoded list of four module tables in
     * `scripts/ensure-search-indexes.ts` - `BlogArticle`, `ForumTopic`,
     * `HelpArticle`, `Product` - which is exactly the coupling the project
     * forbids, and which logged an error for every uninstalled module on
     * every boot. The module that owns the table declares the index instead.
     */
    indexes: z.array(searchIndex).max(5).optional(),
});

/**
 * How an activity event is named and, where it can be, translated.
 *
 * `nameKey` is what the kind is called on its own - the word a filter above a
 * feed offers. It is required, because the alternative is the `type` column,
 * and a member reading their own account was shown `vote.vote.cast`.
 *
 * `prefix` and `key` translate the stored title, and they come as a pair or
 * not at all. Six events cannot use them: their English puts the entity in
 * the middle ("Received 40 credits") or after a clause, and `{ prefix, key }`
 * can only replace a head. Those declare a name and leave the title alone.
 */
const activityTitle = z.object({
    type: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/),
    nameKey: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/),
    prefix: z.string().max(128).optional(),
    key: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/).optional(),
}).refine(
    (entry) => (entry.prefix === undefined) === (entry.key === undefined),
    { message: "prefix and key describe one substitution: declare both or neither" },
);

const webhookReceiver = z
    .object({
        provider: z.string().min(1).max(64).regex(SAFE_SLUG),
        handler: relativePath("handler"),
        signatureHeader: z.string().max(128).optional(),
        secretEnv: z.string().max(128).regex(/^[A-Z0-9_]+$/).optional(),
        /**
         * Signals that the handler itself performs signature verification
         * (e.g. PayPal via REST API, Stripe via SDK). When false/omitted
         * and no signatureHeader/secretEnv pair is supplied, the dispatcher
         * refuses the request so a forgotten manifest field cannot
         * silently ship an unauthenticated webhook to production.
         */
        verifiesInHandler: z.boolean().optional(),
        /**
         * Header name that carries the sender's timestamp (Unix seconds,
         * Unix ms, or ISO-8601). When set, the dispatcher refuses any
         * request older than WEBHOOK_REPLAY_WINDOW_MS so a captured,
         * still-signed webhook can't be replayed forever. Pairs with HMAC
         * verification; meaningless without it.
         */
        timestampHeader: z.string().max(128).optional(),
    })
    .refine(
        (r) => Boolean(r.signatureHeader && r.secretEnv) || r.verifiesInHandler === true,
        {
            message:
                "webhookReceivers entry must either provide both signatureHeader+secretEnv for HMAC verification or set verifiesInHandler:true to take responsibility for its own signature check",
            path: ["signatureHeader"],
        },
    );

const notificationType = z.object({
    eventType: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/),
    label: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    channels: z.array(z.string().max(32)).optional(),
});

const layoutComponent = z.object({
    id: z.string().min(1).max(64).regex(SAFE_SLUG),
    component: relativePath("component"),
    include: z.array(z.string().max(256)).optional(),
    exclude: z.array(z.string().max(256)).optional(),
});

const settingsCard = z.object({
    title: z.string().min(1).max(100),
    description: z.string().max(500),
    href: panelRelativePath,
    icon: iconName,
    color: z.string().min(1).max(64),
});

const homepageSection = z.object({
    id: z.string().min(1).max(64).regex(SAFE_SLUG),
    type: z.enum(["content", "widget"]),
    component: relativePath("component"),
    order: z.number().int(),
});

const dashboardCard = z.object({
    id: z.string().min(1).max(64).regex(SAFE_SLUG),
    label: z.string().min(1).max(100),
    labelKey: z.string().max(128).optional(),
    icon: iconName,
    href: routePath,
    color: z.string().min(1).max(64),
    statKey: z.string().min(1).max(64).regex(SAFE_SLUG),
});

/**
 * A dashboard section panel. The panel's contents arrive at runtime from the
 * module's `statsApi`, but the dashboard customizer is rendered before any of
 * those endpoints are called, so a panel nobody declared could never appear in
 * the list of things an admin is allowed to hide. The id here must match the
 * `sections[].id` the stats endpoint returns.
 */
const dashboardSection = z.object({
    id: z.string().min(1).max(64).regex(SAFE_SLUG),
    label: z.string().min(1).max(100),
    labelKey: z.string().max(128).optional(),
});

const userDataExportEntry = z.object({
    model: z.string().min(1).max(128).regex(/^[a-zA-Z][a-zA-Z0-9]*$/, "model must be a Prisma delegate identifier"),
    key: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/),
    column: z.string().min(1).max(128).regex(/^[a-zA-Z][a-zA-Z0-9]*$/),
    /**
     * What happens to this table when the user asks to be forgotten.
     *
     * "purge" deletes the rows; "retain" keeps them joined to the anonymised
     * user row, which is right for anything with public-record or moderation
     * value (a forum topic, an order, a ticket). Omitted means "retain",
     * because that is what every table did before core could be told.
     */
    erasure: z.enum(["purge", "retain"]).optional(),
});

const moderationProvider = z.object({
    id: z.string().min(1).max(64).regex(SAFE_ID, "id must be lowercase alphanumeric + hyphens"),
    label: z.string().min(1).max(100),
    labelKey: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/).optional(),
    settingKey: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/).optional(),
    settingLabelKey: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/).optional(),
    settingDescKey: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/).optional(),
    handler: relativePath("handler"),
});

type TranslationValue = string | { [key: string]: TranslationValue };
const translationValue: z.ZodType<TranslationValue> = z.lazy(() =>
    z.union([z.string(), z.record(z.string(), translationValue)]),
);
const translations = z.record(z.string(), z.record(z.string(), translationValue));

/**
 * External origins a module needs the Content-Security-Policy to allow.
 *
 * Core's CSP is one fixed list, and it used to carry payment gateway origins
 * by name - which is core knowing about modules, and was wrong twice over,
 * since neither gateway ever loaded them and three features that did need an
 * origin were blocked. The Discord widget's iframe and the Google Analytics
 * tag both rendered nothing, with no error anywhere but the browser console.
 *
 * A module may only widen the fetch directives, and only with a concrete
 * https origin. Keywords are refused outright: `'unsafe-inline'`,
 * `'unsafe-eval'`, `*`, `data:` and a bare scheme would let one module undo
 * the policy for every page on the site.
 */
const CSP_ORIGIN = z
    .string()
    .min(1)
    .max(253)
    .regex(
        /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/,
        "must be a concrete https origin, e.g. https://discord.com",
    );

/**
 * The same, plus a socket.
 *
 * `connect-src` governs what a page may open, and for a chat widget that is a
 * websocket rather than a request: the conversation arrives down it. With only
 * `https://` accepted, a module needing one had two options and both were bad
 * - leave it out and let the policy block the socket, which is a bubble that
 * appears and never connects, or widen the policy by hand somewhere core
 * cannot see.
 *
 * Only here, and only encrypted. `ws://` would take the conversation off the
 * connection the rest of the page is on, and a socket is not where a script,
 * a stylesheet or a picture comes from.
 */
const CSP_CONNECT_ORIGIN = z
    .string()
    .min(1)
    .max(253)
    .regex(
        /^(https|wss):\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/,
        "must be a concrete https or wss origin, e.g. https://discord.com",
    );

export const moduleCspSchema = z
    .object({
        "script-src": z.array(CSP_ORIGIN).max(10).optional(),
        "frame-src": z.array(CSP_ORIGIN).max(10).optional(),
        "connect-src": z.array(CSP_CONNECT_ORIGIN).max(10).optional(),
        "img-src": z.array(CSP_ORIGIN).max(10).optional(),
        "style-src": z.array(CSP_ORIGIN).max(10).optional(),
        "font-src": z.array(CSP_ORIGIN).max(10).optional(),
        "media-src": z.array(CSP_ORIGIN).max(10).optional(),
    })
    .strict();

const cspContribution = moduleCspSchema;

/**
 * One admin-editable setting a module declares.
 *
 * This replaced `defaultConfig`, a bare `Record<string, unknown>` of values.
 * That field could only ever supply a default: it carried no type, no bounds
 * and no label, so core could not render it, could not validate what an admin
 * submitted for it, and could not tell a live setting from a forgotten one.
 * Five modules declared sixteen keys under it and not one of them was read
 * anywhere. A declaration that describes itself is what makes the settings
 * form, the PATCH validation, the runtime read path and the
 * "every declared key is read" gate all possible from one source.
 */
const moduleSetting = z
    .object({
        key: z.string().min(1).max(48).regex(/^[a-z][A-Za-z0-9]*$/, "setting key must be lowerCamelCase"),
        type: z.enum(["boolean", "number", "string"]),
        default: z.union([z.boolean(), z.number(), z.string()]),
        /** English label shown in the admin form. */
        label: z.string().min(1).max(80),
        description: z.string().max(200).optional(),
        /** Required for `number`: an admin form and a clamp both need bounds. */
        min: z.number().optional(),
        max: z.number().optional(),
        /**
         * How finely a `number` may be set. A number input's default step is
         * 1, so a price of 0.013 a credit was a value the browser marked
         * invalid and an admin could not enter - the setting existed and
         * could not be used. Omit it for a whole-number setting.
         */
        step: z.number().positive().optional(),
        /** Required for `string`, for the same reason. */
        maxLength: z.number().int().min(1).max(10_000).optional(),
    })
    .strict()
    .superRefine((setting, ctx) => {
        if (typeof setting.default !== setting.type) {
            ctx.addIssue({ code: "custom", message: `setting "${setting.key}": default must be a ${setting.type}` });
        }
        if (setting.type === "number") {
            if (setting.min === undefined || setting.max === undefined) {
                ctx.addIssue({ code: "custom", message: `setting "${setting.key}": a number setting must declare min and max` });
            } else if (setting.min > setting.max) {
                ctx.addIssue({ code: "custom", message: `setting "${setting.key}": min is greater than max` });
            } else if (typeof setting.default === "number" && (setting.default < setting.min || setting.default > setting.max)) {
                ctx.addIssue({ code: "custom", message: `setting "${setting.key}": default is outside min..max` });
            }
        } else if (setting.min !== undefined || setting.max !== undefined || setting.step !== undefined) {
            ctx.addIssue({ code: "custom", message: `setting "${setting.key}": min/max/step only apply to a number setting` });
        }
        if (setting.type === "string") {
            if (setting.maxLength === undefined) {
                ctx.addIssue({ code: "custom", message: `setting "${setting.key}": a string setting must declare maxLength` });
            } else if (typeof setting.default === "string" && setting.default.length > setting.maxLength) {
                ctx.addIssue({ code: "custom", message: `setting "${setting.key}": default is longer than maxLength` });
            }
        } else if (setting.maxLength !== undefined) {
            ctx.addIssue({ code: "custom", message: `setting "${setting.key}": maxLength only applies to a string setting` });
        }
    });

export const moduleManifestSchema = z.object({
    id: z.string().min(1).max(64).regex(SAFE_ID, "id must be lowercase alphanumeric + hyphens"),
    name: z.string().min(1).max(100),
    description: z.string().min(1).max(500),
    version: z.string().min(1).max(32).regex(/^\d+\.\d+\.\d+/, "version must be semver"),
    author: z.string().max(100).optional(),
    icon: iconName.optional(),
    /**
     * The permission names this module owns, each with the words a person
     * reads on the roles screen.
     *
     * The name is for the code; the label is what an operator decides a job by.
     * `labelKey` resolves in this module's own `translations`, like `titleKey`,
     * and says only what the capability is - the screen groups rows under the
     * module's own name, so a label that repeated it would read as
     * "Announcements Announcements yönetebilir".
     */
    permissions: z
        .array(
            z.object({
                name: z.string().min(3).max(128).regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/),
                labelKey: z.string().min(3).max(128).regex(/^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_-]+)+$/),
            }),
        )
        .max(100)
        .optional(),
    /**
     * Admin-editable settings. `defaultConfig` is deliberately absent: the
     * manifest is `.strict()`, so a module still carrying it fails to load
     * with a clear error rather than shipping a field nothing reads.
     */
    settings: z
        .array(moduleSetting)
        .max(50)
        .refine(
            (list) => new Set(list.map((s) => s.key)).size === list.length,
            "settings: duplicate key",
        )
        .optional(),
    /**
     * The settings key this module's screen writes the mail API key to.
     *
     * Core owns the mailer and no module owns it, but the key's *name* is the
     * provider module's vocabulary, and core read that name literally for as
     * long as this existed. Declaring it means core asks "which key holds
     * the mail credential" instead of knowing the answer, which is the same
     * shape as every other provider contract here.
     *
     * Declare it in `secretSettings` too: it is a credential like any other.
     */
    emailProvider: z
        .object({
            apiKeySetting: z
                .string()
                .min(1)
                .max(64)
                .regex(/^[a-z][a-z0-9_]*$/, "emailProvider.apiKeySetting must be a snake_case setting key"),
            /** Environment fallback, for an install configured from the image. */
            envVar: z
                .string()
                .min(1)
                .max(64)
                .regex(/^[A-Z][A-Z0-9_]*$/, "emailProvider.envVar must be SCREAMING_SNAKE_CASE")
                .optional(),
        })
        .strict()
        .optional(),

    /**
     * Keys in the site settings store whose value is a credential.
     *
     * A gateway's secret key, an invoicing provider's password, a webhook
     * signing secret: anything that authenticates this install to somebody
     * else. Core encrypts a declared key on write, decrypts it on read for
     * the module that owns it, and never sends it to a browser.
     *
     * The declaration lives here rather than in core because core may not
     * name a module, and it is a list rather than a flag on `settings`
     * because these are not module settings: they are keys in the shared
     * `Setting` table, written by the site settings endpoint, and they are
     * snake_case for that reason.
     *
     * `key.field` addresses a credential that is one field of a stored
     * object, which is how a module with its own settings endpoint keeps a
     * whole configuration under one key.
     */
    secretSettings: z
        .array(
            z
                .string()
                .min(1)
                .max(96)
                .regex(
                    /^[a-z][a-z0-9_]*(\.[a-zA-Z][a-zA-Z0-9]*)?$/,
                    "secretSettings: expected a snake_case setting key, optionally with a .field suffix",
                ),
        )
        .max(50)
        .refine((list) => new Set(list).size === list.length, "secretSettings: duplicate key")
        .optional(),
    dependencies: z.array(dependencySpec).max(50).optional(),
    conflicts: z.array(dependencySpec).max(50).optional(),
    /**
     * Range of CORE_API_VERSION this module was built against.
     *
     * Required. It used to be optional, and an omitted range meant
     * "unconstrained" - which is the one answer a compatibility gate must
     * never accept by default: a module built against a core it has never
     * seen installed silently and failed at runtime instead of at install
     * time. Declaring the range is one line, and getting it wrong is a clear
     * error message; guessing on the module's behalf is neither.
     */
    coreVersion: semverRange,
    /**
     * Marketplace grouping. Free-form rather than a fixed enum so core owns no
     * category vocabulary - the catalog groups by whatever values are present.
     */
    category: z.string().min(1).max(32).regex(SAFE_ID, "category must be a lowercase slug").optional(),
    tags: z.array(z.string().min(1).max(32)).max(10).optional(),
    translations: translations.optional(),

    hooks: z.object({
        onEnable: relativePath("onEnable").optional(),
        onDisable: relativePath("onDisable").optional(),
    }).optional(),

    menu: z.array(menuItem).max(100).optional(),
    routes: z.array(routeEntry).max(200).optional(),
    adminRoutes: z.array(adminRouteEntry).max(200).optional(),
    api: z.array(apiEntry).max(500).optional(),
    widgets: z.array(widgetEntry).max(50).optional(),
    navLinks: z.array(navLink).max(50).optional(),
    footerLinks: z.array(footerLink).max(50).optional(),
    profileTabs: z.array(profileTab).max(50).optional(),
    oauthButtons: z.array(oauthButton).max(20).optional(),
    navGroups: z.array(navGroup).max(20).optional(),
    authProviders: z.array(authProvider).max(20).optional(),
    webhookChannels: z.array(webhookChannel).max(20).optional(),
    navbarComponents: z.array(navbarComponent).max(30).optional(),
    footerComponents: z.array(footerComponent).max(30).optional(),
    storageProviders: z.array(storageProvider).max(10).optional(),
    contextProviders: z.array(contextProvider).max(20).optional(),
    hookListeners: z.array(hookListener).max(200).optional(),
    hooksEmitted: z.array(hookEmitted).max(200).optional(),
    slotContents: z.array(slotContent).max(100).optional(),
    slots: z.array(slotContribution).max(200).optional(),
    cronJobs: z.array(cronJob).max(50).optional(),
    searchProviders: z.array(searchProvider).max(20).optional(),
    activityTitles: z.array(activityTitle).max(50).optional(),
    permissionResources: z.array(z.string().min(1).max(128).regex(/^[a-z0-9._-]+$/)).max(100).optional(),
    webhookReceivers: z.array(webhookReceiver).max(50).optional(),
    notificationTypes: z.array(notificationType).max(100).optional(),
    layoutComponents: z.array(layoutComponent).max(50).optional(),
    settingsCards: z.array(settingsCard).max(50).optional(),
    homepageSections: z.array(homepageSection).max(50).optional(),
    dashboardCards: z.array(dashboardCard).max(50).optional(),
    dashboardSections: z.array(dashboardSection).max(20).optional(),
    statsApi: routePath.optional(),
    seoRoutes: z.object({ handler: relativePath("handler") }).optional(),
    userDataExport: z.array(userDataExportEntry).max(50).optional(),
    moderationProviders: z.array(moderationProvider).max(20).optional(),
    csp: cspContribution.optional(),
}).strict();

export type ValidatedModuleManifest = z.infer<typeof moduleManifestSchema>;

/**
 * Collects every `handler`/`component` path referenced by a manifest. Used
 * after ZIP extraction to verify that files the manifest claims actually exist.
 */
/**
 * The file extensions a manifest ref may be written without. The registry
 * generator strips any extension off a ref and emits a bare import specifier
 * (`@/modules/blog/components/BlogNewsSection`), leaving the bundler to pick
 * the file - so `components/Foo`, `components/Foo.tsx` and `components/Foo/`
 * all name the same module. Anything that validates refs against the disk has
 * to apply the same rule or it rejects manifests the build would have loaded
 * fine.
 */
const MODULE_REF_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs"];

/**
 * Every on-disk path a single manifest ref may legitimately resolve to, in the
 * order a resolver should try them: the literal path first (a ref that already
 * carries its extension), then each extension appended, then `index.*` inside
 * a directory of that name.
 *
 * Pure - no filesystem access - so this stays importable from the client
 * bundle alongside the rest of the schema. `checkManifestFileRefs` in
 * `module-ref-resolver.ts` is the filesystem-aware half.
 */
export function manifestRefCandidates(ref: string): string[] {
    const cleaned = ref.replace(/^\.\//, "").replace(/\/+$/, "");
    const base = cleaned.replace(/\.(tsx|ts|jsx|js|mjs|cjs)$/, "");
    const candidates = [cleaned];
    for (const ext of MODULE_REF_EXTENSIONS) candidates.push(base + ext);
    for (const ext of MODULE_REF_EXTENSIONS) candidates.push(`${base}/index${ext}`);
    return [...new Set(candidates)];
}

export function collectManifestFileRefs(m: ValidatedModuleManifest): string[] {
    const refs: string[] = [];
    const push = (v: string | undefined) => { if (v) refs.push(v); };

    m.routes?.forEach((r) => { push(r.component); push(r.layout); push(r.resolver); });
    m.adminRoutes?.forEach((r) => push(r.component));
    m.api?.forEach((r) => push(r.handler));
    m.widgets?.forEach((r) => push(r.component));
    m.profileTabs?.forEach((r) => push(r.component));
    m.navbarComponents?.forEach((r) => push(r.component));
    m.footerComponents?.forEach((r) => push(r.component));
    m.storageProviders?.forEach((r) => push(r.handler));
    m.contextProviders?.forEach((r) => push(r.component));
    m.hookListeners?.forEach((r) => push(r.handler));
    m.slotContents?.forEach((r) => push(r.component));
    m.slots?.forEach((s) => push(s.component));
    m.cronJobs?.forEach((r) => push(r.handler));
    m.searchProviders?.forEach((r) => push(r.handler));
    m.webhookReceivers?.forEach((r) => push(r.handler));
    m.layoutComponents?.forEach((r) => push(r.component));
    m.homepageSections?.forEach((r) => push(r.component));
    push(m.hooks?.onEnable);
    push(m.hooks?.onDisable);
    push(m.seoRoutes?.handler);
    m.moderationProviders?.forEach((r) => push(r.handler));
    m.authProviders?.forEach((r) => push(r.factory));

    return [...new Set(refs)];
}
