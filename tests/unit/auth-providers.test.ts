import { describe, it, expect, vi } from "vitest";
import { resolveAuthProviders, type DeclaredAuthProvider } from "@/core/lib/auth-providers";

const discord: DeclaredAuthProvider = {
    id: "discord",
    envIdVar: "AUTH_DISCORD_ID",
    envSecretVar: "AUTH_DISCORD_SECRET",
    module: "discord-auth",
};

const google: DeclaredAuthProvider = {
    id: "google",
    envIdVar: "AUTH_GOOGLE_ID",
    envSecretVar: "AUTH_GOOGLE_SECRET",
    module: "google-auth",
};

const fullEnv = { AUTH_DISCORD_ID: "id-123", AUTH_DISCORD_SECRET: "secret-456" };

describe("resolveAuthProviders", () => {
    it("builds a provider when the module's env vars are set", () => {
        const factory = vi.fn((config: unknown) => ({ built: config }));
        const providers = resolveAuthProviders([discord], { env: fullEnv, factories: { discord: factory } });

        expect(providers).toHaveLength(1);
        expect(providers[0]).toEqual({
            built: {
                clientId: "id-123",
                clientSecret: "secret-456",
                allowDangerousEmailAccountLinking: false,
            },
        });
    });

    it("passes the issuer a manifest declares, so a server that sends iss is accepted", () => {
        // Discord began sending RFC 9207's iss on its callback. Its Auth.js
        // definition has no issuer, so the check ran against a placeholder and
        // every Discord sign-in ended on the Configuration error page.
        const factory = vi.fn((config: unknown) => config);
        const [built] = resolveAuthProviders([{ ...discord, issuer: "https://discord.com" }], {
            env: fullEnv,
            factories: { discord: factory },
        }) as unknown as { issuer?: string }[];
        expect(built.issuer).toBe("https://discord.com");
    });

    it("leaves the issuer to Auth.js when the manifest declares none", () => {
        const factories = { discord: (config: unknown) => config };
        const [built] = resolveAuthProviders([discord], { env: fullEnv, factories }) as unknown as object[];
        expect(built).not.toHaveProperty("issuer");
    });

    it("never enables dangerous account linking", () => {
        const factories = { discord: (config: unknown) => config };
        const [built] = resolveAuthProviders([discord], { env: fullEnv, factories }) as unknown as {
            allowDangerousEmailAccountLinking: boolean;
        }[];
        expect(built.allowDangerousEmailAccountLinking).toBe(false);
    });

    it("skips a provider with no configured credentials", () => {
        const factory = vi.fn();
        expect(resolveAuthProviders([discord], { env: {}, factories: { discord: factory } })).toEqual([]);
        expect(factory).not.toHaveBeenCalled();
    });

    it("skips a provider configured with an id but no secret", () => {
        const factory = vi.fn();
        const providers = resolveAuthProviders([discord], {
            env: { AUTH_DISCORD_ID: "id-123" },
            factories: { discord: factory },
        });
        expect(providers).toEqual([]);
        expect(factory).not.toHaveBeenCalled();
    });

    it("warns and continues when next-auth ships no such provider", () => {
        const warnings: string[] = [];
        const providers = resolveAuthProviders([discord], {
            env: fullEnv,
            factories: {},
            onWarn: (m) => warnings.push(m),
        });
        expect(providers).toEqual([]);
        expect(warnings.join(" ")).toContain("discord-auth");
    });

    it("ignores a non-function entry in the factory map", () => {
        const warnings: string[] = [];
        const providers = resolveAuthProviders([discord], {
            env: fullEnv,
            factories: { discord: undefined },
            onWarn: (m) => warnings.push(m),
        });
        expect(providers).toEqual([]);
        expect(warnings).toHaveLength(1);
    });

    it("keeps working providers when one of them throws while building", () => {
        const env = { ...fullEnv, AUTH_GOOGLE_ID: "g-id", AUTH_GOOGLE_SECRET: "g-secret" };
        const factories = {
            discord: () => { throw new Error("bad config"); },
            google: () => ({ id: "google" }),
        };
        const warnings: string[] = [];
        const providers = resolveAuthProviders([discord, google], { env, factories, onWarn: (m) => warnings.push(m) });
        expect(providers).toEqual([{ id: "google" }]);
        expect(warnings.join(" ")).toContain("bad config");
    });

    it("returns nothing when no module declares a provider", () => {
        expect(resolveAuthProviders([], { env: fullEnv, factories: {} })).toEqual([]);
    });
});

/**
 * Some identity systems are not OAuth2 at all - Steam speaks OpenID 2.0 - and
 * some built-in providers need more than a client id and secret. Those modules
 * ship their own provider builder and name the env vars it needs.
 */
const steam: DeclaredAuthProvider = {
    id: "steam",
    factory: "auth/steam-provider.ts",
    envVars: ["AUTH_STEAM_API_KEY"],
    module: "steam-auth",
};

describe("resolveAuthProviders with a module-supplied provider", () => {
    it("passes the declared env vars to the module's builder", () => {
        const factory = vi.fn((config: unknown) => ({ built: config }));
        const providers = resolveAuthProviders([steam], {
            env: { AUTH_STEAM_API_KEY: "key-789" },
            factories: {},
            moduleFactories: { steam: factory },
        });

        expect(providers).toEqual([
            {
                built: {
                    env: { AUTH_STEAM_API_KEY: "key-789" },
                    allowDangerousEmailAccountLinking: false,
                },
            },
        ]);
    });

    it("passes only the env vars the manifest asked for", () => {
        const factory = vi.fn((config: { env: Record<string, string> }) => config);
        resolveAuthProviders([steam], {
            env: { AUTH_STEAM_API_KEY: "key-789", DATABASE_URL: "postgres://secret" },
            factories: {},
            moduleFactories: { steam: factory },
        });
        expect(Object.keys(factory.mock.calls[0][0].env)).toEqual(["AUTH_STEAM_API_KEY"]);
    });

    it("stays inactive until every declared env var is set", () => {
        const factory = vi.fn(() => ({ id: "steam" }));
        const twoVars: DeclaredAuthProvider = { ...steam, envVars: ["AUTH_STEAM_API_KEY", "AUTH_STEAM_REALM"] };
        const providers = resolveAuthProviders([twoVars], {
            env: { AUTH_STEAM_API_KEY: "key-789" },
            factories: {},
            moduleFactories: { steam: factory },
        });
        expect(providers).toEqual([]);
        expect(factory).not.toHaveBeenCalled();
    });

    it("does not fall back to the built-in provider map", () => {
        const builtIn = vi.fn(() => ({ id: "wrong" }));
        const warnings: string[] = [];
        const providers = resolveAuthProviders([steam], {
            env: { AUTH_STEAM_API_KEY: "key-789" },
            factories: { steam: builtIn },
            moduleFactories: {},
            onWarn: (m) => warnings.push(m),
        });
        expect(builtIn).not.toHaveBeenCalled();
        expect(providers).toEqual([]);
        expect(warnings.join(" ")).toContain("steam-auth");
    });

    it("never enables dangerous account linking here either", () => {
        const factory = (config: { allowDangerousEmailAccountLinking: boolean }) => config;
        const [built] = resolveAuthProviders([steam], {
            env: { AUTH_STEAM_API_KEY: "key-789" },
            factories: {},
            moduleFactories: { steam: factory },
        }) as unknown as { allowDangerousEmailAccountLinking: boolean }[];
        expect(built.allowDangerousEmailAccountLinking).toBe(false);
    });

    it("keeps built-in and module-supplied providers side by side", () => {
        const providers = resolveAuthProviders([discord, steam], {
            env: { ...fullEnv, AUTH_STEAM_API_KEY: "key-789" },
            factories: { discord: () => ({ id: "discord" }) },
            moduleFactories: { steam: () => ({ id: "steam" }) },
        });
        expect(providers).toEqual([{ id: "discord" }, { id: "steam" }]);
    });
});
