/**
 * The hook payload registry - the typed half of the cross-module contract.
 *
 * A hook is an agreement between two modules that never import each other: the
 * emitter picks a name and a payload shape, the listener has to guess both.
 * These interfaces make the payload half checkable. `doAction` and friends look
 * the name up here; a name that is present must be passed the declared payload,
 * a name that is absent still accepts anything, so nothing is forced to
 * participate.
 *
 * ── Why globals rather than `declare module "@/core/lib/hooks"` ──
 * Interface augmentation has to name the module that DECLARES the interface,
 * and modules are forbidden from importing `@/core/lib/*` - they see core only
 * through `@/core/sdk`, which re-exports and therefore cannot be the
 * augmentation target. A global interface is reachable from any file without an
 * import specifier, which is exactly what a plugin host needs. The `Blysis`
 * prefix keeps the global type namespace unambiguous.
 *
 * ── How a module joins ──
 * Declare the payload in the module that EMITS the hook (it owns the shape),
 * in any `.ts`/`.d.ts` file inside the module:
 *
 *     declare global {
 *         interface BlysisHookPayloads {
 *             "store.order.created": { orderNumber: string; total: unknown };
 *         }
 *     }
 *     export {};
 *
 * Consumers then get the payload typed for free - `addAction("store.order.created",
 * (order) => …)` infers `order` - with no import between the two modules. When
 * the emitting module is not installed its declaration is absent, the name is
 * unknown, and the payload falls back to `unknown`: the compile-time story
 * matches the runtime one.
 *
 * Every name declared here must also appear in the emitting module's
 * `hooksEmitted` manifest field, which `npm run validate:module` enforces.
 */

interface BlysisHookPayloads {
    /** Fired once when the hook system finishes booting. */
    "core.boot": Record<string, never>;

    "user.registered": { userId: string; email: string; username: string };
    "user.login": { userId: string; email: string; ip: string | null; userAgent: string | null };
    "user.email.verified": { userId: string; email: string };
    "user.password.changed": { userId: string };
    "user.profile.updated": { userId: string; changes: Record<string, unknown> };
    "user.warning.issued": {
        warningId: string;
        userId: string;
        issuedById: string;
        reason: string;
        points: number;
        totalPoints: number;
    };
    "user.warning.threshold": { userId: string; points: number; threshold: number };

    /** An admin changed somebody else's account from the users screen. */
    "user.updated": { userId: string; changes: Record<string, unknown> };
    "user.banned": { userId: string; banned: boolean; reason: string | null };
    /**
     * The account has been anonymised under the right to be forgotten. Fired
     * after core has purged what it and the manifests know about, so a
     * listener is the last chance to clear anything else the module keeps -
     * a column it added to `User`, a cache, a file on disk.
     */
    "user.deleted": { userId: string; reason: string | null };

    "module.installed": { moduleId: string };
    "module.uninstalled": { moduleId: string };
    "module.enabled": { moduleId: string };
    "module.disabled": { moduleId: string };
}

/**
 * The same registry for filters: the value that flows through the chain.
 */
interface BlysisFilterPayloads {
    "email.subject": string;
    "email.body": string;

    /**
     * What a member may do: sign in, and write things other members read.
     *
     * Core asks; anything with an opinion about whether somebody may take part
     * answers. A listener may only *restrict* - every field is combined with
     * AND - because an answer that could widen core's own would make a row in
     * a module's table a way to unban an account.
     *
     * `reasonKey` is a message key the screen translates, never an identifier.
     * A member reads it.
     */
    "member.standing": {
        mayEnter: boolean;
        mayWrite: boolean;
        until: Date | null;
        reasonKey: string | null;
    };

    /**
     * Whether a login, registration or password reset may proceed. Core runs
     * this before it checks credentials or creates an account; a listener
     * returns `{ ok: false, code }` to refuse. See core/lib/auth-challenge.ts.
     */
    "auth.challenge": { ok: boolean; code: string | null };

    /**
     * Where a moved page now lives.
     *
     * A redirect has to be decided before anything renders, which is the
     * proxy, which is core. A module cannot reach in there and core must not
     * know which module is answering, so core asks and whoever is installed
     * replies with rules. Core names the question; it names nobody.
     *
     * The answer is asked for once and cached: this runs on every request that
     * is not a static asset, and a database read per request is not a price a
     * site should pay for a feature most of them never use.
     */
    "routing.redirects": RoutingRedirectRule[];

    /**
     * What each installed module knows about one member, for the screen an
     * operator opens when somebody writes in.
     *
     * They are looking at one person and the answer is spread across
     * everything installed: what they bought, what they are owed, what they
     * have asked for, what has been done about them. Core cannot gather that
     * without knowing which modules exist, so it asks and never learns who
     * answered.
     */
    "admin.customer.panels": CustomerPanel[];

    /**
     * What an operator has decided one page's head should say.
     *
     * Core builds a head from what the page itself declared and had no way to
     * be told otherwise. Per-page overrides lived in a module that cannot
     * export `generateMetadata` for pages it does not own, so it rewrote
     * `document.head` from the browser and a crawler never saw any of it.
     *
     * Core asks per page, with the path and the language, and applies whatever
     * comes back over the values it computed. Every field is an override and
     * `null` means "no opinion", so a listener with nothing to say returns the
     * value it was given. See core/lib/seo.ts.
     */
    "seo.pageMeta": PageMetaOverride;

    /**
     * The part of the head that belongs to the site rather than to a page:
     * how a page's name is framed in the tab, and the tokens a search engine
     * asks you to publish to prove you own the domain.
     *
     * Asked once, by the root layout. Kept apart from `seo.pageMeta` because
     * only the root layout can set an inherited title template, and because a
     * verification token is about the domain and would be a strange thing to
     * answer per path.
     */
    "seo.siteHead": SiteHeadOverride;
}

/** The site's own head, as whatever manages SEO would have it. */
interface SiteHeadOverride {
    /** The tab title for a page that names none of its own. */
    defaultTitle: string | null;
    /** How a page's name is framed, with `%s` standing for the name. */
    titleTemplate: string | null;
    /** Comma-separated, or null for no keywords tag at all. */
    keywords: string | null;
    /** The `content` value from the tag the search engine hands you. */
    googleVerification: string | null;
    bingVerification: string | null;
}

/** One page's head, as whatever manages SEO would have it. */
interface PageMetaOverride {
    title: string | null;
    description: string | null;
    /**
     * What a share card says, where it should differ from the search result.
     * Falls back to `title` and `description`, which is what most pages want.
     */
    ogTitle: string | null;
    ogDescription: string | null;
    /** The social sharing image, absolute or rooted at the site. */
    image: string | null;
    /** Replaces the canonical core derived; the hreflang set is kept. */
    canonical: string | null;
    /** Comma-separated, as the `keywords` meta tag wants them. */
    keywords: string | null;
    /**
     * Only ever a refusal. A page core already refuses to have indexed stays
     * refused: core spreads its own `robots` over what comes back.
     */
    noIndex: boolean;
    noFollow: boolean;
}

/**
 * One module's answer about one member.
 *
 * The words arrive translated. A panel is assembled on the server, where the
 * module can reach its own catalogue and the reader's language, and sending a
 * key instead would mean the screen knowing which namespace each module keeps
 * its words in - and would send admin-only words to every page, which is
 * exactly what their prefix exists to prevent.
 */
interface CustomerPanel {
    /** Unique across modules; the module's own id is the usual choice. */
    key: string;
    /** A heading, in the reader's language. */
    label: string;
    /** Read straight down: a label and what it says, both ready to draw. */
    rows: { label: string; value: string }[];
    /** Where an operator goes to do something about it. */
    href?: string;
}

/** One moved page, as whatever manages them describes it. */
interface RoutingRedirectRule {
    /** The old path, without a locale prefix. */
    from: string;
    /** A path on this site, or a whole https address. */
    to: string;
    /** 308 rather than 307: a search engine should forget the old address. */
    permanent: boolean;
}

/**
 * What a filter is asked *about*, as opposed to the value it returns.
 *
 * A filter that asks a question needs both halves typed. `payment.session`
 * carries a result through the chain and an order to pay for alongside it, and
 * a gateway that misreads the second half fails at runtime on a path only two
 * particular modules reach. Declaring the context here types it at the call
 * site and in every listener.
 *
 * Filters with nothing to say about their context simply do not appear, and
 * their context stays `unknown` as before.
 */
interface BlysisFilterContexts {
    /**
     * Nothing. The rules are the site's, not this request's: they are asked
     * for once and kept, and deciding per request is what the resolver does
     * with them afterwards.
     */
    "routing.redirects": Record<string, never>;

    /**
     * Which member is being looked at, and which language to answer in.
     *
     * The locale is passed rather than looked up: this is asked from an API
     * route, where next-intl has no route segment to read one from, and a
     * panel that answered in the wrong language would be worse than one that
     * answered in keys.
     */
    "admin.customer.panels": { userId: string; locale: string };

    /**
     * What the visitor is trying to do, whatever the `auth.form.challenge`
     * slot asked to be sent, and where the request came from.
     */
    "auth.challenge": {
        /**
         * Which form is being filled in: one of core's own three, or a point
         * a module declared in its `challengePoints`.
         *
         * The wire name still says `auth` because it is the module-facing
         * contract and every module in the tree declares `coreVersion
         * ^5.0.0`; renaming it would refuse all of them until each was
         * republished. What it guards is any form that takes something
         * written - see `challenge-points.ts`.
         */
        action: string;
        fields: Record<string, string>;
        ip: string | null;
    };

    /**
     * Which page is being described, as a path below the locale segment, and
     * the language it is being rendered in. The path is the key an override is
     * stored against; the locale is there for a listener that keeps its
     * overrides per language.
     */
    "seo.pageMeta": {
        path: string;
        locale: string;
        /**
         * What core has built for this page so far.
         *
         * Here so a listener can tell an override from a fallback. A site-wide
         * share image should lose to the image a page chose for itself, and
         * without these a listener cannot know whether the page chose one -
         * so it would have had to either always win or never apply.
         */
        title: string;
        description: string;
        image: string | null;
    };

    /** The site's name, for a listener building a title template out of it. */
    "seo.siteHead": { siteName: string };

    /** The member being asked about. Never empty: core refuses that earlier. */
    "member.standing": { userId: string };

    /** Who the message is going to, before it reaches the provider. */
    "email.subject": { to: string };
    /** The same, plus the subject as the subject filter left it. */
    "email.body": { to: string; subject: string };
}
