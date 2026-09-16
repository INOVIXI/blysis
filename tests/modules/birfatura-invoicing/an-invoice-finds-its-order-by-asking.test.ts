/**
 * The invoicing module asks the shop which order it means.
 *
 * Every other read it needs already goes through `store.orders.collect`. The
 * one that came back - the integrator telling us which invoice it issued -
 * still queried `Order` itself, so a module about tax documents knew the
 * shop's primary key, its human-facing order number and the integer column
 * that only exists because an integrator needed one. That is the coupling the
 * ownership rule exists to stop, and it is worse here than elsewhere: the
 * shop is replaceable, and a second shop would have left this endpoint
 * resolving nothing while answering 404 to a caller that was right.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const MODULE = path.join(process.cwd(), "module-sources/birfatura-invoicing");
const STORE = path.join(process.cwd(), "module-sources/store");

function read(root: string, ...parts: string[]): string {
    return fs.readFileSync(path.join(root, ...parts), "utf8");
}

describe("the endpoint that records an invoice", () => {
    const route = read(MODULE, "api/api/invoiceLinkUpdate/route.ts");

    it("asks the shop rather than reading its table", () => {
        expect(route).not.toMatch(/prisma\.order\./);
        expect(route).toContain('applyFiltersAsync("store.order.resolve"');
    });

    it("declares the socket it asks through", () => {
        const manifest = JSON.parse(read(MODULE, "module.json"));
        const emitted = manifest.hooksEmitted.map((h: { hook: string }) => h.hook);
        expect(emitted).toContain("store.order.resolve");
    });

    it("still writes only its own table", () => {
        expect(route).toContain("prisma.shopInvoice.upsert");
    });
});

describe("the shop answers it", () => {
    it("declares the listener and ships the handler", () => {
        const manifest = JSON.parse(read(STORE, "module.json"));
        const listener = manifest.hookListeners.find(
            (h: { hook: string }) => h.hook === "store.order.resolve",
        );
        expect(listener).toBeTruthy();
        expect(listener.type).toBe("filter");
        expect(fs.existsSync(path.join(STORE, listener.handler))).toBe(true);
    });

    it("answers all three ways an order can be named, and null for none of them", () => {
        const handler = read(STORE, "hooks/resolve-order.ts");
        expect(handler).toContain("number:");
        expect(handler).toContain("orderNumber:");
        expect(handler).toContain("id:");
        expect(handler).toContain("null");
    });
});
