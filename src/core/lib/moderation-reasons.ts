/**
 * The reasons a rejection can give, as a reader of one language sees them.
 *
 * A rejection used to say nothing: the row went to `REJECTED`, the author
 * never heard, and nobody could later tell why. Now a moderator picks one of
 * these, the decision keeps it, and the Rejected view and the author's own
 * page both say it.
 *
 * Five ship with core, as rows with a `key`, and their wording is the
 * catalogue's until the admin types their own. They are put in place here,
 * when the list is read, rather than by a migration: a fresh install pushes
 * its schema and never runs the SQL migrations, so a row a migration inserted
 * would exist on every upgraded site and on no new one. That is also why a
 * shipped reason can be disabled and never deleted: it would only come back.
 */
import { getTranslations } from "next-intl/server";
import { prisma } from "@/core/lib/db";
import { readContentTranslations, type ContentKind } from "@/core/lib/content-translations";

export const MODERATION_REASON_TEXT: ContentKind = { owner: "core", entity: "moderation-reason" };

/** The longest name a reason may have, in any language. */
export const REASON_LABEL_MAX = 80;

const SHIPPED_REASON_KEYS = ["spam", "abuse", "advertising", "offTopic", "other"] as const;

export interface ModerationReasonView {
    id: string;
    key: string | null;
    label: string;
    enabled: boolean;
    position: number;
}

interface ReasonRow {
    id: string;
    key: string | null;
    label: string | null;
    enabled: boolean;
    position: number;
}

const SELECT = { id: true, key: true, label: true, enabled: true, position: true } as const;

async function readRows(includeDisabled: boolean): Promise<ReasonRow[]> {
    return prisma.moderationReason.findMany({
        where: includeDisabled ? undefined : { enabled: true },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: SELECT,
    });
}

/** Put back any shipped reason the table does not hold; touches nothing else. */
async function ensureShipped(rows: ReasonRow[]): Promise<boolean> {
    const held = new Set(rows.map((row) => row.key));
    const missing = SHIPPED_REASON_KEYS.filter((key) => !held.has(key));
    if (missing.length === 0) return false;
    await prisma.moderationReason.createMany({
        data: missing.map((key) => ({
            id: `reason_${key}`,
            key,
            position: SHIPPED_REASON_KEYS.indexOf(key),
        })),
        skipDuplicates: true,
    });
    return true;
}

/**
 * Each row's wording for `locale`: its translation, else what the admin
 * typed, else the catalogue's for a shipped reason.
 */
async function worded(rows: ReasonRow[], locale: string): Promise<ModerationReasonView[]> {
    const translations = await readContentTranslations(prisma, MODERATION_REASON_TEXT, rows.map((row) => row.id));
    const t = await getTranslations({ locale, namespace: "admin" });
    return rows.map((row) => {
        const translated = translations.get(row.id)?.label?.[locale]?.trim();
        const own = row.label?.trim();
        const label = translated || own || (row.key ? t(`moderationReason_${row.key}` as never) : row.id);
        return { id: row.id, key: row.key, label, enabled: row.enabled, position: row.position };
    });
}

export async function listReasons(
    locale: string,
    opts: { includeDisabled?: boolean } = {},
): Promise<ModerationReasonView[]> {
    const includeDisabled = opts.includeDisabled === true;
    // Only the full list can say whether a shipped reason is missing: a
    // disabled one is still there.
    let all = await readRows(true);
    if (await ensureShipped(all)) all = await readRows(true);
    const rows = includeDisabled ? all : all.filter((row) => row.enabled);
    return worded(rows, locale);
}

/**
 * One reason's wording, whether or not it is still offered: a decision
 * made with a reason the admin later disabled still has to say what it was.
 */
export async function reasonLabel(reasonId: string, locale: string): Promise<string | null> {
    const row = await prisma.moderationReason.findUnique({ where: { id: reasonId }, select: SELECT });
    if (!row) return null;
    const [view] = await worded([row], locale);
    return view.label;
}
