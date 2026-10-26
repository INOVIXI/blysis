/**
 * Every place in the panel is named in the reader's language on the crumb
 * trail above it.
 *
 * The trail names a segment by the sidebar entry for it, then by a
 * `crumb_<segment>` string, and as a last resort titlecases the English path.
 * The last resort is a defect wherever it is reached: the import screen
 * arrived reading "Çeviriler > Import" to a Turkish admin, because it had no
 * sidebar entry and nobody wrote its crumb. Every core screen's every fixed
 * segment is checked here against both sources.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CORE_ADMIN_SCREENS } from "@/core/lib/admin-screens";

const ROOT = process.cwd();
const NAV = fs.readFileSync(path.join(ROOT, "src/core/lib/admin-nav-groups.ts"), "utf8");
const MESSAGES = JSON.parse(fs.readFileSync(path.join(ROOT, "messages-core/en.json"), "utf8")) as { admin: Record<string, string> };

const NAV_HREFS = new Set([...NAV.matchAll(/href: "(\/admin[^"]*)"/g)].map((m) => m[1]));

function unnamed(): string[] {
    const out = new Set<string>();
    for (const screen of CORE_ADMIN_SCREENS) {
        const segments = screen.path.split("/").filter(Boolean);
        segments.forEach((segment, i) => {
            if (segment.startsWith("[")) return;
            const href = `/admin/${segments.slice(0, i + 1).join("/")}`;
            if (NAV_HREFS.has(href)) return;
            if (`crumb_${segment}` in MESSAGES.admin) return;
            out.add(href);
        });
    }
    return [...out].sort();
}

describe("the crumb trail", () => {
    it("has the sidebar's names to read", () => {
        expect(NAV_HREFS.size).toBeGreaterThan(20);
    });

    it("names every place in the panel without titlecasing its path", () => {
        expect(unnamed()).toEqual([]);
    });
});
