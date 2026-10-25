import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { moduleManifestSchema } from "@/core/lib/module-manifest-schema";

const base = {
    id: "demo",
    name: "Demo",
    description: "A demo module",
    version: "1.0.0",
    coreVersion: "^1.0.0",
};

describe("moduleManifestSchema - compatibility contract", () => {
    it("accepts a bare dependency id (pre-contract manifests stay valid)", () => {
        const r = moduleManifestSchema.safeParse({ ...base, dependencies: ["store", "currency"] });
        expect(r.success).toBe(true);
    });

    it("accepts an id@range dependency", () => {
        const r = moduleManifestSchema.safeParse({
            ...base,
            dependencies: ["store@^1.2.0", "currency@>=1.0.0 <2.0.0", "credits"],
        });
        expect(r.success).toBe(true);
    });

    it("rejects a dependency whose range is unparseable", () => {
        const r = moduleManifestSchema.safeParse({ ...base, dependencies: ["store@not-a-range"] });
        expect(r.success).toBe(false);
        if (!r.success) {
            expect(r.error.issues[0].message).toMatch(/not a valid semver range/);
        }
    });

    it("rejects a dependency id that is not a slug", () => {
        for (const bad of ["../evil", "Store", "store/sub"]) {
            expect(moduleManifestSchema.safeParse({ ...base, dependencies: [bad] }).success, bad).toBe(false);
        }
    });

    it("applies the same grammar to conflicts", () => {
        expect(moduleManifestSchema.safeParse({ ...base, conflicts: ["other@^2.0.0"] }).success).toBe(true);
        expect(moduleManifestSchema.safeParse({ ...base, conflicts: ["other@??"] }).success).toBe(false);
    });

    it("accepts a valid coreVersion range and rejects a malformed one", () => {
        expect(moduleManifestSchema.safeParse({ ...base, coreVersion: "^1.0.0" }).success).toBe(true);
        expect(moduleManifestSchema.safeParse({ ...base, coreVersion: "1.x" }).success).toBe(true);
        expect(moduleManifestSchema.safeParse({ ...base, coreVersion: "latest" }).success).toBe(false);
        expect(moduleManifestSchema.safeParse({ ...base, coreVersion: "" }).success).toBe(false);
    });

    // coreVersion used to be optional, and an omitted range meant "compatible
    // with every core there will ever be". That is the one default a
    // compatibility gate cannot have.
    it("requires coreVersion", () => {
        const { coreVersion: _omitted, ...withoutCoreVersion } = base;
        const r = moduleManifestSchema.safeParse(withoutCoreVersion);
        expect(r.success).toBe(false);
        if (!r.success) {
            expect(r.error.issues[0].path).toEqual(["coreVersion"]);
        }
    });

    it("accepts category and tags", () => {
        const r = moduleManifestSchema.safeParse({ ...base, category: "commerce", tags: ["shop", "payments"] });
        expect(r.success).toBe(true);
    });

    it("rejects a category that is not a lowercase slug", () => {
        expect(moduleManifestSchema.safeParse({ ...base, category: "Commerce" }).success).toBe(false);
    });
});

describe("moduleManifestSchema - scaffold template", () => {
    it("validates once create-module strips the _comment key", () => {
        // Guards the authoring path: `npm run create:module` copies this file
        // and deletes only `_comment`, so anything else the schema rejects here
        // means every scaffolded module starts out invalid.
        const raw = JSON.parse(
            fs.readFileSync(path.join(process.cwd(), "module-template", "module.json"), "utf8"),
        );
        delete raw._comment;
        const r = moduleManifestSchema.safeParse(raw);
        if (!r.success) {
            throw new Error(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n"));
        }
        expect(r.success).toBe(true);
    });

    it("imports core only through the SDK", () => {
        // The template is excluded from every tsconfig and from the marketplace
        // boundary scan, so nothing else notices when it drifts. A scaffolded
        // module that deep-imports fails `validate:module` on its first run.
        const root = path.join(process.cwd(), "module-template");
        const walk = (dir: string): string[] =>
            fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
                const full = path.join(dir, e.name);
                if (e.isDirectory()) return walk(full);
                return /\.tsx?$/.test(e.name) ? [full] : [];
            });

        // Anything under `@/core/` that is not the published SDK. It used to name
        // `lib` and `components` only, and thirteen module files walked straight
        // through the gap into `@/core/hooks/*` - two formatters the SDK simply
        // did not carry, so the boundary was holding back the wrong thing. The
        // generated contract types are the one exception: `@/core/generated/*` is
        // where a module reads the shape of a contribution it declares, and that
        // is the intended way in.
        const deepImport = /["']@\/core\/(?!sdk\b|generated\/)[^"']*["']/;
        const violations = walk(root).flatMap((file) =>
            fs
                .readFileSync(file, "utf8")
                .split("\n")
                .flatMap((line, i) =>
                    deepImport.test(line) ? [`${path.relative(root, file)}:${i + 1}`] : [],
                ),
        );
        expect(violations).toEqual([]);
    });
});

describe("hook contracts across the catalog", () => {
    const dir = path.join(process.cwd(), "module-sources");
    const ids = fs
        .readdirSync(dir)
        .filter((id) => fs.existsSync(path.join(dir, id, "module.json")))
        .sort();
    const manifests = ids.map((id) => ({
        id,
        m: JSON.parse(fs.readFileSync(path.join(dir, id, "module.json"), "utf8")) as {
            hooksEmitted?: { hook: string; type: string }[];
            hookListeners?: { hook: string; type: string }[];
        },
    }));

    const coreHookSource = [
        fs.readFileSync(path.join(process.cwd(), "src/core/lib/hooks.ts"), "utf8"),
        fs.readFileSync(path.join(process.cwd(), "src/core/types/hook-payloads.d.ts"), "utf8"),
        ...fs
            .readdirSync(path.join(process.cwd(), "src/core/lib"))
            .filter((f) => f.endsWith(".ts"))
            .map((f) => fs.readFileSync(path.join(process.cwd(), "src/core/lib", f), "utf8")),
    ].join("\n");
    const coreHooks = new Set(
        [...coreHookSource.matchAll(/"([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)"\s*[,:)]/g)].map((m) => m[1]),
    );

    it("every hook listener subscribes to a hook something emits", () => {
        // A listener on a hook nobody fires never runs, and nothing anywhere
        // reports it - not a log line, not a failed build. This is the only
        // check that catches a mistyped hook name.
        const emitted = new Set<string>();
        for (const { m } of manifests) {
            for (const h of m.hooksEmitted ?? []) emitted.add(h.hook);
        }

        const unresolved: string[] = [];
        for (const { id, m } of manifests) {
            for (const h of m.hookListeners ?? []) {
                if (!emitted.has(h.hook) && !coreHooks.has(h.hook)) {
                    unresolved.push(`${id} listens to "${h.hook}", which nothing emits`);
                }
            }
        }
        expect(unresolved).toEqual([]);
    });

    it("no two modules announce the same event", () => {
        // An action is a notification, and its payload belongs to whoever
        // fires it. Two modules firing one name means two shapes behind one
        // contract, and a listener has no way to tell which it just got.
        //
        // A filter is the other direction: a question, whose shape belongs to
        // whoever answers it. Several modules can ask the same question -
        // store and minecraft-link both ask "server.command" - and the module
        // that answers declares the payload once. Requiring a single caller
        // there would mean the second module to need a capability has to
        // invent a second name for it.
        const owners = new Map<string, string>();
        const clashes: string[] = [];
        for (const { id, m } of manifests) {
            for (const h of m.hooksEmitted ?? []) {
                if (h.type === "filter") continue;
                const existing = owners.get(h.hook);
                if (existing && existing !== id) clashes.push(`"${h.hook}": ${existing} and ${id}`);
                else owners.set(h.hook, id);
            }
        }
        expect(clashes).toEqual([]);
    });

    it("a hook is either an event or a question, never both", () => {
        // The same name declared as an action by one module and a filter by
        // another is two contracts wearing one name. Whichever listener is
        // registered gets called through the wrong dispatcher and either
        // never fires or drops the value it was meant to transform.
        const kinds = new Map<string, Map<string, string[]>>();
        for (const { id, m } of manifests) {
            for (const h of [...(m.hooksEmitted ?? []), ...(m.hookListeners ?? [])]) {
                const byKind = kinds.get(h.hook) ?? new Map<string, string[]>();
                byKind.set(h.type, [...(byKind.get(h.type) ?? []), id]);
                kinds.set(h.hook, byKind);
            }
        }

        const mixed = [...kinds.entries()]
            .filter(([, byKind]) => byKind.size > 1)
            .map(([hook, byKind]) =>
                `"${hook}": ${[...byKind.entries()].map(([kind, ids]) => `${kind} in ${ids.join(", ")}`).join("; ")}`,
            );
        expect(mixed).toEqual([]);
    });
});

describe("moduleManifestSchema - shipped manifests", () => {
    const dir = path.join(process.cwd(), "module-sources");
    const ids = fs
        .readdirSync(dir)
        .filter((id) => fs.existsSync(path.join(dir, id, "module.json")))
        .sort();

    it("finds the shipped module sources", () => {
        expect(ids.length).toBeGreaterThan(0);
    });

    it.each(ids)("%s validates against the current schema", (id) => {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, id, "module.json"), "utf8"));
        const r = moduleManifestSchema.safeParse(raw);
        if (!r.success) {
            throw new Error(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n"));
        }
        expect(r.success).toBe(true);
    });
});

/**
 * An auth provider is declared one of two ways, and the schema's job is to
 * make sure a manifest picks one and fills it in. The half-declared shapes
 * below all used to parse, and each produced a provider that installed
 * cleanly and then failed at the first sign-in.
 */
describe("moduleManifestSchema - auth providers", () => {
    const parse = (authProviders: unknown) =>
        moduleManifestSchema.safeParse({ ...base, authProviders });

    it("accepts a provider Auth.js ships, named by its two env vars", () => {
        expect(
            parse([{ id: "discord", envIdVar: "AUTH_DISCORD_ID", envSecretVar: "AUTH_DISCORD_SECRET" }]).success,
        ).toBe(true);
    });

    it("accepts a module-supplied provider with a factory and its env vars", () => {
        expect(
            parse([{ id: "steam", factory: "auth/steam-provider.ts", envVars: ["AUTH_STEAM_API_KEY"] }]).success,
        ).toBe(true);
    });

    it("rejects a provider that names only one of the two env vars", () => {
        expect(parse([{ id: "discord", envIdVar: "AUTH_DISCORD_ID" }]).success).toBe(false);
        expect(parse([{ id: "discord", envSecretVar: "AUTH_DISCORD_SECRET" }]).success).toBe(false);
    });

    it("rejects a provider that names neither", () => {
        expect(parse([{ id: "discord" }]).success).toBe(false);
    });

    // Without env vars a factory-backed provider has no activation gate, so it
    // would be built on every install whether it was configured or not.
    it("rejects a factory with no env vars to gate it", () => {
        expect(parse([{ id: "steam", factory: "auth/steam-provider.ts" }]).success).toBe(false);
        expect(parse([{ id: "steam", factory: "auth/steam-provider.ts", envVars: [] }]).success).toBe(false);
    });

    it("rejects mixing a factory with the built-in credential vars", () => {
        expect(
            parse([
                {
                    id: "steam",
                    factory: "auth/steam-provider.ts",
                    envVars: ["AUTH_STEAM_API_KEY"],
                    envIdVar: "AUTH_STEAM_ID",
                    envSecretVar: "AUTH_STEAM_SECRET",
                },
            ]).success,
        ).toBe(false);
    });

    it("accepts standardCallback on a module-built OAuth provider", () => {
        expect(
            parse([
                {
                    id: "battlenet",
                    factory: "auth/battlenet-provider.ts",
                    standardCallback: true,
                    envVars: ["AUTH_BATTLENET_ID", "AUTH_BATTLENET_SECRET", "AUTH_BATTLENET_ISSUER"],
                },
            ]).success,
        ).toBe(true);
    });

    // A built-in provider always uses that URL, so saying so would be a
    // manifest claiming something it does not control.
    it("rejects standardCallback on a provider with no factory", () => {
        expect(
            parse([
                {
                    id: "discord",
                    envIdVar: "AUTH_DISCORD_ID",
                    envSecretVar: "AUTH_DISCORD_SECRET",
                    standardCallback: true,
                },
            ]).success,
        ).toBe(false);
    });

    it("rejects envVars on a provider with no factory", () => {
        expect(
            parse([
                {
                    id: "discord",
                    envIdVar: "AUTH_DISCORD_ID",
                    envSecretVar: "AUTH_DISCORD_SECRET",
                    envVars: ["AUTH_DISCORD_EXTRA"],
                },
            ]).success,
        ).toBe(false);
    });

    // The factory path is interpolated into an import specifier by the
    // registry generator, so it has to stay inside the module's own tree.
    it("rejects a factory path that escapes the module", () => {
        expect(parse([{ id: "steam", factory: "../../core/lib/auth", envVars: ["X"] }]).success).toBe(false);
        expect(parse([{ id: "steam", factory: "/etc/passwd", envVars: ["X"] }]).success).toBe(false);
    });

    it("rejects an env var name that is not one", () => {
        expect(parse([{ id: "steam", factory: "auth/p.ts", envVars: ["auth-steam-key"] }]).success).toBe(false);
    });
});

/**
 * A sign-in button normally calls signIn(provider). One that names an href
 * navigates there instead, which is how a non-OAuth2 flow starts - and is
 * also a way to point the sign-in button anywhere, if the schema lets it.
 */
describe("moduleManifestSchema - oauth button href", () => {
    const button = (href?: string) => ({
        id: "steam-login",
        provider: "steam",
        label: "Steam",
        color: "currentColor",
        svgIcon: "M0 0h24v24H0z",
        ...(href === undefined ? {} : { href }),
    });
    const parse = (href?: string) => moduleManifestSchema.safeParse({ ...base, oauthButtons: [button(href)] });

    it("accepts a button with no href", () => {
        expect(parse().success).toBe(true);
    });

    it("accepts a same-origin path", () => {
        expect(parse("/api/v1/steam-auth/start").success).toBe(true);
    });

    it("refuses to send the sign-in button off-site", () => {
        expect(parse("https://evil.example/steal").success).toBe(false);
        expect(parse("//evil.example/steal").success).toBe(false);
        expect(parse("javascript:alert(1)").success).toBe(false);
    });
});

describe("moduleManifestSchema - admin paths are panel-relative", () => {
    const cases: Array<[string, (p: string) => Record<string, unknown>]> = [
        ["adminRoutes", (p) => ({ adminRoutes: [{ path: p, component: "pages/admin/page.tsx" }] })],
        ["menu", (p) => ({ menu: [{ label: "Thing", path: p, icon: "Vote" }] })],
        [
            "settingsCards",
            (p) => ({
                settingsCards: [
                    { title: "Thing", description: "", href: p, icon: "Cog", color: "text-blue-500" },
                ],
            }),
        ],
    ];

    for (const [field, build] of cases) {
        it(`accepts a panel-relative ${field} path`, () => {
            expect(moduleManifestSchema.safeParse({ ...base, ...build("/vote-sites") }).success).toBe(true);
        });

        it(`rejects an ${field} path that carries the /admin prefix itself`, () => {
            // Core adds the prefix; a manifest that adds it too links to
            // /admin/admin/vote-sites, which is a 404.
            const r = moduleManifestSchema.safeParse({ ...base, ...build("/admin/vote-sites") });
            expect(r.success).toBe(false);
            if (!r.success) {
                expect(r.error.issues[0].message).toMatch(/relative to the panel/);
            }
        });

        it(`still accepts an ${field} path that merely begins with the word admin`, () => {
            expect(moduleManifestSchema.safeParse({ ...base, ...build("/administrators") }).success).toBe(true);
        });
    }
});

describe("route noindex flag", () => {
    it("accepts a route that opts out of indexing", () => {
        const result = moduleManifestSchema.safeParse({
            ...base,
            routes: [{ path: "/shop/cart", component: "pages/public/cart/page.tsx", noindex: true }],
        });
        expect(result.success).toBe(true);
    });

    it("leaves the flag off when a route does not set it", () => {
        const result = moduleManifestSchema.safeParse({
            ...base,
            routes: [{ path: "/shop", component: "pages/public/page.tsx" }],
        });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.routes?.[0].noindex).toBeUndefined();
    });

    it("rejects a non-boolean flag", () => {
        const result = moduleManifestSchema.safeParse({
            ...base,
            routes: [{ path: "/shop", component: "pages/public/page.tsx", noindex: "yes" }],
        });
        expect(result.success).toBe(false);
    });
});

describe("moduleManifestSchema - placeholders", () => {
    const online = { name: "online", handler: "placeholders/online.ts", labelKey: "placeholder_demo_online" };

    it("accepts a placeholder with a handler and a label", () => {
        const r = moduleManifestSchema.safeParse({ ...base, placeholders: [{ ...online, example: "214", maxAgeSeconds: 20 }] });
        expect(r.success).toBe(true);
    });

    it("takes a name that fits in a token, and no other", () => {
        for (const name of ["Online", "on-line", "on.line", "1st", ""]) {
            expect(moduleManifestSchema.safeParse({ ...base, placeholders: [{ ...online, name }] }).success, name).toBe(false);
        }
    });

    it("refuses a name declared twice and an age outside its bounds", () => {
        expect(moduleManifestSchema.safeParse({ ...base, placeholders: [online, online] }).success).toBe(false);
        expect(moduleManifestSchema.safeParse({ ...base, placeholders: [{ ...online, maxAgeSeconds: 1 }] }).success).toBe(false);
        expect(moduleManifestSchema.safeParse({ ...base, placeholders: [{ ...online, maxAgeSeconds: 86400 }] }).success).toBe(false);
    });

    it("counts the handler among the files the archive must hold", async () => {
        const { collectManifestFileRefs } = await import("@/core/lib/module-manifest-schema");
        const r = moduleManifestSchema.safeParse({ ...base, placeholders: [online] });
        expect(r.success && collectManifestFileRefs(r.data)).toContain("placeholders/online.ts");
    });
});
