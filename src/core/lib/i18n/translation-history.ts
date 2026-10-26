/**
 * The versions a string has been, and putting one back.
 *
 * The editor kept only what a string says now, so an operator who reworded
 * the shop, restored a string or replaced a word across the site had no way
 * back but to remember the old words. Every change now writes a `Revision`
 * in the same transaction, holding what each language it touched said
 * before, and putting one back is a change like any other, recorded the
 * same way. `a-site-s-words-can-be-taken-back` holds it.
 */
import { z } from "zod";
import { prisma } from "@/core/lib/db";
import { checkMessageEdit } from "@/core/lib/message-edit";
import type { FlagChange } from "./translation-flags";
import { type EditOp, type Line, type LineRef, type LineRow, editOps, measureOf, restoreOps } from "./translation-lines";

/** What the `Revision` table files a string's versions under. */
export const HISTORY_RESOURCE = "translation";

const HISTORY_CAUSES = ["edit", "restore", "replace", "undo"] as const;
export type HistoryCause = (typeof HISTORY_CAUSES)[number];

const snapshotSchema = z.object({
    cause: z.enum(HISTORY_CAUSES),
    locales: z.record(z.string(), z.object({ value: z.string().nullable(), isCustom: z.boolean() })),
});
export type HistorySnapshot = z.infer<typeof snapshotSchema>;

/** One string's versions are filed under its name, as its activity rows are. */
export function historyId(ref: LineRef): string {
    return `${ref.namespace}:${ref.key}`;
}

/** The version a change leaves behind: what each language it touches said before it. */
export function historyCall(ref: LineRef, line: Line, locales: string[], cause: HistoryCause, authorId: string | undefined) {
    const before = Object.fromEntries(locales.map((locale) => [locale, {
        value: line.locales[locale]?.value ?? null,
        isCustom: line.locales[locale]?.isCustom ?? false,
    }]));
    return prisma.revision.create({
        data: {
            resource: HISTORY_RESOURCE,
            resourceId: historyId(ref),
            action: "update",
            authorId,
            data: { cause, locales: before },
        },
    });
}

/** A stored version, or null for one this code did not write. */
export function parseSnapshot(data: unknown): HistorySnapshot | null {
    const parsed = snapshotSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
}

export type UndoPlan =
    | { ops: EditOp[]; changes: FlagChange[] }
    | { refusal: { code: string; locale: string; names: string[] } };

/**
 * The writes that make a string say again what a version says it said.
 *
 * Words the site had written go back as an edit, checked as a hand edit is,
 * since an update may have changed the values the calling code passes since.
 * Words that shipped go back as a restore, and a language that said nothing
 * loses what the site wrote into it.
 */
export function undoOps(ref: LineRef, line: Line, rows: LineRow[], snapshot: HistorySnapshot, sourceLocale: string): UndoPlan {
    const ops: EditOp[] = [];
    const changes: FlagChange[] = [];
    for (const [locale, before] of Object.entries(snapshot.locales)) {
        if (!(locale in line.locales)) continue;
        if (before.value === null) {
            for (const row of rows) {
                if (row.locale === locale && row.isCustom && row.namespace === ref.namespace && row.key === ref.key) {
                    ops.push({ drop: { id: row.id } });
                }
            }
        } else if (before.isCustom) {
            const refusal = checkMessageEdit(measureOf(line, locale, sourceLocale), before.value);
            if (refusal) return { refusal: { code: `translation_${refusal.reason}`, locale, names: refusal.names ?? [] } };
            ops.push(...editOps(ref, line.owner, rows, locale, before.value));
        } else {
            const restore = restoreOps(ref, rows, locale);
            if (restore === null) return { refusal: { code: "translation_no_shipped_value", locale, names: [] } };
            ops.push(...restore);
        }
        if (line.locales[locale]?.value !== before.value) changes.push({ locale, toShipped: !before.isCustom });
    }
    return { ops, changes };
}
