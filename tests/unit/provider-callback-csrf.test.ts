import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "../..");

/**
 * No payment could ever settle.
 *
 * The proxy runs a same-origin CSRF check over every `/api/` request, with
 * three literal exemptions: `/api/auth/`, `/api/v1/webhook/` and
 * `/api/webhook/`. Those match core's own routes and nothing else.
 *
 * A payment gateway is a module, and it ships its callback at whatever path
 * its manifest declares - `/api/v1/mollie/webhook`, `/api/v1/webhooks/stripe`,
 * `/api/v1/paytr/callback`. None of them start with the exempt prefixes, and
 * Stripe's is `/webhooks/` where the gate says `/webhook/`. A payment provider
 * posts server to server, so it sends no Origin and no Referer, which is
 * exactly the shape `checkCsrf` rejects: every one of the twelve gateways was
 * answered 403 before its handler ran. Verified against the running demo,
 * which returned `{"code":"csrf_rejected"}` for all of them.
 *
 * Core cannot know a module's callback paths, so the module declares them.
 */

interface ApiEntry {
    path: string;
    handler: string;
    method?: string;
    providerCallback?: boolean;
}

const modules = fs.readdirSync(path.join(root, "module-sources"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => fs.existsSync(path.join(root, "module-sources", name, "module.json")))
    .map((name) => ({
        name,
        manifest: JSON.parse(
            fs.readFileSync(path.join(root, "module-sources", name, "module.json"), "utf8"),
        ) as { api?: ApiEntry[] },
    }));

/** Paths that read as an inbound callback from an external service. */
const CALLBACK_SHAPED = /webhook|ipn|notify|callback/i;

describe("every gateway callback", () => {
    it("has modules to check", () => {
        expect(modules.length).toBeGreaterThan(50);
    });

    it("is declared as a provider callback", () => {
        const undeclared: string[] = [];
        for (const { name, manifest } of modules) {
            for (const entry of manifest.api ?? []) {
                if (!CALLBACK_SHAPED.test(entry.path)) continue;
                // A browser follows a GET redirect, and the gate lets safe
                // methods through regardless.
                if (entry.method === "GET") continue;
                // An admin screen reading its own delivery log is not a callback.
                const handler = path.join(root, "module-sources", name, entry.handler);
                if (!fs.existsSync(handler)) continue;
                const source = fs.readFileSync(handler, "utf8");
                const inbound = /timingSafeEqual|constructEvent|@provider-callback/.test(source);
                if (!inbound) continue;
                if (!entry.providerCallback) undeclared.push(`${name} ${entry.path}`);
            }
        }
        expect(undeclared).toEqual([]);
    });

    /**
     * What the route does before it settles anything, and what that proves.
     *
     * A comment is not a mechanism. This test used to accept the presence of
     * the `@provider-callback` tag as evidence that the route authenticated
     * its caller, which means a gateway that checked nothing at all would
     * have passed by documenting that it did.
     *
     * There are only two things that actually prove the money is real. Either
     * the route compares a signature the provider computed with a secret only
     * the two of them know, or it throws the posted body away and reads the
     * payment back from the provider over a connection it opened itself, with
     * this site's own credentials. Both must happen before the settle filter
     * runs, because after it the order is already paid.
     *
     * A config read is neither: `getMollieConfig()` loads a row of settings.
     * The call has to reach the provider.
     */
    const proof = (source: string) => {
        const settles = source.indexOf('applyFiltersAsync("payment.');
        const before = settles >= 0 ? source.slice(0, settles) : source;

        if (/timingSafeEqual|constructEvent/.test(before)) return "signature";

        const clients = new Set<string>();
        for (const imported of source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"(\.[^"]*)"/g)) {
            if (!imported[2].includes("lib")) continue;
            for (const raw of imported[1].split(",")) {
                const name = raw.trim().split(" as ").pop()?.trim();
                // `getStripeConfig` reads settings out of the database.
                if (name && !/^get\w*Config$/.test(name)) clients.add(name);
            }
        }
        for (const client of clients) {
            if (new RegExp(`await\\s+${client}\\s*(?:<[^;]*?>)?\\s*\\(`).test(before)) return `read-back via ${client}`;
        }
        return null;
    };

    it("authenticates the request itself, since it skips the origin check", () => {
        const unverified: string[] = [];
        for (const { name, manifest } of modules) {
            for (const entry of (manifest.api ?? []).filter((e) => e.providerCallback)) {
                const handler = path.join(root, "module-sources", name, entry.handler);
                expect(fs.existsSync(handler), `${name} ${entry.path}: handler missing`).toBe(true);
                if (!proof(fs.readFileSync(handler, "utf8"))) unverified.push(`${name} ${entry.path}`);
            }
        }
        expect(unverified).toEqual([]);
    });

    it("says which of the two mechanisms each gateway uses", () => {
        // Not an assertion about any one gateway so much as a check that the
        // reading above distinguishes them, rather than passing everything.
        const mechanisms = new Map<string, string>();
        for (const { name, manifest } of modules) {
            for (const entry of (manifest.api ?? []).filter((e) => e.providerCallback)) {
                const found = proof(fs.readFileSync(path.join(root, "module-sources", name, entry.handler), "utf8"));
                if (found) mechanisms.set(name, found);
            }
        }
        expect([...mechanisms.values()].filter((m) => m === "signature").length).toBeGreaterThan(4);
        expect([...mechanisms.values()].filter((m) => m.startsWith("read-back")).length).toBeGreaterThan(2);
        expect(mechanisms.get("stripe-gateway")).toBe("signature");
        expect(mechanisms.get("mollie-gateway")).toBe("read-back via mollieGet");
    });

    it("still documents the reasoning where there is no signature to check", () => {
        // The tag is not proof, but a read-back gateway is the one a reader is
        // most likely to mistake for an unauthenticated route.
        for (const { name, manifest } of modules) {
            for (const entry of (manifest.api ?? []).filter((e) => e.providerCallback)) {
                const source = fs.readFileSync(path.join(root, "module-sources", name, entry.handler), "utf8");
                if (proof(source)?.startsWith("read-back")) {
                    expect(source, `${name} ${entry.path}`).toContain("@provider-callback");
                }
            }
        }
    });

    it("counts every route let past the CSRF gate", () => {
        // A census, not a fact about the world: each of these is a POST an
        // outside service makes without a session, so the number only moves
        // when somebody decides it should.
        const declared = modules.flatMap(({ name, manifest }) =>
            (manifest.api ?? []).filter((e) => e.providerCallback).map(() => name),
        );
        // Twelve gateways report a payment. Three more belong to the
        // integrator that collects orders rather than being sent them: it
        // reads, it does not report, and it signs in with a shared secret.
        // The sixteenth is the invoice the same integrator sends back once it
        // has issued one.
        //
        // There used to be a seventeenth: a game server's ban plugin posting
        // what it had punished somebody for, in a JSON shape this repo made
        // up. LiteBans does send HTTP - 2.19.0 ships `webhooks.yml` - but it
        // sends a Discord embed whose body is the prose in `messages.yml`,
        // "$playerName has been banned!", carrying no id, no UUID and no
        // timestamps. Nothing it can say fits that endpoint, so the endpoint
        // was a door held open for a caller that does not exist, and the
        // punishments are read out of its database on the scheduler instead.
        // A door into the CSRF gate is worth closing the moment nothing needs
        // it.
        expect(declared.length).toBe(16);
        expect(declared).toContain("stripe-gateway");
        expect(declared).toContain("mollie-gateway");
        expect(declared.filter((name) => name === "birfatura-invoicing")).toHaveLength(4);
        expect(declared).not.toContain("minecraft-litebans");
    });
});

describe("the proxy's CSRF gate", () => {
    const proxy = fs.readFileSync(path.join(root, "src/proxy.ts"), "utf8");

    it("reads the generated provider-callback list", () => {
        expect(proxy).toContain("import { providerCallbackRoutes }");
        expect(proxy).toContain("providerCallbackRoutes.some((route) => route.test(pathname))");
    });

    it("still guards every other API path", () => {
        expect(proxy).toContain("pathname.startsWith('/api/')");
        expect(proxy).toContain("checkCsrf(request)");
    });

    it("exempts only what it means to", () => {
        // If this list grows, the growth should be deliberate.
        const gate = proxy.slice(proxy.indexOf("// ===== CSRF gate ====="), proxy.indexOf("const moduleId ="));
        const literals = [...gate.matchAll(/!pathname\.startsWith\('([^']+)'\)/g)].map((m) => m[1]);
        expect(literals.sort()).toEqual(["/api/auth/", "/api/v1/webhook/", "/api/webhook/"]);
    });
});

describe("the registry generator", () => {
    const generator = fs.readFileSync(path.join(root, "scripts/generate-registry.ts"), "utf8");

    it("emits a pattern only for an endpoint that asked for the exemption", () => {
        expect(generator).toContain("if (api.providerCallback)");
        expect(generator).toContain("export const providerCallbackRoutes: RegExp[] = [");
    });
});

describe("the manifest schema", () => {
    it("accepts the flag", () => {
        const schema = fs.readFileSync(path.join(root, "src/core/lib/module-manifest-schema.ts"), "utf8");
        expect(schema).toContain("providerCallback: z.boolean().optional()");
    });
});
