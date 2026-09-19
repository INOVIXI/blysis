import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { logActivity } from "@/core/lib/activity-log";
import { readJsonBody } from "@/core/lib/api-body";
import { apiError, apiSuccess } from "@/core/lib/api-utils";
import { auth } from "@/core/lib/auth";
import { prisma } from "@/core/lib/db";
import { defaultLocale, locales } from "@/core/lib/i18n/config";
import { shippedValue } from "@/core/lib/i18n/shipped-value";
import { invalidateTranslationCache } from "@/core/lib/i18n/translation-service";
import { MAX_MESSAGE_LENGTH, checkMessageEdit } from "@/core/lib/message-edit";
import { isAdmin } from "@/core/lib/permissions";
import { prismaErrorOrThrow } from "@/core/lib/prisma-errors";

/**
 * The strings the site renders, and an operator's edits to them.
 *
 * A key is one thing across every locale, so this answers in keys rather than
 * in rows: an operator who fixes the English and leaves the Turkish is how a
 * site ends up half translated. Both sit on the same line, and both are
 * checked before either is written.
 *
 * An edit is measured against what the software ships, not against the row it
 * replaces, so editing a string twice cannot walk it away from the values the
 * calling code passes. Reverting puts the shipped string back for the same
 * reason, and refuses when nothing ships it: a string with no origin cannot
 * be restored to one, and dropping the row instead would take the string off
 * the site while reading to an operator as a restore.
 *
 * Core names no module here. Module ids arrive as data, out of a column.
 */

const PAGE_SIZE = 50;

async function requireAdmin() {
    const session = await auth();
    if (!session?.user?.id) return { error: apiError("Unauthorized", 401) };
    if (!(await isAdmin(session.user.id, session.user.role))) return { error: apiError("Forbidden", 403) };
    return { session };
}

interface KeyRef {
    module: string;
    namespace: string;
    key: string;
}

function refOf(ref: KeyRef, locale: string): string {
    return [ref.module, ref.namespace, ref.key, locale].join(" ");
}

/** One line of the editor: a key, and what every locale says for it. */
/**
 * What everything else is translated from.
 *
 * `defaultLocale` is the language a visitor gets when they have asked for
 * none, and it is also the one the software is written in, so it is the one
 * to show beside whatever is being worked on.
 */
const SOURCE_LOCALE = defaultLocale;

async function describe(refs: KeyRef[], wanted: readonly string[]) {
    if (refs.length === 0) return [];

    const rows = await prisma.translation.findMany({
        where: { OR: refs.map((r) => ({ module: r.module, namespace: r.namespace, key: r.key })) },
        select: { locale: true, module: true, namespace: true, key: true, value: true, isCustom: true },
    });
    const byRef = new Map(rows.map((row) => [refOf(row, row.locale), row]));

    return refs.map((ref) => ({
        module: ref.module,
        namespace: ref.namespace,
        key: ref.key,
        locales: Object.fromEntries(
            wanted.map((locale) => {
                const row = byRef.get(refOf(ref, locale));
                return [locale, {
                    value: row?.value ?? null,
                    isCustom: row?.isCustom ?? false,
                    shipped: shippedValue(ref.module, locale, ref.namespace, ref.key),
                }];
            }),
        ),
    }));
}

const listSchema = z.object({
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
    /** Only the keys this language has nothing for. */
    missing: z.enum(["1"]).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
});

export async function GET(request: NextRequest) {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;

    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = listSchema.safeParse(params);
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message || "Invalid filter", 400);
    const { module: moduleId, namespace, q, custom, page, missing } = parsed.data;
    // The source is what the software ships and what everything else is
    // translated from; the target is what the operator is working in. Asking
    // for the source as the target is asking for one column twice.
    const target = request.nextUrl.searchParams.get("locale");
    const wanted = listSchema.shape.locale.safeParse(target).success
        ? [SOURCE_LOCALE, target as (typeof locales)[number]].filter((l, i, a) => a.indexOf(l) === i)
        : [...locales];

    // The page and the count are two questions about one filter, so the
    // filter is written once. Two hand-kept copies of the same clause is how
    // a list ends up showing a page of rows a count says are not there.
    const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (moduleId) conditions.push(Prisma.sql`"module" = ${moduleId}`);
    if (namespace) conditions.push(Prisma.sql`"namespace" = ${namespace}`);
    if (custom === "1") conditions.push(Prisma.sql`"isCustom" = TRUE`);
    if (q) {
        const like = `%${q}%`;
        conditions.push(Prisma.sql`("key" ILIKE ${like} OR "value" ILIKE ${like})`);
    }
    if (missing === "1" && wanted.length === 2) {
        // Keys this language has no row for at all. `NOT EXISTS` rather than
        // a join, so a key with fifty locales is still one index probe.
        const locale = wanted[1];
        conditions.push(Prisma.sql`NOT EXISTS (
            SELECT 1 FROM "Translation" AS have
            WHERE have."module" = "Translation"."module"
              AND have."namespace" = "Translation"."namespace"
              AND have."key" = "Translation"."key"
              AND have."locale" = ${locale}
        )`);
    }
    const filter = Prisma.join(conditions, " AND ");

    // A key is one line whatever it says in each locale, so the page is a
    // page of keys. Prisma cannot count distinct across three columns, and
    // reading every group to measure its length is the unbounded read this
    // avoids.
    const [counted, refs] = await Promise.all([
        prisma.$queryRaw<{ total: number }[]>`
            SELECT COUNT(*)::int AS total
            FROM (SELECT DISTINCT "module", "namespace", "key" FROM "Translation" WHERE ${filter}) AS keys
        `,
        prisma.$queryRaw<KeyRef[]>`
            SELECT DISTINCT "module", "namespace", "key" FROM "Translation" WHERE ${filter}
            ORDER BY "module", "namespace", "key"
            LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
        `,
    ]);

    const total = counted[0]?.total ?? 0;
    const items = await describe(refs, wanted);
    return apiSuccess({ items, page, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
}

const keySchema = z.object({
    module: z.string().min(1).max(64),
    namespace: z.string().min(1).max(120),
    key: z.string().min(1).max(300),
});

const editSchema = keySchema.extend({
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
    const { module: moduleId, namespace, key, values } = parsed.data;

    const existing = await prisma.translation.findMany({
        where: { module: moduleId, namespace, key },
        select: { locale: true, value: true },
    });
    const before = new Map(existing.map((row) => [row.locale, row.value]));

    // Every locale is judged before any of them is written, so a refusal in
    // one does not leave the site half edited.
    const writes: { locale: string; value: string }[] = [];
    for (const [locale, typed] of Object.entries(values)) {
        if (typeof typed !== "string") continue;
        // What the software ships is the yardstick. Falling back to the row
        // keeps a string editable after its origin is gone - an uninstalled
        // module, a key dropped in an upgrade - instead of freezing it.
        const reference = shippedValue(moduleId, locale, namespace, key) ?? before.get(locale) ?? "";
        const refusal = checkMessageEdit(reference, typed);
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
    // language and the old thing in the other.
    await prisma.$transaction(
        writes.map((write) =>
            prisma.translation.upsert({
                where: {
                    locale_namespace_key_module: { locale: write.locale, namespace, key, module: moduleId },
                },
                update: { value: write.value, isCustom: true },
                create: { locale: write.locale, namespace, key, module: moduleId, value: write.value, isCustom: true },
            }),
        ),
    );
    await invalidateTranslationCache();

    logActivity({
        userId: guard.session?.user?.id,
        action: "translation.edit",
        entity: "translation",
        entityId: `${moduleId}:${namespace}:${key}`,
        // The strings themselves stay out of the log. An activity row is read
        // in more places than the editor is, and a message can carry anything
        // an operator typed into it.
        metadata: { module: moduleId, namespace, key, locales: writes.map((w) => w.locale) },
    }).catch(() => {});

    const [item] = await describe([{ module: moduleId, namespace, key }], locales);
    return apiSuccess({ item });
}

const revertSchema = keySchema.extend({
    locale: z.enum(locales).optional(),
});

export async function DELETE(request: NextRequest) {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = revertSchema.safeParse(body);
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message || "Invalid input", 400);
    const { module: moduleId, namespace, key, locale } = parsed.data;

    const wanted = locale ? [locale] : [...locales];
    const rows = await prisma.translation.findMany({
        where: { module: moduleId, namespace, key, locale: { in: wanted }, isCustom: true },
        select: { id: true, locale: true },
    });
    if (rows.length === 0) return apiError("Nothing to restore", 404, { code: "translation_not_custom" });

    const restores: { id: string; value: string }[] = [];
    for (const row of rows) {
        const shipped = shippedValue(moduleId, row.locale, namespace, key);
        if (shipped === null) {
            return apiError("This string has nothing to restore to", 409, {
                code: "translation_no_shipped_value",
                details: { locale: row.locale },
            });
        }
        restores.push({ id: row.id, value: shipped });
    }

    try {
        await prisma.$transaction(
            restores.map((restore) =>
                prisma.translation.update({
                    where: { id: restore.id },
                    data: { value: restore.value, isCustom: false },
                }),
            ),
        );
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
        entityId: `${moduleId}:${namespace}:${key}`,
        metadata: { module: moduleId, namespace, key, locales: rows.map((r) => r.locale) },
    }).catch(() => {});

    const [item] = await describe([{ module: moduleId, namespace, key }], locales);
    return apiSuccess({ item });
}
