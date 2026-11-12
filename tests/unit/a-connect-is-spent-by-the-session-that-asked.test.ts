import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The server half of connecting a sign-in method, run against an in-memory
 * database: the note a connect writes is spent once, by the live session
 * that wrote it, and by nothing else.
 *
 * `a-sign-in-method-joins-the-account-that-asked` holds the decision itself;
 * this holds the facts the gate feeds it, which is where a link to the wrong
 * account would actually come from: a note read by another session, a note
 * read twice, a revoked session still counted as signed in.
 */

interface AccountRow { id: string; userId: string; provider: string; providerAccountId: string; displayName: string | null; connectedAt: Date | null }
interface NoteRow { identifier: string; token: string; expires: Date }

const db = {
    accounts: [] as AccountRow[],
    notes: [] as NoteRow[],
    sessions: new Map<string, { isRevoked: boolean }>(),
    users: new Map<string, { password: string | null }>(),
    setting: null as unknown,
    settingThrows: false,
};

const noteMatches = (row: NoteRow, where: { identifier: string; token: string; expires?: { gt: Date } }) =>
    row.identifier === where.identifier && row.token === where.token &&
    (!where.expires || row.expires.getTime() > where.expires.gt.getTime());

const prisma = {
    account: {
        findUnique: async ({ where }: { where: { provider_providerAccountId: { provider: string; providerAccountId: string } } }) => {
            const key = where.provider_providerAccountId;
            const row = db.accounts.find((a) => a.provider === key.provider && a.providerAccountId === key.providerAccountId);
            return row ? { userId: row.userId } : null;
        },
        count: async ({ where }: { where: { userId: string; provider: string } }) =>
            db.accounts.filter((a) => a.userId === where.userId && a.provider === where.provider).length,
        findMany: async ({ where }: { where: { userId: string } }) =>
            db.accounts.filter((a) => a.userId === where.userId),
        delete: async ({ where }: { where: { id: string } }) => {
            db.accounts = db.accounts.filter((a) => a.id !== where.id);
        },
    },
    verificationToken: {
        deleteMany: async ({ where }: { where: { identifier: string; token: string; expires?: { gt: Date } } }) => {
            const before = db.notes.length;
            db.notes = db.notes.filter((row) => !noteMatches(row, where));
            return { count: before - db.notes.length };
        },
        create: async ({ data }: { data: NoteRow }) => {
            db.notes.push(data);
            return data;
        },
    },
    userSession: {
        findUnique: async ({ where }: { where: { tokenId: string } }) => db.sessions.get(where.tokenId) ?? null,
    },
    user: {
        findUnique: async ({ where }: { where: { id: string } }) => db.users.get(where.id) ?? null,
    },
    setting: {
        findUnique: async () => {
            if (db.settingThrows) throw new Error("db down");
            return db.setting === null ? null : { value: db.setting };
        },
    },
    $queryRaw: async () => [],
    $transaction: async (work: unknown) => {
        if (Array.isArray(work)) return Promise.all(work);
        return (work as (tx: typeof prisma) => Promise<unknown>)(prisma);
    },
};

let caller: Record<string, unknown> | null = null;
let states: Record<string, boolean> | Error = {};

vi.mock("@/core/lib/db", () => ({ prisma, default: prisma }));
vi.mock("@/core/lib/session-registry", () => ({ callerToken: async () => caller }));
vi.mock("@/core/lib/module-cache", () => ({
    getModuleStates: async () => {
        if (states instanceof Error) throw states;
        return states;
    },
}));
vi.mock("@/core/generated/module-auth-declarations", () => ({
    ModuleAuthDeclarations: [
        { id: "alpha", envIdVar: "T_ALPHA_ID", envSecretVar: "T_ALPHA_SECRET", module: "alpha-auth" },
        { id: "beta", factory: "auth/beta.ts", envVars: ["T_BETA_KEY"], module: "beta-auth" },
        { id: "gamma", factory: "auth/gamma.ts", standardCallback: true, envVars: ["T_GAMMA_KEY"], module: "gamma-auth" },
        { id: "delta", envIdVar: "T_DELTA_ID", envSecretVar: "T_DELTA_SECRET", module: "delta-auth" },
    ],
}));

const lib = await import("@/core/lib/sign-in-methods");
const headers = new Headers();

const signedIn = (over: Record<string, unknown> = {}) => ({
    sub: "m1",
    id: "m1",
    role: "member",
    tokenId: "t1",
    absoluteExpiry: Date.now() + 60_000,
    ...over,
});

function gate(providerAccountId = "p-42", provider = "alpha") {
    return lib.oauthSignInGate({ provider, providerAccountId, headers });
}

beforeEach(() => {
    db.accounts = [];
    db.notes = [];
    db.sessions = new Map([["t1", { isRevoked: false }], ["t2", { isRevoked: false }]]);
    db.users = new Map([["m1", { password: "hash" }], ["m2", { password: null }]]);
    db.setting = null;
    db.settingThrows = false;
    caller = null;
    states = {};
});

describe("a connect note", () => {
    it("links when the session that wrote it comes back, and only once", async () => {
        await lib.startConnect("m1", "t1", "alpha");
        caller = signedIn();
        expect(await gate()).toEqual({ refusal: null, memberId: "m1" });
        expect(await gate()).toEqual({ refusal: "not_started", memberId: "m1" });
    });

    it("is not read by another session of the same member", async () => {
        await lib.startConnect("m1", "t1", "alpha");
        caller = signedIn({ tokenId: "t2" });
        expect((await gate()).refusal).toBe("not_started");
    });

    it("is not read for another provider", async () => {
        await lib.startConnect("m1", "t1", "alpha");
        caller = signedIn();
        expect((await gate("p-42", "gamma")).refusal).toBe("not_started");
    });

    it("counts for nothing once the session is revoked or past its deadline", async () => {
        await lib.startConnect("m1", "t1", "alpha");
        db.sessions.set("t1", { isRevoked: true });
        caller = signedIn();
        expect((await gate()).refusal).toBe("not_started");

        db.sessions.set("t1", { isRevoked: false });
        caller = signedIn({ absoluteExpiry: Date.now() - 1000 });
        expect((await gate()).refusal).toBe("not_started");

        caller = signedIn({ tokenId: "unknown" });
        expect((await gate()).refusal).toBe("not_started");
    });

    it("is not spent by a session that cannot name itself", async () => {
        await lib.startConnect("m1", "t1", "alpha");
        caller = { sub: "m1" };
        expect((await gate()).refusal).toBe("not_started");
        caller = signedIn();
        expect((await gate()).refusal).toBeNull();
    });

    it("does not add a second account from a provider the member already holds", async () => {
        db.accounts.push({ id: "a1", userId: "m1", provider: "alpha", providerAccountId: "p-1", displayName: null, connectedAt: null });
        await lib.startConnect("m1", "t1", "alpha");
        caller = signedIn();
        expect((await gate("p-2")).refusal).toBe("already_connected");
    });

    it("is never spent while an admin acts as a member", async () => {
        await lib.startConnect("m1", "t1", "alpha");
        caller = signedIn({ originalUserId: "admin" });
        expect((await gate()).refusal).toBe("impersonating");
        caller = signedIn();
        expect((await gate()).refusal).toBeNull();
    });
});

describe("a provider account somebody holds", () => {
    beforeEach(() => {
        db.accounts.push({ id: "a1", userId: "m2", provider: "alpha", providerAccountId: "p-42", displayName: null, connectedAt: null });
    });

    it("signs its holder in", async () => {
        expect(await gate()).toEqual({ refusal: null, memberId: "m2" });
    });

    it("is not moved to somebody else who is signed in, connect or not", async () => {
        await lib.startConnect("m1", "t1", "alpha");
        caller = signedIn();
        expect((await gate()).refusal).toBe("taken");
        // The note was not spent on a refusal it could not change.
        expect(db.notes).toHaveLength(1);
    });
});

describe("a provider account nobody holds, nobody signed in", () => {
    it("makes an account on a site that never chose", async () => {
        expect(await gate()).toEqual({ refusal: null, memberId: null });
    });

    it("is told to connect first on a site that closed sign-ups", async () => {
        db.setting = "false";
        expect((await gate()).refusal).toBe("connect_first");
    });

    it("is told the same when the setting cannot be read", async () => {
        db.settingThrows = true;
        expect((await gate()).refusal).toBe("connect_first");
    });
});

describe("sessionToKeep", () => {
    it("keeps the live session of the member it lands on", async () => {
        caller = signedIn();
        expect(await lib.sessionToKeep("m1", headers)).toEqual(caller);
    });

    it("keeps nothing that is somebody else's, stale, unnamed or an impersonation", async () => {
        caller = signedIn();
        expect(await lib.sessionToKeep("m2", headers)).toBeNull();
        db.sessions.set("t1", { isRevoked: true });
        expect(await lib.sessionToKeep("m1", headers)).toBeNull();
        caller = { sub: "m1" };
        expect(await lib.sessionToKeep("m1", headers)).toBeNull();
        caller = signedIn({ tokenId: "t2", originalUserId: "admin" });
        expect(await lib.sessionToKeep("m1", headers)).toBeNull();
        caller = null;
        expect(await lib.sessionToKeep("m1", headers)).toBeNull();
    });

    it("keeps nothing short of a whole token", async () => {
        db.sessions.set("t1", { isRevoked: false });
        for (const missing of ["id", "role", "absoluteExpiry"]) {
            const token: Record<string, unknown> = signedIn();
            delete token[missing];
            caller = token;
            expect(await lib.sessionToKeep("m1", headers), missing).toBeNull();
        }
    });
});

describe("connectableProviders", () => {
    it("offers what is on, configured and comes back through Auth.js", async () => {
        vi.stubEnv("T_ALPHA_ID", "id");
        vi.stubEnv("T_ALPHA_SECRET", "secret");
        vi.stubEnv("T_BETA_KEY", "key");
        vi.stubEnv("T_GAMMA_KEY", "key");
        states = { "alpha-auth": true, "beta-auth": true, "gamma-auth": true, "delta-auth": true };
        // delta has no credentials; beta runs its own flow and never reaches
        // the callback that links.
        expect(await lib.connectableProviders()).toEqual(["alpha", "gamma"]);

        states = { "alpha-auth": false, "gamma-auth": true };
        expect(await lib.connectableProviders()).toEqual(["gamma"]);
        vi.unstubAllEnvs();
    });

    it("offers nothing when it cannot tell what is switched on", async () => {
        states = new Error("db down");
        expect(await lib.connectableProviders()).toEqual([]);
    });
});

describe("disconnectSignInMethod", () => {
    const own = (userId: string, provider: string): AccountRow =>
        ({ id: `${userId}-${provider}`, userId, provider, providerAccountId: `${provider}-id`, displayName: null, connectedAt: null });

    it("removes a method from a member who still has a password", async () => {
        db.accounts.push(own("m1", "alpha"));
        expect(await lib.disconnectSignInMethod("m1", "alpha")).toEqual({ ok: true, providerAccountId: "alpha-id" });
        expect(await lib.signInMethodsOf("m1")).toEqual([]);
    });

    it("keeps the last way into an account with no password", async () => {
        db.accounts.push(own("m2", "alpha"));
        expect(await lib.disconnectSignInMethod("m2", "alpha")).toEqual({ ok: false, code: "last_sign_in_method" });
        db.accounts.push(own("m2", "gamma"));
        expect((await lib.disconnectSignInMethod("m2", "alpha")).ok).toBe(true);
        expect(await lib.disconnectSignInMethod("m2", "gamma")).toEqual({ ok: false, code: "last_sign_in_method" });
    });

    it("answers not found for what is not there or nobody", async () => {
        expect(await lib.disconnectSignInMethod("m1", "alpha")).toEqual({ ok: false, code: "not_found" });
        expect(await lib.disconnectSignInMethod("ghost", "alpha")).toEqual({ ok: false, code: "not_found" });
    });

    it("tells a member with a password from one without", async () => {
        expect(await lib.hasPassword("m1")).toBe(true);
        expect(await lib.hasPassword("m2")).toBe(false);
        expect(await lib.hasPassword("ghost")).toBe(false);
    });
});
