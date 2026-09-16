// @vitest-environment node
/**
 * A session the user can see and revoke has to be recorded when it is created.
 *
 * `UserSession` is the table behind the profile's device list, behind "sign
 * out this device" and "sign out everywhere", behind the jwt callback's
 * revocation check, and behind the staff module's "who is online". Five
 * readers, and not one writer: nothing in the tree ever called
 * `userSession.create`. The `jwt` callback minted `token.tokenId` for "session
 * tracking" and no row was ever tracked under it.
 *
 * So the device list was permanently empty, both revoke buttons updated zero
 * rows, `sess?.isRevoked` could never be true, and no staff member was ever
 * online. A security control that answers "nothing to sign out" whatever the
 * user does is worse than an absent one, because the screen says it worked.
 *
 * The loop is closed at the only moment that knows a login happened: the `jwt`
 * callback's `user` branch, which runs once per sign-in and holds the token id
 * the revocation check looks up.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

interface Row {
    id: string;
    tokenId: string;
    userId: string;
    deviceInfo: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    lastActiveAt: Date;
    createdAt: Date;
    expiresAt: Date;
    isRevoked: boolean;
}

const rows: Row[] = [];
let createThrows: Error | null = null;
let updateThrows: Error | null = null;
const logError = vi.fn();

/**
 * The table, stood up behind the queries rather than described by a stub that
 * answers the same thing whatever it is asked.
 */
const userSession = {
    create: async ({ data }: { data: Partial<Row> & { tokenId: string; userId: string; expiresAt: Date } }) => {
        if (createThrows) throw createThrows;
        if (rows.some((r) => r.tokenId === data.tokenId)) throw new Error("unique constraint: tokenId");
        const now = new Date();
        const row: Row = {
            id: `s${rows.length + 1}`,
            deviceInfo: null,
            ipAddress: null,
            userAgent: null,
            lastActiveAt: now,
            createdAt: now,
            isRevoked: false,
            ...data,
        } as Row;
        rows.push(row);
        return row;
    },
    updateMany: async ({ where, data }: { where: { tokenId: string }; data: Partial<Row> }) => {
        if (updateThrows) throw updateThrows;
        const hit = rows.filter((r) => r.tokenId === where.tokenId);
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
    },
    findMany: async ({
        where,
        orderBy,
    }: {
        where: { userId: string; isRevoked: boolean; expiresAt: { gt: Date } };
        orderBy: { lastActiveAt: "desc" };
    }) => {
        const found = rows.filter(
            (r) =>
                r.userId === where.userId &&
                r.isRevoked === where.isRevoked &&
                r.expiresAt.getTime() > where.expiresAt.gt.getTime(),
        );
        found.sort((a, b) =>
            orderBy.lastActiveAt === "desc"
                ? b.lastActiveAt.getTime() - a.lastActiveAt.getTime()
                : a.lastActiveAt.getTime() - b.lastActiveAt.getTime(),
        );
        return found;
    },
};

vi.mock("@/core/lib/db", () => ({ prisma: { userSession }, default: { userSession } }));
vi.mock("@/core/lib/auth", () => ({ auth: async () => ({ user: { id: "u1", role: "member" } }) }));
vi.mock("@/core/lib/logger", () => ({
    log: { error: logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const { recordSignIn, touchSession } = await import("@/core/lib/session-registry");
const { GET } = await import("@/app/api/v1/sessions/route");

const HOUR = 60 * 60 * 1000;

async function listedDevices(): Promise<{ ipAddress: string | null; userAgent: string | null }[]> {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: { ipAddress: string | null; userAgent: string | null }[] };
    return body.sessions;
}

function signIn(over: Partial<Parameters<typeof recordSignIn>[0]> = {}) {
    return recordSignIn({
        tokenId: "token-1",
        userId: "u1",
        expiresAt: new Date(Date.now() + 24 * HOUR),
        ipAddress: "203.0.113.7",
        userAgent: "Mozilla/5.0 (iPhone)",
        ...over,
    });
}

beforeEach(() => {
    rows.length = 0;
    createThrows = null;
    updateThrows = null;
    logError.mockClear();
});

describe("the device list", () => {
    it("is empty until somebody signs in", async () => {
        expect(await listedDevices()).toHaveLength(0);
    });

    it("shows the device that just signed in", async () => {
        await signIn();
        const devices = await listedDevices();
        expect(devices).toHaveLength(1);
        expect(devices[0].ipAddress).toBe("203.0.113.7");
        expect(devices[0].userAgent).toBe("Mozilla/5.0 (iPhone)");
    });

    it("shows one row per sign-in, so each device can be signed out on its own", async () => {
        await signIn({ tokenId: "token-1", userAgent: "phone" });
        await signIn({ tokenId: "token-2", userAgent: "laptop" });
        expect(await listedDevices()).toHaveLength(2);
    });

    it("does not show somebody else's device", async () => {
        await signIn({ userId: "u2" });
        expect(await listedDevices()).toHaveLength(0);
    });

    it("does not show a session that has been revoked or has expired", async () => {
        await signIn({ tokenId: "revoked" });
        await signIn({ tokenId: "expired", expiresAt: new Date(Date.now() - HOUR) });
        rows.find((r) => r.tokenId === "revoked")!.isRevoked = true;
        expect(await listedDevices()).toHaveLength(0);
    });

    it("leaves the device label to the browser, which is the side that can translate it", async () => {
        // `deviceInfo` is rendered as-is when set, so a label written here
        // would be an English string on a Turkish screen. The client derives
        // one from the user agent through its own translations instead.
        await signIn();
        expect(rows[0].deviceInfo).toBeNull();
    });
});

describe("a sign-in that cannot be written down", () => {
    it("does not take the sign-in down with it", async () => {
        createThrows = new Error("connection terminated");
        await expect(signIn()).resolves.toBeUndefined();
    });

    it("says so, because the user is now holding a session nothing can revoke", async () => {
        createThrows = new Error("connection terminated");
        await signIn();
        expect(logError).toHaveBeenCalled();
    });
});

describe("last active", () => {
    it("moves when the session is seen again", async () => {
        await signIn();
        const before = rows[0].lastActiveAt.getTime();
        await touchSession("token-1", new Date(before + 5 * HOUR));
        expect(rows[0].lastActiveAt.getTime()).toBe(before + 5 * HOUR);
    });

    it("orders the list by it, so the device in the user's hand is at the top", async () => {
        await signIn({ tokenId: "old", userAgent: "old" });
        await signIn({ tokenId: "new", userAgent: "new" });
        await touchSession("old", new Date(Date.now() + HOUR));
        expect((await listedDevices())[0].userAgent).toBe("old");
    });

    it("is silent about a token with no row, which is every token minted before this existed", async () => {
        await expect(touchSession("never-recorded")).resolves.toBeUndefined();
        expect(logError).not.toHaveBeenCalled();
    });

    it("does not fail the request when the database refuses the update", async () => {
        // This runs inside the jwt callback, which decides whether the caller
        // is still signed in. Throwing here would sign out everyone the moment
        // one write failed.
        await signIn();
        updateThrows = new Error("deadlock detected");
        await expect(touchSession("token-1")).resolves.toBeUndefined();
        expect(logError).toHaveBeenCalled();
    });
});

describe("the jwt callback", () => {
    // Comments describe the defect at length in these files; matching against
    // them would pass on the prose rather than on the code. This has caught me
    // three times now.
    const code = (p: string) =>
        stripComments(fs.readFileSync(path.join(process.cwd(), p), "utf8"));

    const AUTH = code("src/core/lib/auth.ts");

    it("writes the row down in the branch that runs once per sign-in", () => {
        const branch = AUTH.slice(AUTH.indexOf("token.tokenId = crypto.randomUUID();"));
        const untilRecheck = branch.slice(0, branch.indexOf("shouldRecheckSession"));
        expect(untilRecheck).toContain("recordSignIn(");
        expect(untilRecheck).toContain("token.tokenId");
    });

    it("keeps the address it recorded against the login for the device row too", () => {
        // The `jwt` callback never sees the request, so the only place the
        // address and the user agent exist is `authorize`, which carries them
        // out on the user object the way `remember` already travels.
        expect(AUTH).toContain("signInIp");
        expect(AUTH).toContain("signInUserAgent");
    });
});
