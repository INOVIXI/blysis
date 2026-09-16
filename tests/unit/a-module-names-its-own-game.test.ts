import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { join } from "node:path";
import { stripComments } from "./source-text";

/**
 * A module that is not about one game does not assume one.
 *
 * The platform is general purpose: it runs a community, a shop and a
 * catalogue, and one of the things it can run is a game server. So a module
 * called "Leaderboard" may not decide that every member is a Minecraft
 * player - and it did. The ranking drew each row's avatar from
 * `mc-heads.net/avatar/<username>`, which means every member's name on the
 * page was sent to a third party on every render, and a site that has never
 * seen a game got Steve's head beside its top customers.
 *
 * "Player Profiles" reached the same service, and the shop's own admin help
 * offered "Minecraft username" as the example of a field to ask a buyer for.
 *
 * Three modules may say the word, and they are the ones it belongs to:
 * `minecraft-link` is about proving you own an account, `minecraft-litebans`
 * takes one plugin's bans and hands them to the punishments module, and
 * `servers` lists Minecraft among nine game types it can talk to over RCON.
 * Naming it there is the feature, and each of them says so in its own name.
 * Anywhere else it is an assumption about what this site is.
 */

const ROOT = join(__dirname, "..", "..");
const MODULES = "module-sources";

/** The two modules that are allowed to say it, and why. */
const ITS_OWN = new Set([
    "minecraft-link",
    "minecraft-litebans",
    "servers",
]);

/** The game, its services, and its defaults. */
const SIGNS = /minecraft|mojang|mc-heads|crafatar|minotar|bukkit|spigot|\b25565\b/i;

function filesIn(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) filesIn(rel, out);
        else if (/\.(tsx?|json)$/.test(entry.name)) out.push(rel);
    }
    return out;
}

/**
 * Prose is stripped from code, because the note explaining why a module
 * stopped naming a game has to be allowed to name it. A `module.json` has no
 * comments and is read whole: that is where the strings a user reads live.
 */
function readable(file: string): string {
    const src = fs.readFileSync(join(ROOT, file), "utf8");
    if (file.endsWith(".json")) return src;
    return stripComments(src);
}

describe("a module names its own game", () => {
    const modules = fs
        .readdirSync(join(ROOT, MODULES), { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(join(ROOT, MODULES, e.name, "module.json")))
        .map((e) => e.name);

    it("has modules to check", () => {
        expect(modules.length).toBeGreaterThan(70);
    });

    it("leaves one game to the modules that are about it", () => {
        const offenders: string[] = [];
        for (const id of modules) {
            if (ITS_OWN.has(id)) continue;
            for (const file of filesIn(`${MODULES}/${id}`)) {
                const text = readable(file);
                for (const [index, line] of text.split("\n").entries()) {
                    if (SIGNS.test(line)) offenders.push(`${file}:${index + 1}`);
                }
            }
        }
        expect(offenders, "a module that is not about one game does not assume one").toEqual([]);
    });
});
