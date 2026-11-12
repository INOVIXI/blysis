// @vitest-environment node
/**
 * Every prize set to zero took the wheel down.
 *
 * The draw is weighted: it sums each active prize's `probability` and picks a
 * point inside that sum with `randomInt(0, Math.ceil(total * 1000))`. Zero is
 * a probability the admin screen accepts and the schema stores, so an
 * operator who has switched a prize off by setting its odds to zero, and done
 * that to all of them, leaves a total of zero. `randomInt(0, 0)` does not
 * return zero: it throws ERR_OUT_OF_RANGE, so every spin answered 500.
 *
 * No money is lost, because the debit happens in the transaction after the
 * draw. What is lost is the answer: the route already tells a visitor when
 * there are no prizes and when they have spun today, and this case said
 * nothing an operator or a visitor could act on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let prizes: { id: string; name: string; type: string; value: number; probability: number }[] = [];

const findFirst = vi.fn(async () => null as unknown);
const findMany = vi.fn(async () => prizes);
const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
        user: { updateMany: async () => ({ count: 1 }), update: async () => ({}) },
        creditTransaction: { create: async () => ({}) },
        wheelSpin: { create: async () => ({}), findFirst: async () => null },
        $executeRaw: async () => 1,
    }),
);

vi.mock("@/core/sdk/server", async () => ({
    ...(await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations")),
    prisma: {
        // The prizes belong to a wheel now, and the wheel carries the rules
        // the route used to read from a module setting.
        wheel: {
            findFirst: async () => ({
                id: "w1",
                name: "Wheel of Fortune",
                slug: "wheel",
                cooldown: "daily",
                cooldownHours: 24,
                cost: 0,
                roleIds: [],
                isActive: true,
                prizes,
            }),
        },
        wheelSpin: { findFirst: () => findFirst(), create: async () => ({}) },
        wheelPrize: { findMany: () => findMany() },
        user: { findUnique: async () => ({ creditBalance: 1000, roleId: "member" }) },
        activityFeedItem: { create: async () => ({}) },
        // The won prize is named back in the reader's language.
        contentTranslation: {
            findMany: async ({ where }: { where: { locale?: string } }) =>
                [{ owner: "wheel", entity: "prize", recordId: "a", field: "name", locale: "en", text: "Ten credits" }]
                    .filter((row) => !where.locale || row.locale === where.locale),
        },
        $transaction: (fn: (tx: unknown) => Promise<unknown>) => transaction(fn),
    },
    moduleSettings: async () => ({}),
    rateLimitForRoleAsync: async () => true,
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "u1", role: "user" } }) }));

async function spin(query = "") {
    const route = await import("@/modules/wheel/api/spin/route");
    // `?wheel=` names which one; without it the route takes the first, which
    // is what an install with a single wheel means by "the wheel".
    return route.POST(new Request(`http://x/api/v1/wheel/spin${query}`) as never);
}

describe("a wheel whose prizes all have zero odds", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("answers, rather than throwing", async () => {
        prizes = [
            { id: "a", name: "Nothing", type: "none", value: 0, probability: 0 },
            { id: "b", name: "Also nothing", type: "none", value: 0, probability: 0 },
        ];
        const res = await spin();
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBeTruthy();
    });

    it("draws nothing, so no spin is recorded", async () => {
        prizes = [{ id: "a", name: "Nothing", type: "none", value: 0, probability: 0 }];
        await spin();
        expect(transaction).not.toHaveBeenCalled();
    });

    it("still draws when the odds are set", async () => {
        prizes = [{ id: "a", name: "Credits", type: "credits", value: 10, probability: 100 }];
        const res = await spin();
        expect(res.status).toBe(200);
    });

    it("names the prize won in the reader's language, and the original in one it has none in", async () => {
        prizes = [{ id: "a", name: "On kredi", type: "credits", value: 10, probability: 100 }];
        expect((await (await spin("?locale=en")).json()).prize.name).toBe("Ten credits");
        expect((await (await spin("?locale=de")).json()).prize.name).toBe("On kredi");
    });
});
