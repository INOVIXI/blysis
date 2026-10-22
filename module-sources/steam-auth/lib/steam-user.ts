/**
 * Turns a verified Steam player into a Blysis account.
 *
 * Steam never gives out an email address, and core's `User.email` is a
 * required unique column, so an account created this way gets a placeholder in
 * the `.invalid` TLD - reserved by RFC 6761 precisely so it can never resolve
 * or be delivered to. It is unique per Steam id, obviously synthetic, and the
 * user can replace it from their profile settings. Nothing is ever sent to it:
 * `emailVerified` stays null.
 */
import { prisma } from "@/core/sdk/server";
import type { SteamPlayer } from "./steam-profile";

export const STEAM_PROVIDER_ID = "steam";

/** What Auth.js's `authorize` has to return, matching core's credentials provider. */
export interface SteamSessionUser {
    id: string;
    email: string;
    name: string;
    image: string | null;
    role: string;
    rolePriority: number;
}

function placeholderEmail(steamId: string): string {
    return `steam-${steamId}@steam.invalid`;
}

/** Persona names are free-form; usernames here are a slug with a unique suffix. */
function baseUsername(player: SteamPlayer): string {
    const slug = player.personaName
        .normalize("NFKD")
        .replace(/[^\w.-]+/g, "_")
        .replace(/_{2,}/g, "_")
        .replace(/^[_.-]+|[_.-]+$/g, "")
        .slice(0, 24);
    return slug || `steam_${player.steamId.slice(-8)}`;
}

async function uniqueUsername(player: SteamPlayer): Promise<string> {
    const base = baseUsername(player);
    // However it is capitalised: the unique key is exact, and a persona
    // called "Admin" must not arrive beside the site's "admin".
    const holder = await prisma.user.findFirst({
        where: { username: { equals: base, mode: "insensitive" } },
        select: { id: true },
    });
    if (!holder) return base;
    // Two people can absolutely share a Steam persona name. Fall back to the
    // Steam id, which cannot collide, rather than counting upward forever.
    return `${base.slice(0, 15)}_${player.steamId.slice(-8)}`;
}

/**
 * Finds the account this Steam id already belongs to, or makes one.
 *
 * Linking is deliberately by `Account` row only - never by matching the
 * placeholder email or the persona name against an existing user. Anyone can
 * pick any Steam persona name, so name matching would be an account takeover.
 */
export async function upsertSteamUser(player: SteamPlayer): Promise<SteamSessionUser | null> {
    const existing = await prisma.account.findUnique({
        where: {
            provider_providerAccountId: {
                provider: STEAM_PROVIDER_ID,
                providerAccountId: player.steamId,
            },
        },
        select: { user: { include: { role: true } } },
    });

    if (existing?.user) {
        const user = existing.user;
        if (user.isBanned || user.isDeleted) return null;
        // Keep the avatar fresh; leave the username alone, because the admin
        // or the user may have changed it deliberately.
        if (player.avatar && user.avatar !== player.avatar) {
            await prisma.user
                .update({ where: { id: user.id }, data: { avatar: player.avatar } })
                .catch(() => undefined);
        }
        return {
            id: user.id,
            email: user.email,
            name: user.username,
            image: player.avatar ?? user.avatar,
            role: user.role?.name || "member",
            rolePriority: user.role?.priority ?? 0,
        };
    }

    const defaultRole = await prisma.role.findFirst({ where: { name: "member" } });
    const created = await prisma.user.create({
        data: {
            email: placeholderEmail(player.steamId),
            username: await uniqueUsername(player),
            avatar: player.avatar,
            roleId: defaultRole?.id ?? null,
            accounts: {
                create: {
                    type: "oauth",
                    provider: STEAM_PROVIDER_ID,
                    providerAccountId: player.steamId,
                },
            },
        },
        include: { role: true },
    });

    return {
        id: created.id,
        email: created.email,
        name: created.username,
        image: created.avatar,
        role: created.role?.name || "member",
        rolePriority: created.role?.priority ?? 0,
    };
}
