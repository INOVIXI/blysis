import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { relativePath } from "./source-text";

const ENV_KEY = "BLYSIS_MARKETPLACE_BASE";
const DEFAULT_HOST = "https://raw.githubusercontent.com/INOVIXI/blysis/main";

/**
 * The module resolves the base on every call rather than at import time, so a
 * plain re-import is enough; there is no module cache to reset.
 */
async function load() {
    return await import("@/core/lib/marketplace-source");
}

describe("marketplace source", () => {
    const original = process.env[ENV_KEY];

    beforeEach(() => {
        delete process.env[ENV_KEY];
    });
    afterEach(() => {
        if (original === undefined) delete process.env[ENV_KEY];
        else process.env[ENV_KEY] = original;
    });

    it("defaults to the repository the installer pulls from", async () => {
        const m = await load();
        expect(m.moduleMarketplaceIndexUrl()).toBe(`${DEFAULT_HOST}/module-marketplace/index.json`);
        expect(m.themeMarketplaceIndexUrl()).toBe(`${DEFAULT_HOST}/theme-marketplace/index.json`);
    });

    it("lets a fork or an internal mirror take over", async () => {
        process.env[ENV_KEY] = "https://mirror.example.com/blysis";
        const m = await load();
        expect(m.moduleMarketplaceBase()).toBe("https://mirror.example.com/blysis/module-marketplace");
        expect(m.themeMarketplaceBase()).toBe("https://mirror.example.com/blysis/theme-marketplace");
    });

    it("strips trailing slashes so the joined URL never doubles them", async () => {
        process.env[ENV_KEY] = "https://mirror.example.com/blysis///";
        const m = await load();
        expect(m.moduleMarketplaceIndexUrl()).toBe(
            "https://mirror.example.com/blysis/module-marketplace/index.json",
        );
    });

    // These values are interpolated into a fetch() whose response is then
    // unzipped onto disk. A non-http scheme would turn the module installer
    // into a way to read the server's own filesystem.
    it.each(["file:///etc/passwd", "ftp://example.com/x", "javascript:alert(1)", "not a url", "   "])(
        "refuses %s and falls back to the default",
        async (value) => {
            process.env[ENV_KEY] = value;
            const m = await load();
            expect(m.moduleMarketplaceBase()).toBe(`${DEFAULT_HOST}/module-marketplace`);
        },
    );

    it("no route handler carries its own copy of the URL any more", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const root = process.cwd();
        const offenders: string[] = [];

        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else if (/\.tsx?$/.test(entry.name)) {
                    const src = fs.readFileSync(full, "utf8");
                    if (/raw\.githubusercontent\.com\/[^"'`]*marketplace/.test(src)) {
                        offenders.push(relativePath(root, full));
                    }
                }
            }
        };
        walk(path.join(root, "src"));

        const allowed = ["src/core/lib/marketplace-source.ts"];
        expect(offenders.filter((f) => !allowed.includes(f))).toEqual([]);
    });
});
