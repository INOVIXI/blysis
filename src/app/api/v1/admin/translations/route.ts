import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { logActivity } from "@/core/lib/activity-log";
import { readJsonBody } from "@/core/lib/api-body";
import { apiError, apiSuccess } from "@/core/lib/api-utils";
import { auth } from "@/core/lib/auth";
import { prisma } from "@/core/lib/db";
import { defaultLocale, locales } from "@/core/lib/i18n/config";
import { FLAG_REVIEW, FLAG_TRANSLATE } from "@/core/lib/i18n/flag-reasons";
import { flagCalls } from "@/core/lib/i18n/translation-flags";
import { historyCall } from "@/core/lib/i18n/translation-history";
import {
    type EditOp,
    type LineRef,
    editCalls,
    editOps,
    heardSql,
    lineFlags,
    lineOf,
    lineRows,
    measureOf,
    restoreOps,
} from "@/core/lib/i18n/translation-lines";
import { activeThemeId, invalidateTranslationCache } from "@/core/lib/i18n/translation-service";
import { MAX_MESSAGE_LENGTH, checkMessageEdit } from "@/core/lib/message-edit";
import { isAdmin } from "@/core/lib/permissions";
import { placeholderNames } from "@/core/lib/placeholders";
import { prismaErrorOrThrow } from "@/core/lib/prisma-errors";

/**
 * The strings the site renders, and an operator's edits to them.
 *
 * A string is one line across every source and every locale. The store ships
 * `store.title`, the theme being worn may reword it, and the site may edit
 * it; the operator sees what a visitor reads and who says it, not one line
 * per row. Every locale of an edit is checked before any is written, so an
 * operator who fixes the English and leaves the Turkish is not refused for
 * the Turkish, and one who breaks the Turkish writes neither.
 *
 * An edit is measured against what the site would say without it, not
 * against the row it replaces, so editing a string twice cannot walk it away
 * from the values the calling code passes. Reverting puts the shipped string
 * back for the same reason, and refuses when nothing ships it: a string with
 * no origin cannot be restored to one, and dropping the row instead would
 * take the string off the site while reading to an operator as a restore.
 *
 * Core names no module here. Sources arrive as data, out of a column.
 */

const PAGE_SIZE = 50;

async function requireAdmin() {
    const session = await auth();
    if (!session?.user?.id) return { error: apiError("Unauthorized", 401) };
    if (!(await isAdmin(session.user.id, session.user.role))) return { error: apiError("Forbidden", 403) };
    return { session };
}

/**
 * What everything else is translated from.
 *
 * `defaultLocale` is the language a visitor gets when they have asked for
 * none, and it is also the one the software is written in, so it is the one
 * to show beside whatever is being worked on.
 */
const SOURCE_LOCALE = defaultLocale;

/** The lines for these strings, in the order asked. */
async function describe(refs: LineRef[], wanted: readonly string[], themeId: string) {
    const [rows, flags] = await Promise.all([lineRows(refs, themeId, wanted), lineFlags(refs, wanted)]);
    return refs.map((ref) => lineOf(ref, rows, wanted, flags));
}

/** Whether this language of the string has been asked to be looked at, for a `HAVING`. */
function askedSql(locale: string, reason: string): Prisma.Sql {
    return Prisma.sql`bool_or(EXISTS (
        SELECT 1 FROM "TranslationFlag" AS f
        WHERE f."namespace" = "Translation"."namespace" AND f."key" = "Translation"."key"
            AND f."locale" = ${locale} AND f."reason" = ${reason}
    ))`;
}

const listSchema = z.object({
    /** Only strings this source has a row for: `core`, a module, or the worn theme. */
    module: z.string().max(64).optional(),
    namespace: z.string().max(120).optional(),
    q: z.string().max(200).optional(),
    custom: z.enum(["1"]).optional(),
    /**
     * The language being worked in. The screen used to send every locale's
     * text for every key, which is fine for the two this site ships and is a
     * thousand boxes on a page at twenty.
     *
     * `z.enum(locales)` rather than a string: this reaches a query, and a
     * locale nobody serves would otherwise be reported as a language with
     * every string missing.
     */
    locale: z.enum(locales).optional(),
    /** Only the strings this language has nothing for. */
    missing: z.enum(["1"]).optional(),
    /** Only the strings an update changed under the site's edit, in this language. */
    review: z.enum(["1"]).optional(),
    /** Only the strings that changed in another language after this one was written. */
    awaiting: z.enum(["1"]).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
});

export async function GET(request: NextRequest) {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;

    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = listSchema.safeParse(params);
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message || "Invalid filter", 400);
    const { module: source, namespace, q, custom, page, missing, review, awaiting } = parsed.data;
    // The source is what the software ships and what everything else is
    // translated from; the target is what the operator is working in. Asking
    // for the source as the target is asking for one column twice.
    const target = request.nextUrl.searchParams.get("locale");
    const wanted = listSchema.shape.locale.safeParse(target).success
        ? [SOURCE_LOCALE, target as (typeof locales)[number]].filter((l, i, a) => a.indexOf(l) === i)
        : [...locales];
    const themeId = await activeThemeId();

    // A line is a string, whoever has a row for it, so each filter asks
    // whether any row the site hears for it qualifies. Only the worn theme's
    // rows count: another theme's wording is nothing a visitor reads.
    const heard = heardSql(themeId);
    const rowFilter = namespace ? Prisma.sql`${heard} AND "namespace" = ${namespace}` : heard;
    const having: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (source) having.push(Prisma.sql`bool_or("module" = ${source})`);
    if (custom === "1") having.push(Prisma.sql`bool_or("isCustom")`);
    if (q) {
        // What the string says in any language, or its name, `store.title`.
        const like = `%${q}%`;
        having.push(Prisma.sql`bool_or("value" ILIKE ${like} OR ("namespace" || '.' || "key") ILIKE ${like})`);
    }
    if (missing === "1" && wanted.length === 2) having.push(Prisma.sql`NOT bool_or("locale" = ${wanted[1]})`);
    if (review === "1" && wanted.length === 2) having.push(askedSql(wanted[1], FLAG_REVIEW));
    if (awaiting === "1" && wanted.length === 2) having.push(askedSql(wanted[1], FLAG_TRANSLATE));
    const groups = Prisma.sql`
        SELECT "namespace", "key" FROM "Translation" WHERE ${rowFilter}
        GROUP BY "namespace", "key" HAVING ${Prisma.join(having, " AND ")}
    `;

    // The page and the count are two questions about one filter, so the
    // filter is written once. Two hand-kept copies of the same clause is how
    // a list ends up showing a page of rows a count says are not there.
    const [counted, refs] = await Promise.all([
        prisma.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS total FROM (${groups}) AS lines`,
        prisma.$queryRaw<LineRef[]>`
            ${groups}
            ORDER BY "namespace", "key"
            LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
        `,
    ]);

    const total = counted[0]?.total ?? 0;
    const items = await describe(refs, wanted, themeId);
    return apiSuccess({ items, page, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
}

const lineSchema = z.object({
    namespace: z.string().min(1).max(120),
    key: z.string().min(1).max(300),
});

const editSchema = lineSchema.extend({
    /**
     * Partial, and deliberately: correcting one word of English must not
     * require retyping the Turkish. `z.record` over an enum is exhaustive in
     * Zod 4, which made a one-locale save fail on the locale it did not
     * carry - and, worse, hid every refusal this endpoint exists to make
     * behind a schema error with no code for the screen to read.
     *
     * The length allows one character past the limit, so an over-long string
     * is refused by name rather than by schema. Only the first is a message
     * an operator can act on.
     */
    values: z.partialRecord(z.enum(locales), z.string().max(MAX_MESSAGE_LENGTH + 1)),
});

export async function PATCH(request: NextRequest) {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = editSchema.safeParse(body);
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message || "Invalid input", 400);
    const { namespace, key, values } = parsed.data;
    const ref = { namespace, key };

    const themeId = await activeThemeId();
    const [rows, sitePlaceholders] = await Promise.all([lineRows([ref], themeId), placeholderNames()]);
    // A string nothing has a row for is no string of this site's; writing
    // one would invent a key no page asks for.
    if (rows.length === 0) return apiError("No such string", 404, { code: "translation_not_found" });
    const line = lineOf(ref, rows, locales);

    // Every locale is judged before any of them is written, so a refusal in
    // one does not leave the site half edited.
    const writes: { locale: string; value: string }[] = [];
    for (const [locale, typed] of Object.entries(values)) {
        if (typeof typed !== "string") continue;
        // What the site says without the edit is the yardstick. Falling back
        // to what it says now keeps a string editable after its origin is
        // gone - an uninstalled module, a key dropped in an upgrade - and a
        // language nothing ships yet is measured against the one everything
        // is translated from, so a first translation may use its values.
        const refusal = checkMessageEdit(measureOf(line, locale, SOURCE_LOCALE), typed, sitePlaceholders);
        if (refusal) {
            return apiError("The string was not saved", 400, {
                code: `translation_${refusal.reason}`,
                details: { locale, names: refusal.names ?? [] },
            });
        }
        writes.push({ locale, value: typed.trim() });
    }
    if (writes.length === 0) return apiError("Nothing to save", 400);

    // One transaction, so a site is never left saying the new thing in one
    // language and the old thing in the other, and never changed without the
    // version that takes it back or the languages it leaves behind marked.
    const changed = writes.filter((w) => w.value !== line.locales[w.locale]?.value).map((w) => w.locale);
    await prisma.$transaction([
        ...(changed.length > 0 ? [historyCall(ref, line, changed, "edit", guard.session?.user?.id)] : []),
        ...writes.flatMap((w) => editCalls(ref, editOps(ref, line.owner, rows, w.locale, w.value))),
        ...flagCalls(ref, line, writes.map((w) => w.locale), changed.map((locale) => ({ locale, toShipped: false }))),
    ]);
    await invalidateTranslationCache();

    logActivity({
        userId: guard.session?.user?.id,
        action: "translation.edit",
        entity: "translation",
        entityId: `${line.owner}:${namespace}:${key}`,
        // The strings themselves stay out of the log. An activity row is read
        // in more places than the editor is, and a message can carry anything
        // an operator typed into it.
        metadata: { module: line.owner, namespace, key, locales: writes.map((w) => w.locale) },
    }).catch(() => {});

    const [item] = await describe([ref], locales, themeId);
    return apiSuccess({ item });
}

const revertSchema = lineSchema.extend({
    locale: z.enum(locales).optional(),
});

export async function DELETE(request: NextRequest) {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = revertSchema.safeParse(body);
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message || "Invalid input", 400);
    const { namespace, key, locale } = parsed.data;

    // Every edit the site hears for the string, on whichever source the
    // editor filed it, since an older one may sit on the theme's row.
    const ref = { namespace, key };
    const themeId = await activeThemeId();
    const rows = await lineRows([ref], themeId);
    const edited = [...new Set(rows
        .filter((row) => row.isCustom && (locale ? row.locale === locale : (locales as readonly string[]).includes(row.locale)))
        .map((row) => row.locale))];
    if (edited.length === 0) return apiError("Nothing to restore", 404, { code: "translation_not_custom" });
    const line = lineOf(ref, rows, locales);

    const ops: EditOp[] = [];
    for (const each of edited) {
        const restore = restoreOps(ref, rows, each);
        if (restore === null) {
            return apiError("This string has nothing to restore to", 409, {
                code: "translation_no_shipped_value",
                details: { locale: each },
            });
        }
        ops.push(...restore);
    }

    try {
        await prisma.$transaction([
            historyCall(ref, line, edited, "restore", guard.session?.user?.id),
            ...editCalls(ref, ops),
            ...flagCalls(ref, line, edited, edited.map((each) => ({ locale: each, toShipped: true }))),
        ]);
    } catch (error) {
        // The rows were read a moment ago, so the one thing that gets here is
        // a second admin having reverted or reinstalled in between.
        return prismaErrorOrThrow(error);
    }
    await invalidateTranslationCache();

    logActivity({
        userId: guard.session?.user?.id,
        action: "translation.revert",
        entity: "translation",
        entityId: `${namespace}:${key}`,
        metadata: { namespace, key, locales: edited },
    }).catch(() => {});

    const [item] = await describe([{ namespace, key }], locales, themeId);
    return apiSuccess({ item });
}
