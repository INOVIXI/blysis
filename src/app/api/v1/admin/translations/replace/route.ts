import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logActivity } from "@/core/lib/activity-log";
import { readJsonBody } from "@/core/lib/api-body";
import { apiError, apiSuccess } from "@/core/lib/api-utils";
import { auth } from "@/core/lib/auth";
import { prisma } from "@/core/lib/db";
import { locales } from "@/core/lib/i18n/config";
import { flagCalls } from "@/core/lib/i18n/translation-flags";
import { historyCall } from "@/core/lib/i18n/translation-history";
import { type LineRef, editCalls, editOps, heardBy, lineOf, lineRows } from "@/core/lib/i18n/translation-lines";
import { activeThemeId, invalidateTranslationCache } from "@/core/lib/i18n/translation-service";
import { checkMessageEdit } from "@/core/lib/message-edit";
import { isAdmin } from "@/core/lib/permissions";

/**
 * One word replaced in every string the site says it in, one language at a
 * time.
 *
 * Without `apply` this only answers what would change: each string as the
 * site says it now and as it would say it after, and the ones the replacement
 * would break, refused by the check a hand edit gets. With `apply` it writes
 * the strings the operator kept, working the text out again rather than
 * taking it from the browser, so what is written is what the site says at the
 * moment of writing. A string a theme words over is matched on what the
 * visitor reads, not on the row beneath it.
 *
 * Case is kept as typed: "Mağaza" and "mağaza" are two words to an operator
 * who wants one changed and the other left, and the preview shows both runs.
 */

/** More than an operator reads in one preview; a word this common wants a narrower one. */
const MAX_MATCHES = 300;

const replaceSchema = z.object({
    find: z.string().min(1).max(200),
    replace: z.string().max(200),
    locale: z.enum(locales),
    apply: z.array(z.object({ namespace: z.string().min(1).max(120), key: z.string().min(1).max(300) })).max(MAX_MATCHES).optional(),
});

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return apiError("Unauthorized", 401);
    if (!(await isAdmin(session.user.id, session.user.role))) return apiError("Forbidden", 403);

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = replaceSchema.safeParse(body);
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message || "Invalid input", 400);
    const { find, replace, locale, apply } = parsed.data;

    const themeId = await activeThemeId();
    const candidates = await prisma.translation.findMany({
        where: { AND: [heardBy(themeId), { locale, value: { contains: find } }] },
        select: { namespace: true, key: true },
        distinct: ["namespace", "key"],
        orderBy: [{ namespace: "asc" }, { key: "asc" }],
        take: MAX_MATCHES + 1,
    });
    const refs = [...new Map(candidates.map((c) => [`${c.namespace}\u0000${c.key}`, { namespace: c.namespace, key: c.key }])).values()]
        .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.key.localeCompare(b.key));
    const truncated = refs.length > MAX_MATCHES;
    const seen = refs.slice(0, MAX_MATCHES);
    // Every language of each string, since a change in this one asks the
    // others to follow it.
    const rows = await lineRows(seen, themeId);

    const matches = seen.flatMap((ref) => {
        const line = lineOf(ref, rows, [locale]);
        const said = line.locales[locale];
        // A row beneath the theme's wording says the word; the site does not.
        if (!said?.value?.includes(find)) return [];
        const after = said.value.split(find).join(replace);
        const refusal = checkMessageEdit(said.shipped ?? said.value, after);
        return [{
            namespace: ref.namespace,
            key: ref.key,
            owner: line.owner,
            before: said.value,
            after,
            ...(refusal ? { refused: { reason: refusal.reason, names: refusal.names ?? [] } } : {}),
        }];
    });

    if (!apply) {
        return apiSuccess({
            matches: matches.map(({ owner: _owner, ...match }) => match),
            truncated,
        });
    }

    const kept = new Set(apply.map((ref: LineRef) => `${ref.namespace}\u0000${ref.key}`));
    const writing = matches.filter((m) => !m.refused && kept.has(`${m.namespace}\u0000${m.key}`));
    if (writing.length === 0) return apiError("Nothing to change", 400, { code: "translation_nothing_to_replace" });

    // Each string leaves a version and marks its other languages, as a hand
    // edit of it would.
    await prisma.$transaction(writing.flatMap((m) => {
        const line = lineOf(m, rows, locales);
        return [
            historyCall(m, line, [locale], "replace", session.user.id),
            ...editCalls(m, editOps(m, m.owner, rows, locale, m.after.trim())),
            ...flagCalls(m, line, [locale], [{ locale, toShipped: false }]),
        ];
    }));
    await invalidateTranslationCache();

    logActivity({
        userId: session.user.id,
        action: "translation.replace",
        entity: "translation",
        entityId: locale,
        // The words stay out of the log, as a hand edit's do.
        metadata: { locale, strings: writing.map((m) => `${m.namespace}.${m.key}`) },
    }).catch(() => {});

    return apiSuccess({ changed: writing.length });
}
