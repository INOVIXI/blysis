// @vitest-environment node
/**
 * A server can carry a line about it and a picture of it.
 *
 * A homepage that offers its game modes as cards needs to say what each one
 * is and show it, and the server row had neither. Both are what an operator
 * types or uploads, so both are held to what a page can safely show: a
 * picture is an address on this site or an http(s) one, never a script and
 * never one that only looks like a path on this site.
 */
import { describe, it, expect } from "vitest";
import { serverCreateSchema } from "@/modules/servers/lib/validations";
import { SERVER_PUBLIC_FIELDS } from "@/modules/servers/lib/server-fields";

const BASE = { name: "Survival", host: "play.example.com" };

describe("a server's description and picture", () => {
    it("are taken as the operator gives them", () => {
        const parsed = serverCreateSchema.safeParse({ ...BASE, description: "One world, a real economy.", image: "/uploads/survival.png" });
        expect(parsed.success).toBe(true);
        expect(serverCreateSchema.safeParse({ ...BASE, image: "https://cdn.example.com/survival.png" }).success).toBe(true);
        expect(serverCreateSchema.safeParse({ ...BASE, description: null, image: null }).success).toBe(true);
    });

    it("keep a picture to an address a page may show", () => {
        for (const image of ["javascript:alert(1)", "//evil.example/a.png", "/\\evil.example/a.png", "data:text/html,x"]) {
            expect(serverCreateSchema.safeParse({ ...BASE, image }).success, image).toBe(false);
        }
    });

    it("keep the description short enough for a card", () => {
        expect(serverCreateSchema.safeParse({ ...BASE, description: "x".repeat(301) }).success).toBe(false);
    });

    it("are told to a visitor", () => {
        expect(SERVER_PUBLIC_FIELDS).toMatchObject({ description: true, image: true });
    });
});
