import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";
import { localizeActivityTitle } from "@/core/lib/activity-title";
import { locales } from "@/core/lib/i18n/config";

/**
 * Every activity in the feed reads in the reader's language.
 *
 * The feed stores an English sentence per row and translates it on the way
 * out. A prefix can only translate a sentence that starts with fixed words, so
 * six kinds were left in English for every reader: credits received, a
 * punishment issued or revoked, a vote, a wheel prize and a profile update.
 * On a Turkish site the homepage feed said "Received 40 credits" and
 * "ban issued to Steve", the second with the machine name of the punishment
 * as its first word.
 *
 * These are the rows as the code writes them, read through each locale's own
 * catalogue: core's and every module's `activity` block, as the site loads them.
 */

const ROOT = process.cwd();

function activityMessages(locale: string): Record<string, string> {
    const core = JSON.parse(fs.readFileSync(path.join(ROOT, `messages-core/${locale}.json`), "utf8")).activity ?? {};
    const modules = fs.readdirSync(path.join(ROOT, "module-sources"))
        .map((id) => path.join(ROOT, "module-sources", id, "module.json"))
        .filter((file) => fs.existsSync(file))
        .map((file) => JSON.parse(fs.readFileSync(file, "utf8")).translations?.[locale]?.activity ?? {});
    return Object.assign({}, core, ...modules);
}

/** Each row as written, with the entity a reader has to still find in it. */
const ROWS: { type: string; title: string; keeps: string[] }[] = [
    { type: "credits.credit.added", title: "Received 40 credits", keeps: ["40"] },
    { type: "punishments.punishment.issued", title: "ban issued to Steve: griefing the spawn", keeps: ["Steve", "griefing the spawn"] },
    { type: "punishments.punishment.issued", title: "tempMute issued to Steve", keeps: ["Steve"] },
    { type: "punishments.punishment.revoked", title: "kick revoked for Steve", keeps: ["Steve"] },
    { type: "vote.vote.cast", title: "Voted on Top Servers", keeps: ["Top Servers"] },
    { type: "wheel.prize.won", title: "Won Diamond Sword on the wheel", keeps: ["Diamond Sword"] },
    { type: "user.profile.updated", title: "aeryn updated their profile", keeps: ["aeryn"] },
];

/** English words a translated row must not still carry. */
const ENGLISH = /\b(Received|credits|issued|revoked|Voted|Won|wheel|updated|profile|ban|kick|tempMute)\b/;

describe("an activity reads in the reader's language", () => {
    for (const locale of locales.filter((l) => l !== "en")) {
        const t = createTranslator({ locale, messages: { activity: activityMessages(locale) }, namespace: "activity" });

        for (const row of ROWS) {
            it(`${locale}: ${row.title}`, () => {
                const read = localizeActivityTitle(row.type, row.title, t);
                expect(read).not.toBe(row.title);
                expect(read).not.toMatch(ENGLISH);
                for (const kept of row.keeps) expect(read).toContain(kept);
            });
        }
    }

    it("en: a punishment is named, not printed as its machine name", () => {
        const t = createTranslator({ locale: "en", messages: { activity: activityMessages("en") }, namespace: "activity" });
        expect(localizeActivityTitle("punishments.punishment.issued", "tempMute issued to Steve", t)).toBe("Temporary mute issued to Steve");
    });

    it("keeps a punishment type nobody listed as it was written", () => {
        const t = createTranslator({ locale: "en", messages: { activity: activityMessages("en") }, namespace: "activity" });
        expect(localizeActivityTitle("punishments.punishment.issued", "jail issued to Steve", t)).toBe("jail issued to Steve");
    });

    it("keeps a row the patterns do not describe as it was written", () => {
        const t = createTranslator({ locale: "tr", messages: { activity: activityMessages("tr") }, namespace: "activity" });
        expect(localizeActivityTitle("credits.credit.added", "Credits adjusted by staff", t)).toBe("Credits adjusted by staff");
    });
});
