// @vitest-environment node
/**
 * A visitor sees the wheel, not the odds behind it.
 *
 * `/api/v1/wheel/prizes` answers everybody: the page needs each segment's
 * name, colour and payout to draw the wheel and label it. It read the rows
 * with no `select`, so every column went out, and one of them is
 * `probability`, the number an operator tunes to decide how often a prize is
 * drawn. The public page has never read it: it appears once, in the interface
 * the file declares, and nowhere else.
 *
 * It is not a secret in the sense a token is, and this is not a breach. It is
 * a number an operator set in an admin screen and would not expect a visitor
 * to be able to read, and the wheel draws exactly the same without it.
 *
 * An administrator still gets everything, because the screen that edits the
 * odds is the reason they exist.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Rows the database would return, projected the way Prisma projects them: a
 * mock that ignores `select` cannot tell whether a field was asked for, which
 * is the whole question here.
 */
let rows: Record<string, unknown>[] = [];
const findMany = vi.fn(async (args: { select?: Record<string, boolean> }) => {
    const select = args?.select;
    if (!select) return rows;
    return rows.map((row) =>
        Object.fromEntries(Object.entries(row).filter(([key]) => select[key])),
    );
});
const isAdmin = vi.fn(async () => false);

vi.mock("@/core/sdk/server", async () => ({
    ...(await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations")),
    prisma: {
        wheelPrize: { findMany: (args: unknown) => findMany(args as never) },
        // The editor's answer carries each label's languages; there are none here.
        contentTranslation: { findMany: async () => [] },
    },
    isAdmin: (...args: unknown[]) => isAdmin(...(args as [])),
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    readJsonBody: async (request: Request) => request.json(),
}));

const session = vi.fn(async () => null as unknown);
vi.mock("@/core/sdk/auth", () => ({ auth: () => session() }));

const { GET } = await import("@/modules/wheel/api/prizes/route");

/** What the route asked the database for. */
function asked(): Record<string, unknown> {
    return (findMany.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
}

const PRIZE = {
    id: "p1", name: "100 credits", type: "credits", value: 100,
    color: "#3b82f6", probability: 5, isActive: true, order: 0,
};

beforeEach(() => {
    vi.clearAllMocks();
    rows = [PRIZE];
    isAdmin.mockResolvedValue(false);
    session.mockResolvedValue(null);
});

describe("the wheel a visitor is shown", () => {
    it("carries what it takes to draw a segment", async () => {
        const res = await GET(new Request("http://x/api/v1/wheel/prizes") as never);
        const body = (await res.json()) as { prizes: Record<string, unknown>[] };
        expect(body.prizes[0]).toMatchObject({ name: "100 credits", color: "#3b82f6", value: 100 });
    });

    it("does not carry how often that segment wins", async () => {
        const res = await GET(new Request("http://x/api/v1/wheel/prizes") as never);
        const body = (await res.json()) as { prizes: Record<string, unknown>[] };
        expect(Object.keys(body.prizes[0]!)).not.toContain("probability");
    });

    it("asks the database for no more than it hands out", async () => {
        await GET(new Request("http://x/api/v1/wheel/prizes") as never);
        expect(asked().select).toBeDefined();
        expect(Object.keys(asked().select as object)).not.toContain("probability");
    });

    it("still shows an administrator the odds they set", async () => {
        session.mockResolvedValue({ user: { id: "admin-1" } });
        isAdmin.mockResolvedValue(true);
        const res = await GET(new Request("http://x/api/v1/wheel/prizes") as never);
        const body = (await res.json()) as { prizes: Record<string, unknown>[] };
        expect(body.prizes[0]).toHaveProperty("probability", 5);
    });
});
