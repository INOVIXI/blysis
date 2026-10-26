// @vitest-environment node
/**
 * A server is saved the way the form that created it said.
 *
 * The create route wrote the fields it listed and no others, and the list
 * had drifted from the form: the panel's "Active" switch was sent and never
 * written, so a server created switched off went live at once. A server's
 * description and picture are written the same way, on create and on edit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const written: { create: Record<string, unknown> | null; update: Record<string, unknown> | null } = { create: null, update: null };
const body = { value: {} as Record<string, unknown> };

vi.mock("@/core/sdk/server", () => ({
    isAdmin: async () => true,
    encryptSecret: (value: string) => value,
    readJsonBody: async () => body.value,
    prisma: {
        gameServer: {
            create: async (args: { data: Record<string, unknown> }) => { written.create = args.data; return { id: "s1" }; },
            update: async (args: { data: Record<string, unknown> }) => { written.update = args.data; return { id: "s1" }; },
        },
    },
}));
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "admin" } }) }));

beforeEach(() => {
    written.create = null;
    written.update = null;
});

describe("a saved server", () => {
    it("keeps the switch, the description and the picture it was created with", async () => {
        const { POST } = await import("../../../module-sources/servers/api/route");
        body.value = { name: "Survival", host: "play.example.com", isActive: false, description: "One world.", image: "/uploads/s.png" };
        expect((await POST(new Request("http://x/api/v1/servers", { method: "POST" }) as never)).status).toBe(201);
        expect(written.create).toMatchObject({ isActive: false, description: "One world.", image: "/uploads/s.png" });
    });

    it("is active when the form said nothing about it", async () => {
        const { POST } = await import("../../../module-sources/servers/api/route");
        body.value = { name: "Survival", host: "play.example.com" };
        await POST(new Request("http://x/api/v1/servers", { method: "POST" }) as never);
        expect(written.create).toMatchObject({ isActive: true, description: null, image: null });
    });

    it("takes a new description and picture when edited", async () => {
        const { PATCH } = await import("../../../module-sources/servers/api/[id]/route");
        body.value = { description: "Two worlds.", image: null };
        await PATCH(new Request("http://x/api/v1/servers/s1", { method: "PATCH" }) as never, { params: Promise.resolve({ id: "s1" }) } as never);
        expect(written.update).toMatchObject({ description: "Two worlds.", image: null });
    });
});
