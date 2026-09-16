/**
 * A linked account on a profile was proved, not typed in.
 *
 * The Linked Accounts tab offered a free text box: type any in-game name,
 * press Link, and it was written down as yours and shown on your public
 * profile. Nothing checked it. `LinkedAccount.provider_providerId` is unique,
 * so the first person to type a name owned it - including somebody else's.
 * The tab also promised "accounts you sign in with are linked automatically",
 * which nothing implemented: the only writer of that table was this box.
 *
 * Meanwhile the module that can prove it already did. `minecraft-link` sends
 * a code to the account in game and waits for it to be typed back, and keeps
 * the result in its own table.
 *
 * So this module asks instead of storing. It emits `profile.linkedAccounts`
 * and a module that has verified something answers. Nothing on the site can
 * record a link a member merely claimed.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MODULE = path.join(ROOT, "module-sources/player-profiles");

function read(...parts: string[]): string {
    return fs.readFileSync(path.join(...parts), "utf8");
}

describe("the linked accounts a member sees", () => {
    const route = read(MODULE, "api/linked-accounts/route.ts");
    const tab = read(MODULE, "components/ProfileAccountsTab.tsx");

    it("cannot be written by the member who claims them", () => {
        expect(route).not.toMatch(/export async function POST/);
        expect(route).not.toMatch(/linkedAccount\.(create|upsert)/);
    });

    it("offers no box to type one into", () => {
        expect(tab).not.toContain("<Input");
        expect(tab).not.toContain("gameUsername");
    });

    it("promises no automatic linking, because nothing does it", () => {
        const manifest = JSON.parse(read(MODULE, "module.json"));
        for (const locale of ["en", "tr"]) {
            expect(manifest.translations[locale].playerProfiles.oauthAutoLink, locale).toBeUndefined();
        }
        expect(tab).not.toContain("oauthAutoLink");
    });

    it("comes from whichever module proved them", () => {
        // One reader for both screens, so the member's tab and their public
        // profile cannot disagree about what is proved.
        const reader = read(MODULE, "lib/read-linked-accounts.ts");
        expect(reader).toContain('applyFiltersAsync("profile.linkedAccounts"');
        expect(route).toContain("readLinkedAccounts(");
        const manifest = JSON.parse(read(MODULE, "module.json"));
        const emitted = (manifest.hooksEmitted ?? []).map((h: { hook: string }) => h.hook);
        expect(emitted).toContain("profile.linkedAccounts");
    });

    it("is answered by the module that sends a code in game", () => {
        const minecraft = path.join(ROOT, "module-sources/minecraft-link");
        const manifest = JSON.parse(read(minecraft, "module.json"));
        const listener = (manifest.hookListeners ?? []).find(
            (h: { hook: string }) => h.hook === "profile.linkedAccounts",
        );
        expect(listener).toBeTruthy();
        expect(fs.existsSync(path.join(minecraft, listener.handler))).toBe(true);
    });

    it("is what the public profile shows too, rather than a second reading", () => {
        const publicApi = read(MODULE, "api/[username]/route.ts");
        expect(publicApi).not.toContain("prisma.linkedAccount");
        expect(publicApi).toContain("readLinkedAccounts(");
    });
});
