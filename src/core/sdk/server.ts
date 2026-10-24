/**
 * Blysis module SDK - server-only surface.
 *
 * Every symbol here reaches the database, the filesystem, or Node crypto, so
 * importing it from a `"use client"` file fails the build. Client code wants
 * `@/core/sdk`.
 *
 * (No `server-only` guard import: that package is not a dependency of this
 * project and nothing else in the tree uses it. The bundler already rejects
 * these imports from a client component, which is the same outcome.)
 *
 * See `@/core/sdk` for the entry-point map and the rules for changing this
 * surface.
 */
// --- HTML sanitisation (isomorphic-dompurify; kept out of the light barrel) ---

// --- Database ---
export { prisma } from "@/core/lib/db";
/**
 * The client inside `prisma.$transaction(async (tx) => ...)`.
 *
 * Exported because money moves in one transaction or not at all, and the
 * module that owns a ledger is not the module that decides when to write to
 * it. A caller hands its transaction to the owner through a filter's context;
 * without a name for the type, the shape of that context could not be
 * declared.
 */
export type PrismaTransaction = Omit<
    import("@prisma/client").PrismaClient,
    "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

/**
 * Checking a member's password against the hash on their row.
 *
 * A module must never reach for `bcrypt.compare` itself. Which algorithm made
 * a hash is an operator setting, and a module comparing with one algorithm is
 * a module that starts refusing correct passwords the day the setting moves -
 * the two-factor module could disable nothing and close no account on a site
 * that had switched, while the same members signed in normally.
 */
export { verifyPassword } from "@/core/lib/password-hash";

/**
 * What a member may do, and the refusal when they may not.
 *
 * Every endpoint that takes something a member wrote calls `refuseSilenced`
 * and returns what it gives back. A punishment record that nothing enforced
 * was the reason: a moderator muted somebody and they went on posting, because
 * the mute was a row on a list and each endpoint decided for itself who could
 * write. `memberStanding` is the question underneath it, for a caller that
 * needs the answer rather than the refusal.
 */
export { refuseSilenced } from "@/core/lib/write-guard";
export { memberStanding, type MemberStanding } from "@/core/lib/member-standing";

// --- Homepage sections a theme or a module can render directly ---
// Reads the activity feed straight from the database rather than through the
// API. Its own doc comment always described it as something a theme could
// render; until it was exported here, the SDK boundary made that impossible.
export { ActivityFeedSection } from "@/core/components/homepage/ActivityFeedSection";

// --- Module state: what a module calls to gate its own endpoints ---
export { isModuleEnabled } from "@/core/lib/module-cache";

// --- Module settings: what a module calls to read its own admin settings ---
// Returns the manifest's declared defaults overlaid with whatever the admin has
// saved, each value checked and clamped against its declaration, so every key
// the manifest declares is present and correctly typed.
export { moduleSettings } from "@/core/lib/module-cache";
export type { SettingValue } from "@/core/lib/module-settings";

// --- Authorization (session lookup lives in @/core/sdk/auth) ---
export { hasPermission, hasResourcePermission, isAdmin, effectivePermissions } from "@/core/lib/permissions";

/**
 * Handing a member a role, which is core's to do rather than a module's.
 *
 * A module that wrote the rows itself would have to know that the displayed
 * role is a cache of the top of the set and remember to bring it up to date -
 * and one that forgot would leave a member wearing a role they no longer hold.
 * `grantRole` extends rather than duplicates, never turns a permanent role
 * into a temporary one, and leaves the cache true as its last act.
 */
export { grantRole, revokeRole, rolesHeldBy } from "@/core/lib/roles";

// --- Rate limiting ---
export {
    getClientIP,
    rateLimits,
    rateLimitForRole,
    rateLimitForRoleAsync,
} from "@/core/lib/rate-limit";

/**
 * A limit an operator's role multipliers cannot lift.
 *
 * `rateLimitForRole` scales its budget by the caller's role, and a multiplier
 * of 0 means unlimited - the right shape for throughput, the wrong one for a
 * guard on guessing a secret. Use this for the endpoints where the request
 * body is a password, a one-time code or a gift code: the ceiling is what
 * makes the guess unaffordable, so it has to hold for every role.
 */
export { rateLimit as rateLimitStrict } from "@/core/lib/rate-limit";

// A user who muted an event has to be able to mute it. The preferences
// grid in /profile has always written rows; nothing has ever read one back,
// because the only reader lived where no module could reach it.
export { shouldNotify } from "@/core/lib/notif-prefs";

// Where a page starts and how big it is. Sixteen list endpoints had written
// the same two lines and every one of them clamped the page from below only,
// so a large enough ?page= reached an OFFSET no 32-bit integer holds and the
// driver threw where the handler had nothing to say.
export { pageParams, MAX_PAGE, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from "@/core/lib/page-params";
export type { PageParams, PageParamsOptions } from "@/core/lib/page-params";

// --- Caching (Redis with in-memory fallback) ---
export { cached, invalidate } from "@/core/lib/cache";

// --- At-rest secret encryption for module config ---
export { encryptSecret, decryptSecret } from "@/core/lib/secret-storage";

/**
 * Reading the site settings store.
 *
 * A module declares its credentials in `secretSettings` and reads them
 * through here. Pulling the row directly returns the ciphertext, which
 * authenticates against nothing and looks exactly like a mistyped key.
 */
export { readSettingValues, readSettingStrings } from "@/core/lib/setting-values";

/**
 * For a module that keeps its whole configuration under one settings key and
 * writes it through its own endpoint: seal declared credentials on the way in,
 * and take them back out of anything headed for a browser.
 */
export { settingsForStorage, withoutSecrets } from "@/core/lib/secret-settings";

// --- Audit trail ---
export { logActivity } from "@/core/lib/activity-log";
/**
 * The site's own clock. "Opens Friday at 18:00" is not a moment until
 * somebody says whose clock, and the only answer that makes a limited run
 * start at the same instant for everybody is the operator's.
 */
export { siteTimeZone } from "@/core/lib/site-time-setting";

// --- Content revisions ---
export { recordRevision } from "@/core/lib/revisions";

// --- Uploads ---
export { sanitizeFilename } from "@/core/lib/storage";
export type { StorageProvider, UploadResult } from "@/core/lib/storage";

/**
 * The backups core has taken, and where each one is on disk.
 *
 * For a module that keeps a copy somewhere else. Core takes the dump and
 * knows nothing about any destination; a module has the credentials and the
 * vendor, and needs exactly these two things to do its half.
 */
export { listBackups, getBackupPath } from "@/core/lib/backup";
export type { BackupMeta } from "@/core/lib/backup";

/**
 * Asking, on the server, whether the challenge in front of a form was
 * answered - and pulling the answer out of a body whose shape the route does
 * not own.
 *
 * A route calls this before it writes anything. With no challenge module
 * installed there are no listeners and it passes, so a module that asks
 * behaves exactly as it did on an install that never wanted one.
 */
/**
 * Saying that a webhook went out. For a module that sends one of its own:
 * whatever keeps the log writes the row, and the address is cut to its origin
 * on the way - a webhook URL is a credential and a log outlives it.
 */
export { recordWebhookDelivery, redactWebhookTarget } from "@/core/lib/webhook-log";
export type { WebhookDelivery } from "@/core/lib/webhook-log";

export { runChallenge } from "@/core/lib/auth-challenge";
/**
 * Every form on this site that can ask whether a human is filling it in,
 * core's own three beside whatever the enabled modules declared. For a
 * challenge module's own settings screen, which has one question to answer -
 * is it switched on here? - and no reason to know which of them core owns.
 */
export { challengePoints } from "@/core/lib/challenge-points";
export type { ChallengePoint } from "@/core/lib/challenge-points";
export { challengeFieldsFrom, CHALLENGE_FIELD } from "@/core/lib/auth-challenge-shared";
export type { AuthChallengeResult as ChallengeResult } from "@/core/lib/auth-challenge-shared";

// --- TOTP / backup codes ---
export {
    generateSecret,
    generateQRCode,
    verifyToken,
    generateBackupCodes,
    countRemainingBackupCodes,
} from "@/core/lib/two-factor";

// --- API response envelope ---
export { apiSuccess, apiError, apiPaginated, devOnlyDetail, withRateLimit } from "@/core/lib/api-utils";

// --- Charts ---
// A per-day count the database computes. Five stats screens read every row in
// the window and bucketed it in JavaScript, so the work grew with the site's
// history to produce at most 366 numbers.
export { dailySeries, dayLabels } from "@/core/lib/daily-series";
export type { DailySeriesOptions, DailySeriesRow } from "@/core/lib/daily-series";

// --- Request bodies ---
// `readJsonBody` returns the parsed body, or the 400 to return when the body
// is not JSON. A route that calls `request.json()` directly answers a
// malformed body with a 500.
export { readJsonBody, INVALID_JSON_BODY, BODY_TOO_LARGE, MAX_JSON_BODY_BYTES } from "@/core/lib/api-body";

// `intParam` and `enumParam` are the query-string half of the same idea: a
// page number that cannot be NaN, and an enum filter that answers 400 instead
// of handing Prisma a value its enum does not have.
export { intParam, enumParam, INVALID_QUERY_PARAM } from "@/core/lib/api-query";

// --- Transactional email ---
export { sendEmail, queueEmail } from "@/core/lib/email";

// --- Structured data ---
export { buildArticleJsonLd } from "@/core/lib/seo";

// Every public page this site serves, with the title and description it shows
// when nobody has overridden them. A module that manages search engine
// metadata cannot enumerate the pages itself - most of them belong to other
// modules - and a screen that starts empty asks an operator to already know
// that `/store/product/[...params]` exists before they can describe it.
export { listCataloguePages, type CataloguePage } from "@/core/lib/page-catalogue";

// Structured logging. A module's cron jobs and hook listeners run outside any
// request, and `log` handles that - it reads the correlation id from
// AsyncLocalStorage when there is one and falls back cleanly when there is not.
// Server-only because logger.ts imports next/headers.
export { log } from "@/core/lib/logger";

// Canonical public URL of this installation, resolved at runtime. A module
// that has to hand an external service an absolute callback URL needs this
// rather than a NEXT_PUBLIC_* var, which `next build` freezes into the
// prebuilt image for every installation on earth.
export { resolveAppUrl, resolveAppName } from "@/core/lib/app-url";

/**
 * The currency the payment gateways charge in, and a formatter for it. The
 * client half is `useSiteCurrency` in `@/core/sdk/ui`; a server component
 * cannot call a hook, so it awaits these instead.
 */
export { siteCurrency, formatSiteCurrency } from "@/core/lib/site-currency";

// Whether a member is kept out of a part of the site. The scope is the asking
// module's own word; see @/core/sdk for the decision behind it.
export { isRestrictedFrom, restrictionsOn } from "@/core/lib/restrictions-server";

// A module's own words on the server, outside a page. `getTranslations` needs
// a route segment to find a locale in and an API route has none.
export { moduleTranslator } from "@/core/lib/module-translator";
