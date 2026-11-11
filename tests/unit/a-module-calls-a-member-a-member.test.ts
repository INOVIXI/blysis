import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { join } from "node:path";

/**
 * A module that is not about a game does not call a member a player.
 *
 * The platform runs a community, a shop and a catalogue, and a game server is
 * one of the things a module can add. So "Oyuncu adı girin" on a moderation
 * screen is the same mistake as fetching a Minecraft skin for a leaderboard:
 * the word decides what kind of site this is, on behalf of an operator who
 * may be running a bookshop.
 *
 * Two of these were made by tidying up. The profiles module was renamed to
 * Member Profiles and its own page went on saying Player Profile. The
 * punishments module was named for a game server while that was what it was,
 * and then the game part moved into a module of its own - `minecraft-litebans`
 * holds the plugin, the payload and the API key - leaving a record about
 * members with a form that asked for a player.
 *
 * Five modules may say it, because they are about a game: the one that proves
 * you own an in-game account, the two that take a plugin's bans, the one
 * that talks to game servers, and the one that sends people to the listings a
 * server is ranked on. Everywhere else the word is an assumption.
 *
 * Only what a reader sees is checked, and only as prose. `playerName` is a
 * column in the shop and in the punishments table, and renaming a column is a
 * migration rather than a word. `{player}` is a substitution in a delivery
 * command an operator has already written and saved; renaming that breaks
 * every command on every install, and it is not a sentence about a person.
 */

const ROOT = join(__dirname, "..", "..");
const MODULES = "module-sources";

/** The modules a game is the subject of. */
const ABOUT_A_GAME = new Set(["minecraft-link", "minecraft-litebans", "minecraft-libertybans", "servers", "vote"]);

const SAYS_PLAYER = /\b(player|players|oyuncu|oyuncular|oyuncuya|oyuncunun)\b/i;

/** Prose, with the substitutions taken out: `{player}` is a name, not a word. */
function prose(value: string): string {
    return value.replace(/\{[^}]*\}/g, " ");
}

describe("a module calls a member a member", () => {
    const modules = fs
        .readdirSync(join(ROOT, MODULES), { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(join(ROOT, MODULES, e.name, "module.json")))
        .map((e) => e.name);

    it("has modules to check", () => {
        expect(modules.length).toBeGreaterThan(70);
    });

    it("says nothing to a reader about players unless the module is about a game", () => {
        const offenders: string[] = [];
        for (const id of modules) {
            if (ABOUT_A_GAME.has(id)) continue;
            const manifest = JSON.parse(fs.readFileSync(join(ROOT, MODULES, id, "module.json"), "utf8")) as {
                name?: string;
                description?: string;
                translations?: Record<string, Record<string, Record<string, unknown>>>;
            };
            for (const field of ["name", "description"] as const) {
                if (typeof manifest[field] === "string" && SAYS_PLAYER.test(prose(manifest[field] as string))) {
                    offenders.push(`${id}: ${field}`);
                }
            }
            for (const [locale, catalogue] of Object.entries(manifest.translations ?? {})) {
                for (const [namespace, entries] of Object.entries(catalogue)) {
                    for (const [key, value] of Object.entries(entries ?? {})) {
                        if (typeof value === "string" && SAYS_PLAYER.test(prose(value))) {
                            offenders.push(`${id}: ${locale}.${namespace}.${key}`);
                        }
                    }
                }
            }
        }
        expect(offenders, "a member is a member; the word belongs to the modules about a game").toEqual([]);
    });
});
