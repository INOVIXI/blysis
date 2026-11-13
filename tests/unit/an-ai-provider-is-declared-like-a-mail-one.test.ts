// @vitest-environment node
/**
 * An AI provider is a module, declared the way a mail transport is.
 *
 * Its manifest names a handler under `aiProvider`, the registry generator
 * collects every one into `src/core/generated/module-ai.ts`, and core loads
 * the one the operator chose. Core never names a vendor: Claude, OpenAI and
 * OpenRouter are modules, and so is whatever comes after them.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { moduleManifestSchema } from "@/core/lib/module-manifest-schema";

const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

/** A real, valid manifest to change one key of. */
function base(): Record<string, unknown> {
    const manifest = JSON.parse(read("module-sources/resend-provider/module.json"));
    delete manifest.emailProvider;
    return manifest;
}

describe("the aiProvider manifest key", () => {
    it("takes a name and a handler inside the module", () => {
        const parsed = moduleManifestSchema.safeParse({ ...base(), aiProvider: { name: "Example AI", handler: "lib/provider.ts" } });
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });

    it("refuses a key it does not know", () => {
        const parsed = moduleManifestSchema.safeParse({ ...base(), aiProvider: { name: "Example AI", handler: "lib/provider.ts", model: "x" } });
        expect(parsed.success).toBe(false);
    });

    it("refuses a handler outside the module", () => {
        const parsed = moduleManifestSchema.safeParse({ ...base(), aiProvider: { name: "Example AI", handler: "../other/provider.ts" } });
        expect(parsed.success).toBe(false);
    });

    it("refuses a provider with no handler", () => {
        const parsed = moduleManifestSchema.safeParse({ ...base(), aiProvider: { name: "Example AI" } });
        expect(parsed.success).toBe(false);
    });
});

describe("the aiPurposes manifest key", () => {
    const purpose = { id: "review", labelKey: "example_purposeReview", sendsKey: "example_sendsReview" };

    it("names what a module sends out, in words the operator reads", () => {
        const parsed = moduleManifestSchema.safeParse({ ...base(), aiPurposes: [purpose] });
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });

    it("refuses a purpose that does not say what it sends", () => {
        const { sendsKey: _sendsKey, ...unsaid } = purpose;
        expect(moduleManifestSchema.safeParse({ ...base(), aiPurposes: [unsaid] }).success).toBe(false);
    });

    it("refuses a purpose id that is not a slug", () => {
        expect(moduleManifestSchema.safeParse({ ...base(), aiPurposes: [{ ...purpose, id: "Review Posts" }] }).success).toBe(false);
    });
});

describe("the registry", () => {
    const generator = read("scripts/generate-registry.ts");

    it("collects every declared provider into module-ai.ts", () => {
        expect(generator).toContain("module-ai.ts");
        expect(generator).toContain("AiProviderRegistry");
        expect(generator).toContain("ModuleAiProviders");
    });

    it("is offered to a provider's own settings screen without its handlers", () => {
        const sdk = read("src/core/sdk/index.ts");
        expect(sdk).toMatch(/ModuleAiProviders as aiProviders/);
        expect(sdk).toMatch(/ACTIVE_AI_PROVIDER_KEY/);
        // The key lives in a file with no imports, so a client screen naming it
        // does not pull the server-only registry into a browser bundle.
        expect(read("src/core/lib/ai-key.ts")).not.toMatch(/^import /m);
    });
});
