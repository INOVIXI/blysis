// @vitest-environment node
/**
 * The module status list answers an admin, or a caller holding the secret.
 *
 * `GET /api/v1/modules/status` skips the admin check for a server-to-server
 * call that sends `x-internal-request`. With `INTERNAL_API_SECRET` set, the
 * header has to match it. With the secret unset, which is how every install
 * starts, the route accepted the literal `1` instead, so anybody who sent
 * `x-internal-request: 1` read which modules the site runs without signing
 * in. `.env.example` says leaving the secret unset disables the internal
 * path; it now does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/core/lib/db", () => ({
    prisma: { moduleConfig: { findMany: async () => [{ id: "shop", enabled: true }] } },
}));
vi.mock("@/core/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/core/lib/permissions", () => ({ isAdmin: async () => false }));

const { GET } = await import("@/app/api/v1/modules/status/route");

const ask = (header?: string) =>
    GET(
        new NextRequest("http://localhost/api/v1/modules/status", {
            headers: header === undefined ? {} : { "x-internal-request": header },
        }),
    );

describe("the module status list", () => {
    const saved = process.env.INTERNAL_API_SECRET;
    beforeEach(() => {
        delete process.env.INTERNAL_API_SECRET;
    });
    afterEach(() => {
        if (saved === undefined) delete process.env.INTERNAL_API_SECRET;
        else process.env.INTERNAL_API_SECRET = saved;
    });

    it("refuses a stranger", async () => {
        expect((await ask()).status).toBe(401);
    });

    it("refuses a stranger who claims to be internal while no secret is set", async () => {
        expect((await ask("1")).status).toBe(401);
    });

    it("answers a caller holding the secret", async () => {
        process.env.INTERNAL_API_SECRET = "a-long-shared-secret";
        const res = await ask("a-long-shared-secret");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ modules: { shop: true } });
    });

    it("refuses a caller holding the wrong one", async () => {
        process.env.INTERNAL_API_SECRET = "a-long-shared-secret";
        expect((await ask("a-long-shared-secreT")).status).toBe(401);
    });
});
