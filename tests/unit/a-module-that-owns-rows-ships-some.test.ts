// @vitest-environment node
/**
 * A module that owns a table ships rows worth looking at, or says why not.
 *
 * An empty install answers every question with "nothing here yet", which is
 * the one state nobody needs to test: it hides pagination, ordering,
 * truncation, a name too long for its column, and empty against failed. That
 * is why `seed.ts` exists beside `module.json`.
 *
 * Measured on 2026-09-20: 26 of 89 modules shipped demo data, and the ones
 * that did not were never counted, so nobody could tell a module with nothing
 * to show from a module whose seed was never written. Three modules owned
 * tables an operator fills by hand - popups, game servers, redirect rules -
 * and every one of their screens was blank on a seeded site. A fourth,
 * webhook deliveries, turned out to have no writer at all, which is the kind
 * of thing counting finds and seeding would have hidden; core announces every
 * delivery it makes now, so that one is seeded too.
 *
 * Owning a table is the line. A module with no models of its own reads
 * somebody else's rows and has nothing to write; a module with models either
 * has something to show or can say, here, why its rows are not demo data.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SOURCES = path.join(ROOT, "module-sources");

/**
 * Why a module that owns a table ships no demo data.
 *
 * Every reason here is one of three: the rows are what a real payment,
 * a real sign-in or a real invoice left behind, so inventing them invents a
 * transaction that never happened; or they are a provider's own answer
 * refreshed on a schedule, so a made-up one is a wrong one on a screen that
 * reads as authoritative; or they only mean anything against a system this
 * site does not own.
 */
const NOTHING_TO_SHOW: Record<string, string> = {
    "birfatura-invoicing": "Invoices issued against real orders through a real account. A made-up invoice number is a claim about somebody's books.",
    "parasut-invoicing": "The same: a row here means an invoice exists at the provider.",
    "paypal-gateway": "What a completed payment left behind. There is no payment.",
    "stripe-gateway": "A customer record and a price, both mirrored from Stripe. Inventing either points the checkout at an id that does not exist.",
    "steam-auth": "A ticket minted during a sign-in and spent seconds later. A seeded one is an expired one.",
    "currency": "Exchange rates the module's cron fetches. A made-up rate prices the whole store wrongly on a screen that reads as authoritative.",
    "discord-integration": "Which event goes to which channel, against channel ids that only exist in one Discord server.",
    "external-data": "A source names a table in a database this site does not own. A seeded source is a source that cannot be read.",
    "minecraft-litebans": "What probing one operator's LiteBans database reported.",
};

function moduleIds(): string[] {
    return fs
        .readdirSync(SOURCES, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(SOURCES, entry.name, "module.json")))
        .map((entry) => entry.name)
        .sort();
}

/** Models declared by the module itself, which are the rows it owns. */
function ownsRows(id: string): boolean {
    const schema = path.join(SOURCES, id, "schema.prisma");
    if (!fs.existsSync(schema)) return false;
    return /^model\s+\w+\s*\{/m.test(fs.readFileSync(schema, "utf8"));
}

function shipsASeed(id: string): boolean {
    const seed = path.join(SOURCES, id, "seed.ts");
    return fs.existsSync(seed) && /export const seed\s*:\s*ModuleSeed/.test(fs.readFileSync(seed, "utf8"));
}

describe("the census", () => {
    const ids = moduleIds();

    it("finds the modules, so a broken scan cannot pass quietly", () => {
        expect(ids.length).toBeGreaterThan(80);
        expect(ids.filter(ownsRows).length).toBeGreaterThan(20);
    });
});

describe("a module that owns a table", () => {
    const owners = moduleIds().filter(ownsRows);

    it("ships demo data, or says here why it has none", () => {
        const silent = owners.filter((id) => !shipsASeed(id) && !(id in NOTHING_TO_SHOW));
        expect(silent).toEqual([]);
    });

    it("keeps every exemption to a module that exists and owns a table", () => {
        for (const id of Object.keys(NOTHING_TO_SHOW)) {
            expect(fs.existsSync(path.join(SOURCES, id, "module.json")), id).toBe(true);
            expect(ownsRows(id), id).toBe(true);
        }
    });

    it("keeps no exemption for a module that has since been seeded", () => {
        const stale = Object.keys(NOTHING_TO_SHOW).filter(shipsASeed);
        expect(stale).toEqual([]);
    });

    it("gives every exemption a reason somebody can argue with", () => {
        for (const [id, reason] of Object.entries(NOTHING_TO_SHOW)) {
            expect(reason.length, id).toBeGreaterThan(40);
        }
    });
});
