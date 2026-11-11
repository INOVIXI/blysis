// @vitest-environment node
/**
 * The public wheel listing answers one shape, whoever is reading.
 *
 * `/api/v1/wheel/wheels` used to answer two different things at one address:
 * a visitor got each wheel with its prizes, its cooldown and whether they may
 * turn it, and an administrator got the raw rows the admin screen edits -
 * every wheel including the switched-off ones, no prizes, no refusal. The
 * public page reads `wheel.prizes` to list what is on the wheel, so signing in
 * as an administrator and opening /wheel threw a TypeError before the page
 * rendered: the site was broken for exactly the person who has to look at it.
 *
 * The rule this pins is not "include prizes". It is that a public endpoint
 * answers the same question for everybody, and the screen that manages the
 * rows asks somewhere else. An administrator browsing the site is a visitor.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const WHEEL = {
    id: "w1",
    slug: "daily",
    name: "Daily wheel",
    description: null,
    cost: 0,
    cooldown: "daily",
    cooldownHours: 24,
    roleIds: [] as string[],
    isActive: true,
    order: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
};

const PRIZE = { id: "p1", name: "100 credits", type: "credits", value: 100, color: "#3b82f6" };

/**
 * Prisma only returns a relation that was asked for. A mock that hands back
 * `prizes` regardless cannot tell whether the route asked for them, which is
 * the whole question here.
 */
const findMany = vi.fn(async (args: { include?: { prizes?: unknown } }) =>
    args?.include?.prizes ? [{ ...WHEEL, prizes: [PRIZE] }] : [WHEEL],
);
const isAdmin = vi.fn(async () => false);

vi.mock("@/core/sdk/server", async () => ({
    ...(await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations")),
    prisma: {
        wheel: { findMany: (args: unknown) => findMany(args as never) },
        user: { findUnique: async () => ({ creditBalance: 0, roleId: null }) },
        wheelSpin: { groupBy: async () => [] },
    },
    isAdmin: (...args: unknown[]) => isAdmin(...(args as [])),
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    readJsonBody: async (request: Request) => request.json(),
}));

const session = vi.fn(async () => null as unknown);
vi.mock("@/core/sdk/auth", () => ({ auth: () => session() }));

const { GET } = await import("@/modules/wheel/api/wheels/route");

interface Listed {
    slug: string;
    prizes?: unknown[];
    canTurn?: boolean;
}

async function listed(): Promise<Listed[]> {
    const res = await GET(new Request("http://x/api/v1/wheel/wheels") as never);
    const body = (await res.json()) as { wheels: Listed[] };
    return body.wheels;
}

beforeEach(() => {
    vi.clearAllMocks();
    isAdmin.mockResolvedValue(false);
    session.mockResolvedValue(null);
});

describe("the wheels a page is given", () => {
    it("carries what it takes to draw the wheel", async () => {
        const wheels = await listed();
        expect(wheels[0].prizes).toEqual([PRIZE]);
    });

    it("carries the same for an administrator", async () => {
        session.mockResolvedValue({ user: { id: "admin" } });
        isAdmin.mockResolvedValue(true);

        const wheels = await listed();
        expect(wheels[0].prizes).toEqual([PRIZE]);
        expect(wheels[0].canTurn).toBe(true);
    });
});
