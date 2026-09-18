import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

/**
 * A mute has to stop the next endpoint too.
 *
 * The punishments module recorded mutes that nothing enforced, and the reason
 * it stayed that way is that there was nowhere to enforce them: every endpoint
 * that takes something a member wrote checked that they were signed in, and
 * decided for itself. Adding `refuseSilenced` to the ones that existed fixes
 * today. This file is what fixes next month, because the endpoint somebody
 * writes next is the one that forgets, and the failure is silent - a moderator
 * mutes somebody and only notices weeks later that they never stopped posting.
 *
 * So the rule is read off the source rather than remembered. A POST handler
 * that creates a row naming the session's own user as its author is a member
 * writing something; that is the shape, and every one of them either calls the
 * guard or is listed in `NOT_SPEECH` with the reason it is not.
 *
 * `NOT_SPEECH` is where the judgement lives, and it is worth making
 * deliberately. A ticket is the appeal channel, so silencing somebody must not
 * take it away or a mute becomes a gag with no way out. A purchase is a
 * transaction, not speech. An admin screen is not a member writing.
 */

const ROOT = join(__dirname, "../..");

/**
 * Endpoints that match the shape and still must not ask. Each line is a
 * decision; changing one is changing what a mute means.
 */
const NOT_SPEECH: Record<string, string> = {
    // The way a silenced member appeals. Taking it away makes a mute a gag.
    "module-sources/tickets/api/tickets/route.ts": "a ticket is how somebody appeals",
    "module-sources/tickets/api/tickets/[id]/route.ts": "a reply on their own ticket is the same appeal",

    // Money and entitlements. Somebody who cannot post can still be owed
    // what they paid for, and refusing a purchase mid-flow loses the payment.
    "module-sources/store/api/checkout/route.ts": "a purchase is a transaction, not speech",
    "module-sources/store/api/gift-codes/route.ts": "redeeming what was bought is not speech",
    "module-sources/wheel/api/spin/route.ts": "spending a spin they already hold is not speech",
    "module-sources/vote/api/record/route.ts": "a vote is a callback from a server list, not a post",

    // A count, not a sentence. Nobody reads a like.
    "module-sources/forum/api/topics/[id]/like/route.ts": "a like says nothing to read",
    "module-sources/suggestions/api/[id]/vote/route.ts": "a vote says nothing to read",

    // Written by staff, and already behind a permission.
    "module-sources/announcements/api/route.ts": "written by staff",
    "module-sources/blog/api/articles/route.ts": "written by staff",
    "module-sources/showcase/api/cards/route.ts": "written by staff",
    "module-sources/staff/api/route.ts": "written by staff",
    "module-sources/trophies/api/admin/route.ts": "written by staff",
    "module-sources/url-redirects/api/redirects/route.ts": "written by staff",
    "module-sources/store/api/admin/credit-packages/route.ts": "written by staff",
    "module-sources/store/api/admin/orders/route.ts": "written by staff",
    "module-sources/store/api/admin/products/[id]/copy/route.ts": "written by staff",
    "src/app/api/v1/admin/updates/route.ts": "written by staff",
    "src/app/api/v1/admin/warnings/route.ts": "written by staff",
    "src/app/api/v1/broadcasts/route.ts": "written by staff",
    "src/app/api/v1/roles/route.ts": "written by staff",

    // A key is theirs, and nobody else reads it.
    "src/app/api/v1/api-keys/route.ts": "an API key is not something anybody reads",
};

/** The member is named as the author of the row being created. */
const AUTHORED = /(userId|authorId|senderId|createdById|memberId|postedById)\s*:\s*(session\.user\.id|userId|me\.id)/;

function walk(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.name === "route.ts") out.push(full);
    }
    return out;
}

function memberWritingEndpoints(): string[] {
    const found: string[] = [];
    for (const file of [...walk(join(ROOT, "module-sources")), ...walk(join(ROOT, "src/app/api"))]) {
        const source = readFileSync(file, "utf-8");
        if (!/export async function POST/.test(source)) continue;
        if (!/\.create\(|\.createMany\(/.test(source)) continue;
        if (!AUTHORED.test(source)) continue;
        found.push(file.slice(ROOT.length + 1));
    }
    return found.sort();
}

describe("a silenced member cannot write", () => {
    const endpoints = memberWritingEndpoints();

    it("finds the endpoints that take member-written content", () => {
        // A rule read off nothing passes forever. If this drops to nothing,
        // the shape below stopped matching and the gate stopped gating.
        expect(endpoints.length).toBeGreaterThan(15);
    });

    it("asks the guard on every one that is not listed as something else", () => {
        const unguarded = endpoints
            .filter((path) => !(path in NOT_SPEECH))
            .filter((path) => !readFileSync(join(ROOT, path), "utf-8").includes("refuseSilenced"));

        expect(unguarded).toEqual([]);
    });

    it("keeps no exemption for an endpoint that has gone", () => {
        const stale = Object.keys(NOT_SPEECH).filter((path) => !existsSync(join(ROOT, path)));

        expect(stale).toEqual([]);
    });

    it("gives every exemption a reason", () => {
        const unexplained = Object.entries(NOT_SPEECH)
            .filter(([, reason]) => reason.trim().length < 10)
            .map(([path]) => path);

        expect(unexplained).toEqual([]);
    });

    it("leaves the appeal channel open, which is what makes a mute not a gag", () => {
        expect(NOT_SPEECH["module-sources/tickets/api/tickets/route.ts"]).toBeDefined();
    });
});
