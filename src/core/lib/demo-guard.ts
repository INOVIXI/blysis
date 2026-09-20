/**
 * What a public demo refuses, and why.
 *
 * A demo is worth having only if a visitor can actually use the product, so
 * the answer is not "refuse every write". It is: let them add, edit and
 * delete the things the product is about, and refuse the handful that would
 * take the demo away from the next visitor. An hourly reset puts the rest
 * back - see `scripts/demo-reset.ts`.
 *
 * Five things are refused, and each is refused for one of these reasons:
 *
 * **It locks somebody out.** Maintenance mode, the rate limits, the roles
 * themselves, two-factor on a shared account, the translations every screen
 * reads, a redirect that moves the front page. One visitor doing any of these
 * ends the demo for everybody until the reset, and two of them survive it.
 *
 * **It makes this server dial out.** An alerting webhook, a Discord test
 * send, a database connection string. The address is the visitor's to choose,
 * so the server becomes their request-forwarder: a probe of whatever is
 * reachable from inside, pointed wherever they like.
 *
 * **It writes a credential.** Storage keys, a captcha secret. Most settings
 * screens post to `/api/v1/settings`, which is one of these; the few modules
 * that kept their own endpoint are named individually.
 *
 * **It costs something real.** A backup writes a dump per press. A broadcast
 * sends mail. A checkout starts a payment.
 *
 * **It is somebody else's account.** Deleting a member, changing a password,
 * impersonating, issuing a warning.
 *
 * This list was a chain of `if`s inside the proxy and had grown blind spots
 * worth naming: the two-factor rule matched `/api/v1/two-factor/`, which
 * nothing serves - the module mounts at `/api/v1/auth/two-factor/` - so a
 * visitor could put two-factor on the shared account and take the demo with
 * them. Maintenance mode, the rate limits, the roles and the translations
 * were not listed at all. `a-demo-refuses-what-would-break-it.test.ts` is
 * what stops the next one: every endpoint that can be written to is either
 * refused here or named in that test as safe, so a new one cannot appear
 * without somebody ruling on it.
 */

import { ModuleDemoUnsafe } from "@/core/generated/module-registry";

export interface DemoRule {
    /** Matched against the pathname, which carries no locale for an API. */
    pattern: RegExp;
    /** Which verbs it covers. Absent means every mutating one. */
    methods?: readonly string[];
    /** Why a person reading this later should keep it. */
    why: string;
}

const MUTATING = ["POST", "PUT", "PATCH", "DELETE"] as const;

export const DEMO_REFUSES: readonly DemoRule[] = [
    // ── It locks somebody out ────────────────────────────────────────────
    { pattern: /^\/api\/v1\/admin\/maintenance$/, why: "closes the site to everybody" },
    { pattern: /^\/api\/v1\/admin\/rate-limits$/, why: "a ceiling of zero refuses every request" },
    { pattern: /^\/api\/v1\/roles(?:\/|$)/, why: "the admin role is what opens the panel" },
    { pattern: /^\/api\/v1\/admin\/translations/, why: "every screen would read its own keys" },
    { pattern: /^\/api\/v1\/auth\/two-factor\//, why: "a second factor on a shared account is a lock with one key" },
    { pattern: /^\/api\/v1\/auth\/(?:setup|disable|verify)$/, why: "the same, under the names this module also answers to" },
    { pattern: /^\/api\/v1\/admin\/ip-blocks/, why: "blocks the next visitor by address" },
    { pattern: /^\/api\/v1\/settings$/, why: "the site's own name, wording and switches" },
    { pattern: /^\/api\/v1\/seo\/settings$/, why: "what every page tells a search engine" },

    // ── It makes this server dial out ────────────────────────────────────
    { pattern: /^\/api\/v1\/admin\/alerting/, why: "an address of the visitor's choosing, called by this server" },

    // ── It writes a credential ───────────────────────────────────────────
    { pattern: /^\/api\/v1\/storage\//, why: "where uploads go, and the keys to get there" },
    { pattern: /^\/api\/v1\/security\/turnstile\/settings$/, why: "breaking the captcha closes registration" },
    { pattern: /^\/api\/v1\/api-keys/, why: "a key would answer as this site from outside the demo gate" },

    // ── It reaches out of this machine ───────────────────────────────────
    { pattern: /^\/api\/v1\/rcon$/, why: "runs a command on a game server somewhere else" },
    { pattern: /^\/api\/v1\/admin\/updates$/, why: "pulls an image and recreates the container this is running in" },

    // ── It costs something real ──────────────────────────────────────────
    { pattern: /^\/api\/v1\/admin\/backup/, why: "a database dump on disk, per press" },
    { pattern: /^\/api\/v1\/broadcasts/, why: "mail to every address on the site" },
    { pattern: /^\/api\/v1\/admin\/email-queue\//, why: "the same, from the queue" },
    { pattern: /^\/api\/v1\/admin\/cron/, why: "a job on demand, as often as asked, and the schedule it keeps" },
    { pattern: /^\/api\/v1\/me\/avatar$/, why: "an upload, which is disk and bandwidth like any other" },
    { pattern: /^\/api\/v1\/store\/checkout/, why: "starts a real payment" },
    { pattern: /^\/api\/v1\/upload/, why: "disk and bandwidth" },
    { pattern: /^\/api\/v1\/media/, why: "the same, through the library" },
    { pattern: /^\/api\/v1\/themes\/upload/, why: "an archive, unpacked on disk" },

    // ── It is somebody else's account ────────────────────────────────────
    { pattern: /^\/api\/v1\/auth\/profile\/delete$/, why: "the account the next visitor signs in as" },
    { pattern: /^\/api\/v1\/auth\/profile\/password/, why: "the password the next visitor is given" },
    { pattern: /^\/api\/v1\/auth\/email-change/, why: "moves the account to an address nobody here owns" },
    { pattern: /^\/api\/v1\/users(?:\/|$)/, why: "another member's account, and making more of them" },
    { pattern: /^\/api\/v1\/admin\/security\/lockouts/, why: "the same, from the other side" },
    { pattern: /^\/api\/v1\/admin\/impersonate\//, why: "signs in as somebody else" },
    { pattern: /^\/api\/v1\/warnings/, why: "a mark on a member who cannot answer" },
    { pattern: /^\/api\/v1\/admin\/customers\/[^/]+\/restrictions$/, why: "takes a member's own screens away" },

    // ── It changes what the demo is ──────────────────────────────────────
    { pattern: /^\/api\/v1\/modules(?:\/|$)/, why: "the demo is every module, switched on" },
    { pattern: /^\/api\/v1\/themes$/, why: "which theme the site wears" },
    { pattern: /^\/api\/v1\/themes\/state$/, why: "switching the theme the site wears, by another name" },
    { pattern: /^\/api\/v1\/themes\/marketplace\/install/, why: "downloads and unpacks an archive" },
    { pattern: /^\/api\/v1\/themes\/[^/]+$/, methods: ["DELETE"], why: "removes a theme the site may be wearing" },
];

/**
 * What the installed modules said about themselves.
 *
 * A module knows which of its own endpoints dials out or writes a credential;
 * core knows what makes an endpoint unsafe in a demo and must not know which
 * module has one. Matched by prefix, so a route nested under a declared path
 * is covered without the module listing it twice.
 */
const MODULE_REFUSES = ModuleDemoUnsafe.map((entry) => `/api/v1${entry.path}`);

/** Whether a public demo refuses this request. */
export function isBlockedInDemo(method: string, pathname: string): boolean {
    const verb = method.toUpperCase();
    if (!(MUTATING as readonly string[]).includes(verb)) return false;

    // A trailing slash and a query string are the caller's; a rule is
    // anchored at the end of the path and every caller that forgot to strip
    // them would fail open.
    const path = pathname.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";

    if (MODULE_REFUSES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return true;

    return DEMO_REFUSES.some((rule) =>
        (rule.methods ? rule.methods.includes(verb) : true) && rule.pattern.test(path));
}
