/**
 * Blysis module SDK - isomorphic surface.
 *
 * This is the supported import path for modules. `@/core/lib/*` is core's
 * internal layout and modules must not reach into it: core refactors freely
 * behind this file, and `scripts/validate-module.ts` rejects a module that
 * bypasses it.
 *
 * Every symbol is listed explicitly rather than re-exported with `export *`,
 * so widening the public surface is a visible diff someone has to approve.
 *
 * Entry points are split by runtime, not by topic - a barrel that mixed them
 * would drag `prisma` into a client bundle the moment a component imported
 * `formatDate`.
 *
 * This file in particular stays dependency-light on purpose: `clsx`,
 * `tailwind-merge` and a hook bus with no imports at all. The project declares
 * no `sideEffects: false`, so a bundler cannot drop unused re-exports from a
 * barrel - anything heavy added here is paid for by every client component
 * that imports `formatDate`. `renderMarkdown` cleans what it renders, for exactly
 * that reason: it pulls `isomorphic-dompurify`, and no module uses it from
 * client code.
 *
 *   `@/core/sdk`             this file - safe in server AND client code
 *   `@/core/sdk/server`      server-only: database, permissions, crypto, I/O
 *   `@/core/sdk/auth`        the Auth.js session helper
 *   `@/core/sdk/navigation`  locale-aware client navigation
 *   `@/core/sdk/blocks`      page-builder block config (pulls in Puck)
 *   `@/core/sdk/theme`       active theme config + component overrides
 *   `@/core/sdk/ui`          shared UI primitives (client)
 *   `@/core/sdk/layout`      navbar / footer / slots (page composition)
 *   `@/core/sdk/admin`       admin CRUD and settings scaffolds
 *
 * Adding a symbol here is a minor CORE_API_VERSION bump; changing or removing
 * one is a major bump. See `core-version.ts`.
 */

// --- Formatting and string helpers (clsx / tailwind-merge only) ---
export {
    cn,
    dateLocaleTag,
    formatCurrency,
    formatDate,
    slugify,
    stripHtmlTags,
    generateSlug,
    generateOrderNumber,
} from "@/core/lib/utils";

/**
 * The one-line check that a write actually went through. `fetch` resolves for
 * a 403, a 429 and a 500 alike, so a handler that does not read the response
 * reports success for all three.
 *
 *     const failed = await writeError(res, t("saveFailed"));
 *     if (failed) { toast.error(failed); return; }
 */
/**
 * Copy to the clipboard on a plain-http origin too.
 *
 * `navigator.clipboard` only exists in a secure context, so on a self-hosted
 * site reached by IP over http:// every "Copy" button threw and did nothing.
 * `copyText` uses the real API where there is one and an offscreen textarea
 * where there is not, and returns whether the text actually landed.
 */
export { sharedJson, peekShared, invalidateShared } from "@/core/lib/shared-request";

export { copyText } from "@/core/lib/copy-text";

export { writeError, errorMessage } from "@/core/lib/write-result";

/**
 * The site's clock, as pure functions. "Friday at 18:00" is not a moment
 * until somebody says whose clock; `siteTimeZone()` in `@/core/sdk/server`
 * answers that, and these read it. Safe in a browser bundle - they are
 * `Intl` and arithmetic.
 */
export { zonedNow, weekdayIn, minutesInto, isValidTimeZone, wallClockToInstant, instantToWallClock, DEFAULT_TIME_ZONE } from "@/core/lib/site-time";
export type { WriteErrorBody } from "@/core/lib/write-result";
export type { Translator } from "@/core/lib/auth-error-message";

// --- The hook bus: how modules talk to core and to each other ---
export {
    addAction,
    addFilter,
    doAction,
    doActionAsync,
    applyFilters,
    applyFiltersAsync,
    HookNames,
} from "@/core/lib/hooks";

/**
 * Hook typing helpers. `HookHandlerFor` is the one module authors reach for -
 * it types a `hookListeners` handler from the hook's declared payload:
 *
 *     const onOrderCreated: HookHandlerFor<"store.order.created", "action"> =
 *         async (order) => { … };
 *     export default onOrderCreated;
 *
 * The payload itself is declared by whichever module FIRES the hook, in a
 * `declare global { interface BlysisHookPayloads { … } }` block.
 */
export type {
    ActionPayload,
    FilterValue,
    FilterContext,
    HookHandlerFor,
    AssertHookHandler,
    Expect,
} from "@/core/lib/hooks";

// Where a moved page now lives. The rules come from whoever manages them; the
// decision - a circle, an open redirect, the locale prefix - is core's, made
// in the proxy before anything renders.
export { resolveRedirect } from "@/core/lib/redirect-resolve";
export type { RedirectRule } from "@/core/lib/redirect-resolve";

// Who may read, write and reply in a container: a forum category, a support
// department, whatever has sections next. Two silences that mean opposite
// things, and a child that is never more open than its parent.
export { accessByRole } from "@/core/lib/access-by-role";
export type { AccessNode, AccessRule, Access } from "@/core/lib/access-by-role";

// The writing half of the same decision. A grid that sends only its ticked
// rows sends nothing when an operator unticks everybody, which is read as
// "nobody has ruled on this" and opens the container to the world.
export { clearedMatrix, normalisedMatrix } from "@/core/lib/permission-matrix";
export type { MatrixRule } from "@/core/lib/permission-matrix";

// Keeping a member out of one part of the site rather than all of it. The
// scope is the asking module's own word; core never interprets it.
/**
 * A key that would reach the prototype chain rather than the object.
 *
 * Anything building an object out of keys that came from a request needs it,
 * and a module that copies the three names is a module that will not hear
 * about a fourth. The market's listing payload is one such object: written by
 * a member, stored as JSON, read back by whichever module claims the kind.
 */
export { isUnsafeKey } from "@/core/lib/safe-object";

export { restrictedFrom, SITE_WIDE } from "@/core/lib/restrictions";
export type { Restriction } from "@/core/lib/restrictions";

// Declarations an operator wrote for a role, judged as a browser reads them.
export { safeRoleCss } from "@/core/lib/role-css";
export { renderMarkdown } from "@/core/lib/markdown";
