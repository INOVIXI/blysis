// @vitest-environment node
/**
 * The half of Steam sign-in that touches the database: the single-use ticket
 * that carries a verified Steam id from a GET redirect into an Auth.js
 * sign-in, and the account that id ends up attached to.
 *
 * Prisma is replaced with a small in-memory stand-in, so these are assertions
 * about the rules (used once, expires, links only by Steam id) rather than
 * about SQL.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

interface TicketRow {
    id: string;
    tokenHash: string;
    steamId: string;
    expiresAt: Date;
}

interface UserRow {
    id: string;
    email: string;
    username: string;
    avatar: string | null;
    roleId: string | null;
    isBanned: boolean;
    isDeleted: boolean;
    role?: { name: string; priority: number } | null;
}

interface AccountRow {
    userId: string;
    provider: string;
    providerAccountId: string;
}

const db = {
    tickets: [] as TicketRow[],
    users: [] as UserRow[],
    accounts: [] as AccountRow[],
    nextId: 1,
};

const prismaMock = {
    steamLoginTicket: {
        create: vi.fn(async ({ data }: { data: Omit<TicketRow, "id"> }) => {
            const row = { id: `t${db.nextId++}`, ...data };
            db.tickets.push(row);
            return row;
        }),
        findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) =>
            db.tickets.find((t) => t.tokenHash === where.tokenHash) ?? null,
        ),
        delete: vi.fn(async ({ where }: { where: { id: string } }) => {
            db.tickets = db.tickets.filter((t) => t.id !== where.id);
            return null;
        }),
        deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    account: {
        findUnique: vi.fn(async ({ where }: { where: { provider_providerAccountId: AccountRow } }) => {
            const key = where.provider_providerAccountId;
            const account = db.accounts.find(
                (a) => a.provider === key.provider && a.providerAccountId === key.providerAccountId,
            );
            if (!account) return null;
            const user = db.users.find((u) => u.id === account.userId);
            return user ? { user } : null;
        }),
    },
    user: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => db.users.find((u) => u.id === where.id) ?? null),
        findFirst: vi.fn(async ({ where }: { where: { username: { equals: string; mode?: string } } }) => {
            const { equals, mode } = where.username;
            const same = (name: string) => (mode === "insensitive" ? name.toLowerCase() === equals.toLowerCase() : name === equals);
            return db.users.find((u) => same(u.username)) ?? null;
        }),
        create: vi.fn(
            async ({
                data,
            }: {
                data: {
                    email: string;
                    username: string;
                    avatar: string | null;
                    roleId: string | null;
                    accounts: { create: Omit<AccountRow, "userId"> };
                };
            }) => {
                const user: UserRow = {
                    id: `u${db.nextId++}`,
                    email: data.email,
                    username: data.username,
                    avatar: data.avatar,
                    roleId: data.roleId,
                    isBanned: false,
                    isDeleted: false,
                    role: data.roleId ? { name: "member", priority: 0 } : null,
                };
                db.users.push(user);
                db.accounts.push({ userId: user.id, ...data.accounts.create });
                return user;
            },
        ),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<UserRow> }) => {
            const user = db.users.find((u) => u.id === where.id);
            if (user) Object.assign(user, data);
            return user;
        }),
    },
    role: {
        findFirst: vi.fn(async () => ({ id: "role-member", name: "member", priority: 0 })),
    },
};

vi.mock("@/core/sdk/server", () => ({
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }, prisma: prismaMock }));

const { issueTicket, consumeTicket } = await import("@/modules/steam-auth/lib/steam-ticket");
const { upsertSteamUser } = await import("@/modules/steam-auth/lib/steam-user");

const STEAM_ID = "76561198000000001";
const player = (overrides: Record<string, unknown> = {}) => ({
    steamId: STEAM_ID,
    personaName: "Kaya",
    avatar: "https://avatars.steamstatic.com/full.jpg",
    profileUrl: "https://steamcommunity.com/id/kaya",
    ...overrides,
});

beforeEach(() => {
    db.tickets = [];
    db.users = [];
    db.accounts = [];
    db.nextId = 1;
});

describe("steam login tickets", () => {
    it("hands back the Steam id it was issued for", async () => {
        const token = await issueTicket(STEAM_ID);
        await expect(consumeTicket(token)).resolves.toBe(STEAM_ID);
    });

    it("never stores the token itself", async () => {
        const token = await issueTicket(STEAM_ID);
        expect(db.tickets[0].tokenHash).not.toBe(token);
        expect(db.tickets[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("works exactly once", async () => {
        const token = await issueTicket(STEAM_ID);
        await consumeTicket(token);
        await expect(consumeTicket(token)).resolves.toBeNull();
    });

    it("refuses an expired ticket, and burns it anyway", async () => {
        const token = await issueTicket(STEAM_ID);
        db.tickets[0].expiresAt = new Date(Date.now() - 1000);
        await expect(consumeTicket(token)).resolves.toBeNull();
        expect(db.tickets).toHaveLength(0);
    });

    it("refuses a token nobody issued", async () => {
        await expect(consumeTicket("deadbeef")).resolves.toBeNull();
        await expect(consumeTicket("")).resolves.toBeNull();
    });

    it("issues a different token every time", async () => {
        const first = await issueTicket(STEAM_ID);
        const second = await issueTicket(STEAM_ID);
        expect(first).not.toBe(second);
    });
});

describe("upsertSteamUser", () => {
    it("creates an account with the member role on first sign-in", async () => {
        const user = await upsertSteamUser(player());
        expect(user).toMatchObject({ name: "Kaya", role: "member", rolePriority: 0 });
        expect(db.accounts).toEqual([
            { userId: user!.id, type: "oauth", provider: "steam", providerAccountId: STEAM_ID },
        ]);
    });

    it("gives the new account an address that can never receive mail", async () => {
        const user = await upsertSteamUser(player());
        expect(user!.email).toBe(`steam-${STEAM_ID}@steam.invalid`);
    });

    it("returns the same account on the next sign-in", async () => {
        const first = await upsertSteamUser(player());
        const second = await upsertSteamUser(player({ personaName: "Kaya renamed" }));
        expect(second!.id).toBe(first!.id);
        expect(db.users).toHaveLength(1);
    });

    // Anyone can set any Steam persona name, so matching one against an
    // existing username would hand that account to a stranger.
    it("does not adopt an existing account that merely shares the name", async () => {
        db.users.push({
            id: "u-victim",
            email: "victim@example.com",
            username: "Kaya",
            avatar: null,
            roleId: "role-admin",
            isBanned: false,
            isDeleted: false,
            role: { name: "admin", priority: 100 },
        });

        const user = await upsertSteamUser(player());
        expect(user!.id).not.toBe("u-victim");
        expect(user!.role).toBe("member");
        expect(user!.name).not.toBe("Kaya");
    });

    it("does not give a new account a name somebody holds under another capitalisation", async () => {
        db.users.push({
            id: "u-victim",
            email: "victim@example.com",
            username: "kaya",
            avatar: null,
            roleId: "role-admin",
            isBanned: false,
            isDeleted: false,
            role: { name: "admin", priority: 100 },
        });

        const user = await upsertSteamUser(player());
        expect(user!.name.toLowerCase()).not.toBe("kaya");
    });

    it("refuses a banned account", async () => {
        const first = await upsertSteamUser(player());
        db.users.find((u) => u.id === first!.id)!.isBanned = true;
        await expect(upsertSteamUser(player())).resolves.toBeNull();
    });

    it("keeps the avatar up to date", async () => {
        const first = await upsertSteamUser(player());
        await upsertSteamUser(player({ avatar: "https://avatars.steamstatic.com/new.jpg" }));
        expect(db.users.find((u) => u.id === first!.id)!.avatar).toBe(
            "https://avatars.steamstatic.com/new.jpg",
        );
    });

    it("falls back to a name derived from the Steam id when the persona is unusable", async () => {
        const user = await upsertSteamUser(player({ personaName: "!!!" }));
        expect(user!.name).toBe(`steam_${STEAM_ID.slice(-8)}`);
    });
});
