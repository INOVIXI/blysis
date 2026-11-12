// @vitest-environment node
/**
 * "Who is online" is a question about a handful of staff, not about every
 * session on the site.
 *
 * The route read every unexpired, unrevoked `UserSession` belonging to any
 * linked staff member and then threw all of it away but the user ids. That was
 * free while the table was empty - nothing wrote to it until sessions were
 * recorded at sign-in - and it is a row per login now, kept until the token
 * expires, which is thirty days for a session that ticked "keep me signed in".
 * A staff member who signs in twice a day for a month is sixty rows read to
 * answer one boolean about them.
 *
 * Asked from the staff side it is one query, bounded by the number of staff,
 * and the database does the existence check.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface Member {
    id: string;
    name: string;
    isActive: boolean;
    order: number;
    user: { id: string; username: string; avatar: string | null } | null;
}

const members: Member[] = [
    { id: "m1", name: "Ada", isActive: true, order: 0, user: { id: "u1", username: "ada", avatar: null } },
    { id: "m2", name: "Grace", isActive: true, order: 1, user: { id: "u2", username: "grace", avatar: null } },
    { id: "m3", name: "Unlinked", isActive: true, order: 2, user: null },
];

/** User ids with a live session behind them. */
let signedIn = new Set<string>(["u2"]);

const userFindMany = vi.fn(
    async (args: { where: { id: { in: string[] }; loginSessions: { some: unknown } }; select: unknown }) => {
        // The relation filter is the whole point: without it this would have to
        // be answered by reading the sessions themselves.
        expect(args.where.loginSessions).toBeTruthy();
        return args.where.id.in.filter((id) => signedIn.has(id)).map((id) => ({ id }));
    },
);

vi.mock("@/core/sdk/server", async () => ({
    // The real translation helpers: a request with no `?locale=` asks nothing more.
    ...(await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations")),
    prisma: {
        staffMember: { findMany: async () => members.filter((m) => m.isActive) },
        user: { findMany: (args: never) => userFindMany(args) },
        userSession: {
            findMany: async () => {
                throw new Error("who is online was answered by reading every session");
            },
        },
    },
    isAdmin: async () => true,
    readJsonBody: async () => ({}),
}));
vi.mock("@/core/sdk/auth", () => ({ auth: async () => null }));

const { GET } = await import("@/modules/staff/api/route");
const { NextRequest } = await import("next/server");

const call = (query: string) => GET(new NextRequest(`http://example.com/api/v1/staff${query}`));

beforeEach(() => {
    signedIn = new Set<string>(["u2"]);
    userFindMany.mockClear();
});

describe("the staff list", () => {
    it("names only the staff with a session behind them when asked who is online", async () => {
        const res = await call("?online=1");
        expect(res.status).toBe(200);
        const body = (await res.json()) as { members: { name: string }[] };
        expect(body.members.map((m) => m.name)).toEqual(["Grace"]);
    });

    it("says nobody is online when nobody is signed in", async () => {
        signedIn = new Set<string>();
        const body = (await (await call("?online=1")).json()) as { members: unknown[] };
        expect(body.members).toHaveLength(0);
    });

    it("does not ask the database at all when the question was not asked", async () => {
        const body = (await (await call("")).json()) as { members: unknown[] };
        expect(body.members).toHaveLength(3);
        expect(userFindMany).not.toHaveBeenCalled();
    });

    it("skips the question when no staff member is linked to an account", async () => {
        const only = members.splice(0, 2);
        try {
            const body = (await (await call("?online=1")).json()) as { members: unknown[] };
            expect(body.members).toHaveLength(0);
            expect(userFindMany).not.toHaveBeenCalled();
        } finally {
            members.unshift(...only);
        }
    });
});
