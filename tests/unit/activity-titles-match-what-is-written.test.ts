import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { activityTypeLabel, localizeActivityTitle } from "@/core/lib/activity-title";

/**
 * A declared activity title has to describe a row that exists.
 *
 * The activity feed stores an English sentence per row, and a module localises
 * it by declaring `{ type, prefix, key }`: core strips `prefix` from the
 * stored title and puts `t(key)` in its place, keeping whatever follows. It is
 * the only translated thing on the page that is matched by string content
 * rather than resolved by identifier, so a declaration that is a little bit
 * wrong fails silently and looks like a missing translation.
 *
 * All five modules that used it got it wrong, and nothing said so.
 *
 * `blog` declared `blog.article.published` and writes `blog.article.created`;
 * `tickets` declared `tickets.ticket.created` and `tickets.reply.created` and
 * writes `tickets.ticket.opened` and `tickets.ticket.replied`. Three
 * translations, in both locales, that no row could ever match.
 *
 * `store` was worse. It declared the prefix `"Purchased: "` for rows written
 * as `Completed order #1412`, so `startsWith` failed - and the fallback
 * substituted the label anyway and returned it alone. Every completed order in
 * the feed rendered as a bare `purchased:`, in every locale, with the order
 * number dropped. Measured before the fix: `("store.order.completed",
 * "Completed order #1234")` returned `"satın aldı:"`.
 *
 * Only `forum` and `suggestions` were right.
 */

const ROOT = process.cwd();

interface ActivityTitle {
    type: string;
    /** What the kind is called. Every entry has one; see the gate that reads it. */
    nameKey: string;
    /** The title substitution, when the event's English allows one. */
    prefix?: string;
    key?: string;
}

function manifests(): { id: string; titles: ActivityTitle[]; translations: Record<string, Record<string, Record<string, string>>> }[] {
    const dir = path.join(ROOT, "module-sources");
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(dir, e.name, "module.json"))
        .filter((f) => fs.existsSync(f))
        .map((f) => JSON.parse(fs.readFileSync(f, "utf8")))
        .map((m) => ({
            id: m.id as string,
            titles: (m.activityTitles ?? []) as ActivityTitle[],
            translations: (m.translations ?? {}) as Record<string, Record<string, Record<string, string>>>,
        }));
}

/**
 * Every `type` written to the feed, with the literal head of the title written
 * with it. `title: \`Opened ticket: ${ticket.subject}\`` yields the literal
 * "Opened ticket: ", which is exactly what a `prefix` has to equal.
 */
function writtenTypes(): Map<string, { literalHead: string; where: string }> {
    const found = new Map<string, { literalHead: string; where: string }>();
    const walk = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === "node_modules") continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (!/\.tsx?$/.test(entry.name)) continue;
            const source = fs.readFileSync(full, "utf8");
            for (const call of source.matchAll(/activityFeedItem\.create\(/g)) {
                const chunk = source.slice(call.index ?? 0, (call.index ?? 0) + 800);
                const type = /type:\s*"([^"]+)"/.exec(chunk);
                if (!type) continue;
                found.set(type[1], {
                    literalHead: headOf(chunk),
                    where: path.relative(ROOT, full),
                });
            }
        }
    };
    walk(path.join(ROOT, "src/core"));
    walk(path.join(ROOT, "src/app"));
    walk(path.join(ROOT, "module-sources"));
    return found;
}

/** The static text a written title starts with, before its first interpolation. */
function headOf(chunk: string): string {
    const backtick = /title:\s*`([^`]*)`/.exec(chunk);
    if (backtick) return backtick[1].split("${")[0];
    const quoted = /title:\s*"([^"]*)"/.exec(chunk);
    return quoted ? quoted[1] : "";
}

/**
 * Types whose stored *title* stays English whatever the locale.
 *
 * Each is here because the English does not end where the entity begins,
 * which is the only shape `{ prefix, key }` can express: translating these
 * needs the row to store parameters rather than prose. They are declared all
 * the same - `nameKey` alone - because what the kind is *called* is a
 * different question and every kind has to answer it. Six of these were
 * undeclared entirely, and the filter above a member's own activity listed
 * them by their type.
 *
 * A new activity type must be declared with a name, and named here too if its
 * title cannot be substituted.
 */
const ENGLISH_BY_LIMITATION = new Set([
    // "${type} issued to ${player}: ${reason}" - starts with an interpolation.
    "punishments.punishment.issued",
    // "${punishment.type} revoked for ${player}" - same.
    "punishments.punishment.revoked",
    // "${username} updated their profile" - same. Core's, so it has no manifest
    // entry; `CORE_NAMES` in activity-title.ts names it.
    "user.profile.updated",
    // "Received ${amount} credits" - the entity sits between two English words.
    "credits.credit.added",
    // "Voted on ${site} and earned ${n} credits" - trailing clause, and it is
    // only there when the vote paid out, so no fixed suffix describes it.
    "vote.vote.cast",
    // "Won ${prize} on the wheel" - trailing English after the entity.
    "wheel.prize.won",
]);

/** The types and keys core declares for its own events, read off the source. */
function coreDeclarations(): { types: string[]; keys: string[] } {
    const source = fs.readFileSync(path.join(ROOT, "src/core/lib/activity-title.ts"), "utf8");
    const block = source.slice(source.indexOf("const CORE_PREFIXES"), source.indexOf("const PREFIXES"));
    return {
        types: [...block.matchAll(/"([a-z][\w.]*)":\s*\{/g)].map((m) => m[1]),
        keys: [...block.matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]),
    };
}

describe("what the feed writes", () => {
    const written = writtenTypes();

    it("is found by the scan at all", () => {
        expect(written.size).toBeGreaterThan(15);
        expect([...written.keys()]).toContain("store.order.completed");
    });

    it("has a title declaration for every type, or a reason recorded here", () => {
        // A name-only entry is not a title declaration: the title is still the
        // English the row was written with.
        const substituted = new Set(
            manifests().flatMap((m) => m.titles.filter((t) => t.prefix !== undefined).map((t) => t.type)),
        );
        for (const type of coreDeclarations().types) substituted.add(type);
        const english = [...written.keys()].filter((t) => !substituted.has(t)).sort();
        expect(english).toEqual([...ENGLISH_BY_LIMITATION].sort());
    });
});

describe("what a module declares", () => {
    const written = writtenTypes();

    it("names a type some code actually writes", () => {
        const orphans: string[] = [];
        for (const { id, titles } of manifests()) {
            for (const t of titles) {
                if (!written.has(t.type)) orphans.push(`${id}: ${t.type}`);
            }
        }
        expect(orphans).toEqual([]);
    });

    it("names a prefix the written title actually starts with", () => {
        const mismatched: string[] = [];
        for (const { id, titles } of manifests()) {
            for (const t of titles) {
                const row = written.get(t.type);
                if (!row || t.prefix === undefined) continue; // reported by the test above
                if (!row.literalHead.startsWith(t.prefix)) {
                    mismatched.push(`${id}: ${t.type} declares ${JSON.stringify(t.prefix)} but ${row.where} writes ${JSON.stringify(row.literalHead)}`);
                }
            }
        }
        expect(mismatched).toEqual([]);
    });

    it("ships the key it names, in every locale it ships", () => {
        const missing: string[] = [];
        for (const { id, titles, translations } of manifests()) {
            for (const t of titles) {
                if (t.key === undefined) continue;
                for (const locale of Object.keys(translations)) {
                    const value = translations[locale]?.activity?.[t.key];
                    if (typeof value !== "string" || !value.trim()) {
                        missing.push(`${id}: activity.${t.key} missing for ${locale}`);
                    }
                }
            }
        }
        expect(missing).toEqual([]);
    });
});

describe("what core declares", () => {
    const { types, keys } = coreDeclarations();

    it("declares the core-written types", () => {
        expect(keys.length).toBeGreaterThanOrEqual(3);
        expect(types).toHaveLength(keys.length);
    });

    it("ships every key it names, in both locales", () => {
        const missing: string[] = [];
        for (const locale of ["en", "tr"]) {
            const messages = JSON.parse(fs.readFileSync(path.join(ROOT, `messages-core/${locale}.json`), "utf8"));
            for (const key of keys) {
                const value = messages?.activity?.[key];
                if (typeof value !== "string" || !value.trim()) missing.push(`${locale}: activity.${key}`);
            }
        }
        expect(missing).toEqual([]);
    });
});

describe("localizeActivityTitle", () => {
    const t = Object.assign((key: string) => ({ storeOrderCompleted: "satın aldı:" })[key] ?? `??${key}`, {
        has: (key: string) => key === "storeOrderCompleted",
    });

    it("keeps the whole sentence when a declared prefix does not match the row", () => {
        // The store's own bug: the declaration was right about the type and
        // wrong about the wording, and the entity must survive that.
        expect(localizeActivityTitle("store.order.completed", "Refunded order #1412", t)).toBe("Refunded order #1412");
    });

    it("leaves a type nobody declared exactly as written", () => {
        expect(localizeActivityTitle("wheel.prize.won", "Won a Diamond Sword on the wheel", t)).toBe(
            "Won a Diamond Sword on the wheel",
        );
    });

    it("substitutes the label and keeps what follows when the prefix matches", () => {
        expect(localizeActivityTitle("store.order.completed", "Completed order #1412", t)).toBe("satın aldı: #1412");
    });

    it("does not translate when the catalogue has no such key", () => {
        const empty = Object.assign((key: string) => key, { has: () => false });
        expect(localizeActivityTitle("store.order.completed", "Completed order #1412", empty)).toBe("Completed order #1412");
    });
});

describe("activityTypeLabel", () => {
    /**
     * The filter above a member's own activity offers the kinds that account
     * has. It used to have no filter at all, and the obvious way to build one
     * is to print the `type` column - which is `store.order.completed`, a hook
     * name, on a screen a member reads about themselves.
     *
     * It read the *title* declaration first, which gave "Purchased:" - a
     * fragment with a colon on it - for the events that had one, and the raw
     * type for the six that did not. A kind has a name of its own now.
     */
    const t = Object.assign((key: string) => ({ kindStoreOrderCompleted: "Sipariş" })[key] ?? `??${key}`, {
        has: (key: string) => key === "kindStoreOrderCompleted",
    });

    it("names a declared kind in the reader's language", () => {
        expect(activityTypeLabel("store.order.completed", t)).toBe("Sipariş");
    });

    it("names a kind whose title cannot be substituted", () => {
        // The whole point of splitting the two: this one has no prefix.
        const wheel = Object.assign((key: string) => ({ kindWheelPrizeWon: "Çark Ödülü" })[key] ?? `??${key}`, {
            has: (key: string) => key === "kindWheelPrizeWon",
        });
        expect(activityTypeLabel("wheel.prize.won", wheel)).toBe("Çark Ödülü");
    });

    it("falls back to the kind itself when nobody declared it", () => {
        expect(activityTypeLabel("ghost.module.event", t)).toBe("ghost.module.event");
    });

    it("falls back to the kind itself when the message is missing", () => {
        const empty = Object.assign((key: string) => key, { has: () => false });
        expect(activityTypeLabel("store.order.completed", empty)).toBe("store.order.completed");
    });
});
