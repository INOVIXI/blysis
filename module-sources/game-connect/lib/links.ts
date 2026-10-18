/**
 * Proving a game account is a member's, from either side.
 *
 * From the game: a player asks for a code and opens the site's link page with
 * it, signed in, and confirms. From the site: a member asks for a code and
 * types it in game. Either way a code is single use, lives ten minutes, is
 * stored as a hash, and binds one game account to one member per platform.
 */
import crypto from "crypto";
import { prisma } from "@/core/sdk/server";

export const CODE_TTL_MS = 10 * 60 * 1000;
/** No 0/O, 1/I/L: the pairs people misread from a chat line. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateCode(): string {
    const bytes = crypto.randomBytes(8);
    const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
    return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

export function normaliseCode(code: string): string {
    return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashCode(code: string): string {
    return crypto.createHash("sha256").update(normaliseCode(code)).digest("hex");
}

export type LinkOutcome = { ok: true; userId: string; username: string } | { ok: false; code: "already_linked" | "code_invalid" };

/**
 * Binds a game account to a member, unless either is already bound.
 *
 * A member who wants another account unlinks the first on the site. A game
 * account somebody else holds stays theirs until they let it go.
 */
export async function bind(platform: string, externalId: string, name: string, userId: string): Promise<LinkOutcome> {
    const [byAccount, byMember] = await Promise.all([
        prisma.gameConnectLink.findUnique({ where: { platform_externalId: { platform, externalId } } }),
        prisma.gameConnectLink.findUnique({ where: { platform_userId: { platform, userId } } }),
    ]);
    if (byAccount && byAccount.userId !== userId) return { ok: false, code: "already_linked" };
    if (byMember && byMember.externalId !== externalId) return { ok: false, code: "already_linked" };
    if (!byAccount) {
        try {
            await prisma.gameConnectLink.create({ data: { platform, externalId, name, userId } });
        } catch {
            // Two confirmations raced for the same account or member: the
            // unique indexes let one in.
            return { ok: false, code: "already_linked" };
        }
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    return { ok: true, userId, username: user?.username ?? "" };
}

/** Spends a code: returns it once, and deletes it so it cannot be used again. */
export async function spend(code: string, direction: "game" | "site", now: Date = new Date()) {
    const row = await prisma.gameConnectLinkCode.findUnique({ where: { codeHash: hashCode(code) } });
    if (!row || row.direction !== direction) return null;
    const taken = await prisma.gameConnectLinkCode.deleteMany({ where: { id: row.id } });
    if (taken.count === 0) return null;
    return row.expiresAt.getTime() >= now.getTime() ? row : null;
}
