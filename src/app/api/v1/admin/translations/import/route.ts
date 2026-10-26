import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logActivity } from "@/core/lib/activity-log";
import { readJsonBody } from "@/core/lib/api-body";
import { apiError, apiSuccess } from "@/core/lib/api-utils";
import { auth } from "@/core/lib/auth";
import { prisma } from "@/core/lib/db";
import { defaultLocale, locales } from "@/core/lib/i18n/config";
import { flagCalls } from "@/core/lib/i18n/translation-flags";
import { historyCall } from "@/core/lib/i18n/translation-history";
import { type LineRef, type LineRow, editCalls, editOps, lineOf, lineRows, measureOf } from "@/core/lib/i18n/translation-lines";
import { activeThemeId, invalidateTranslationCache } from "@/core/lib/i18n/translation-service";
import { MAX_FILE_STRINGS, wordsFileSchema } from "@/core/lib/i18n/words-file";
import { checkMessageEdit } from "@/core/lib/message-edit";
import { isAdmin } from "@/core/lib/permissions";

/**
 * A file of the site's words, read back in.
 *
 * Without `apply` this only answers what the file would change: each string
 * as the site says it now and as the file says it, and the ones the check a
 * hand edit gets would refuse. A string the site does not have, an installed
 * module's that is not installed here, is counted and left alone, and so is
 * one the file says the same as the site does. With `apply` it writes the
 * strings the operator kept, worked out again from the file rather than
 * taken from the preview, and each is an ordinary edit: a version to take it
 * back, and the other languages asked to follow.
 */

const nameSchema = z.object({
    namespace: z.string().min(1).max(120),
    key: z.string().min(1).max(300),
    locale: z.enum(locales),
});

const importSchema = z.object({
    file: z.unknown(),
    apply: z.array(nameSchema).max(MAX_FILE_STRINGS).optional(),
});

const refName = (ref: LineRef) => `${ref.namespace}\u0000${ref.key}`;

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return apiError("Unauthorized", 401);
    if (!(await isAdmin(session.user.id, session.user.role))) return apiError("Forbidden", 403);

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = importSchema.safeParse(body);
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message || "Invalid input", 400);
    const words = wordsFileSchema.safeParse(parsed.data.file);
    if (!words.success) {
        return apiError("This is not a file of the site's words", 400, { code: "translation_file_invalid" });
    }

    // One entry per string and language; a file that names one twice means
    // the later of the two, as it would read top to bottom.
    const entries = [...new Map(words.data.strings.map((e) => [`${e.namespace}\u0000${e.key}\u0000${e.locale}`, e])).values()];
    const refs = [...new Map(entries.map((e) => [refName(e), { namespace: e.namespace, key: e.key }])).values()];
    const themeId = await activeThemeId();
    const rows = await lineRows(refs, themeId);
    const byRef = new Map<string, LineRow[]>();
    for (const row of rows) byRef.set(refName(row), [...(byRef.get(refName(row)) ?? []), row]);

    let unknown = 0;
    let same = 0;
    const changes = entries.flatMap((entry) => {
        const own = byRef.get(refName(entry));
        if (!own) {
            unknown += 1;
            return [];
        }
        const line = lineOf(entry, own, locales);
        const before = line.locales[entry.locale]?.value ?? null;
        const after = entry.value.trim();
        if (before === after) {
            same += 1;
            return [];
        }
        const refusal = checkMessageEdit(measureOf(line, entry.locale, defaultLocale), entry.value);
        return [{
            namespace: entry.namespace,
            key: entry.key,
            locale: entry.locale,
            before,
            after,
            ...(refusal ? { refused: { reason: refusal.reason, names: refusal.names ?? [] } } : {}),
        }];
    });

    if (!parsed.data.apply) return apiSuccess({ changes, unknown, same });

    const kept = new Set(parsed.data.apply.map((n) => `${n.namespace}\u0000${n.key}\u0000${n.locale}`));
    const writing = changes.filter((c) => !c.refused && kept.has(`${c.namespace}\u0000${c.key}\u0000${c.locale}`));
    if (writing.length === 0) return apiError("Nothing to change", 400, { code: "translation_nothing_to_import" });

    const byString = new Map<string, typeof writing>();
    for (const change of writing) byString.set(refName(change), [...(byString.get(refName(change)) ?? []), change]);
    await prisma.$transaction([...byString.values()].flatMap((group) => {
        const ref = { namespace: group[0].namespace, key: group[0].key };
        const own = byRef.get(refName(ref)) ?? [];
        const line = lineOf(ref, own, locales);
        const changed = group.map((c) => c.locale);
        return [
            historyCall(ref, line, changed, "import", session.user.id),
            ...group.flatMap((c) => editCalls(ref, editOps(ref, line.owner, own, c.locale, c.after))),
            ...flagCalls(ref, line, changed, changed.map((locale) => ({ locale, toShipped: false }))),
        ];
    }));
    await invalidateTranslationCache();

    logActivity({
        userId: session.user.id,
        action: "translation.import",
        entity: "translation",
        entityId: "import",
        // The words stay out of the log, as a hand edit's do.
        metadata: { strings: writing.map((c) => `${c.namespace}.${c.key}:${c.locale}`) },
    }).catch(() => {});

    return apiSuccess({ changed: writing.length });
}
