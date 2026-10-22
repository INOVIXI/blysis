import { describe, it, expect, vi } from "vitest";
import type { Adapter, AdapterAccount, AdapterUser } from "@auth/core/adapters";
import {
    coreAuthAdapter,
    toAdapterUser,
    toAccountRow,
    baseUsername,
    placeholderEmail,
    type CoreAdapterClient,
    type CoreUserRow,
} from "@/core/lib/auth-adapter";

const row = (over: Partial<CoreUserRow> = {}): CoreUserRow => ({
    id: "u1",
    email: "ada@example.com",
    username: "ada",
    avatar: "https://cdn/a.png",
    emailVerified: null,
    ...over,
});

/** A Prisma stand-in that records what the adapter tried to write. */
function fakePrisma(over: Partial<{ taken: string[]; failFirst: boolean }> = {}) {
    const taken = new Set(over.taken ?? []);
    const created: Record<string, unknown>[] = [];
    const accounts: Record<string, unknown>[] = [];
    let failedOnce = false;
    const prisma: CoreAdapterClient = {
        user: {
            create: async ({ data }) => {
                if (over.failFirst && !failedOnce) {
                    failedOnce = true;
                    throw Object.assign(new Error("unique"), { code: "P2002", meta: { target: ["username"] } });
                }
                created.push(data);
                return row({ ...(data as Partial<CoreUserRow>), id: "new" }) as CoreUserRow;
            },
            update: async ({ where, data }) => row({ ...(data as Partial<CoreUserRow>), id: where.id }),
            findFirst: async ({ where }) => {
                const { equals, mode } = where.username;
                const held = [...taken].some((name) => (mode === "insensitive" ? name.toLowerCase() === equals.toLowerCase() : name === equals));
                return held ? { id: "other" } : null;
            },
        },
        account: {
            create: async ({ data }) => {
                accounts.push(data);
                return data;
            },
        },
    };
    return { prisma, created, accounts };
}

const emptyBase = {} as Adapter;

describe("toAdapterUser", () => {
    it("presents core columns under the names Auth.js uses", () => {
        expect(toAdapterUser(row())).toMatchObject({
            id: "u1",
            email: "ada@example.com",
            name: "ada",
            image: "https://cdn/a.png",
            emailVerified: null,
        });
    });

    // The row carries a password hash, a ban reason and a lockout counter.
    // None of that should travel with a sign-in.
    it("carries nothing else from the row", async () => {
        const mapped = toAdapterUser({ ...row(), password: "$2a$hash", isBanned: true, roleId: "r1" });
        expect(Object.keys(mapped!).sort()).toEqual(["email", "emailVerified", "id", "image", "name"]);
    });

    it("passes null through", () => {
        expect(toAdapterUser(null)).toBeNull();
        expect(toAdapterUser({ noId: true })).toBeNull();
    });
});

describe("baseUsername", () => {
    it("slugs a display name", () => {
        expect(baseUsername("Ada Lovelace", "ada@example.com")).toBe("Ada_Lovelace");
    });

    it("falls back to the local part when there is no usable name", () => {
        expect(baseUsername("", "ada@example.com")).toBe("ada");
        expect(baseUsername(undefined, "ada@example.com")).toBe("ada");
    });

    it("never returns something the column would reject", () => {
        const slug = baseUsername("!!!", "!!!@example.com");
        expect(slug).not.toBe("");
        expect(slug.length).toBeLessThanOrEqual(24);
    });
});

describe("placeholderEmail", () => {
    it("stays inside the reserved .invalid TLD", () => {
        expect(placeholderEmail(() => "aaaa-bbbb")).toMatch(/^no-email-[a-z0-9]+@users\.invalid$/);
    });

    it("is different every time", () => {
        expect(placeholderEmail()).not.toBe(placeholderEmail());
    });
});

describe("coreAuthAdapter createUser", () => {
    it("writes core's columns, not Auth.js's", async () => {
        const { prisma, created } = fakePrisma();
        const adapter = coreAuthAdapter(emptyBase, prisma);

        await adapter.createUser!({
            id: "ignored",
            name: "Ada Lovelace",
            email: "ada@example.com",
            emailVerified: null,
            image: "https://cdn/a.png",
        } as AdapterUser);

        expect(created[0]).toEqual({
            email: "ada@example.com",
            username: "Ada_Lovelace",
            avatar: "https://cdn/a.png",
            emailVerified: null,
        });
        expect(created[0]).not.toHaveProperty("name");
        expect(created[0]).not.toHaveProperty("image");
    });

    it("synthesises an undeliverable address when the provider gives none", async () => {
        const { prisma, created } = fakePrisma();
        const adapter = coreAuthAdapter(emptyBase, prisma);

        await adapter.createUser!({ id: "x", name: "Thrall", email: "", emailVerified: null } as AdapterUser);

        expect(created[0].email).toMatch(/@users\.invalid$/);
        expect(created[0].username).toBe("Thrall");
    });

    it("never marks a placeholder address as verified", async () => {
        const { prisma, created } = fakePrisma();
        const adapter = coreAuthAdapter(emptyBase, prisma);

        await adapter.createUser!({
            id: "x",
            name: "Thrall",
            email: null,
            emailVerified: new Date(),
        } as unknown as AdapterUser);

        expect(created[0].emailVerified).toBeNull();
    });

    it("suffixes a username that is already taken", async () => {
        const { prisma, created } = fakePrisma({ taken: ["ada"] });
        const adapter = coreAuthAdapter(emptyBase, prisma);

        await adapter.createUser!({ id: "x", name: "ada", email: "a@b.co", emailVerified: null } as AdapterUser);

        expect(created[0].username).not.toBe("ada");
        expect(created[0].username).toMatch(/^ada_[0-9a-f]{8}$/);
    });

    // A provider's display name is whatever the person typed there, so
    // signing in with Discord as "Admin" must not hand them the name the
    // site's "admin" already answers to.
    it("suffixes a username somebody holds under another capitalisation", async () => {
        const { prisma, created } = fakePrisma({ taken: ["ada"] });
        const adapter = coreAuthAdapter(emptyBase, prisma);

        await adapter.createUser!({ id: "x", name: "Ada", email: "a@b.co", emailVerified: null } as AdapterUser);

        expect(created[0].username).toMatch(/^Ada_[0-9a-f]{8}$/);
    });

    it("retries when the unique constraint fires between the check and the insert", async () => {
        const { prisma, created } = fakePrisma({ failFirst: true });
        const adapter = coreAuthAdapter(emptyBase, prisma);

        await adapter.createUser!({ id: "x", name: "ada", email: "a@b.co", emailVerified: null } as AdapterUser);

        expect(created).toHaveLength(1);
        expect(created[0].username).toMatch(/^ada_[0-9a-f]{8}$/);
    });
});

describe("coreAuthAdapter linkAccount", () => {
    it("drops fields core's Account model has no column for", async () => {
        const { prisma, accounts } = fakePrisma();
        const adapter = coreAuthAdapter(emptyBase, prisma);

        await adapter.linkAccount!({
            userId: "u1",
            type: "oauth",
            provider: "github",
            providerAccountId: "42",
            access_token: "tok",
            // GitHub really does return this, and Prisma rejects the insert.
            refresh_token_expires_in: 15552000,
        } as unknown as AdapterAccount);

        expect(accounts[0]).toEqual({
            userId: "u1",
            type: "oauth",
            provider: "github",
            providerAccountId: "42",
            access_token: "tok",
        });
    });

    it("keeps only known columns", () => {
        expect(toAccountRow({ provider: "x", nope: 1, expires_at: 5 })).toEqual({ provider: "x", expires_at: 5 });
    });
});

describe("coreAuthAdapter updateUser", () => {
    it("leaves the username alone", async () => {
        const update = vi.fn(async () => row());
        const { prisma } = fakePrisma();
        const adapter = coreAuthAdapter(emptyBase, { ...prisma, user: { ...prisma.user, update } });

        await adapter.updateUser!({ id: "u1", name: "Renamed", image: "https://cdn/b.png" } as AdapterUser);

        expect(update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { avatar: "https://cdn/b.png" } });
    });
});

describe("coreAuthAdapter read paths", () => {
    it("maps whatever the wrapped adapter returns", async () => {
        const base = {
            getUser: async () => row() as unknown as AdapterUser,
            getUserByEmail: async () => null,
            getSessionAndUser: async () => ({
                session: { sessionToken: "s", userId: "u1", expires: new Date() },
                user: row() as unknown as AdapterUser,
            }),
        } as unknown as Adapter;
        const { prisma } = fakePrisma();
        const adapter = coreAuthAdapter(base, prisma);

        expect(await adapter.getUser!("u1")).toMatchObject({ name: "ada", image: "https://cdn/a.png" });
        expect(await adapter.getUserByEmail!("a@b.co")).toBeNull();
        const pair = await adapter.getSessionAndUser!("s");
        expect(pair?.user).toMatchObject({ name: "ada" });
    });

    it("leaves a method the wrapped adapter does not have undefined", () => {
        const { prisma } = fakePrisma();
        expect(coreAuthAdapter(emptyBase, prisma).getUser).toBeUndefined();
    });
});
