import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/**
 * A status looks the same wherever it is shown.
 *
 * `Badge` exists because a status used to be a hand-written `bg-.../10
 * text-...` pair, in a dozen sizes and paddings, wherever somebody needed
 * one. The tickets module had four such maps - the public list, the public
 * ticket, the admin list and the admin ticket - and no two agreed: a ticket
 * waiting for a reply was accent-tinted on one screen, secondary on another
 * and amber on a third. The store had two for order status and they had
 * already drifted apart on PROCESSING.
 *
 * A map like that is invisible in review because each one looks reasonable on
 * its own. What it costs is that the same word means a different colour
 * depending on which screen a reader is on, and that a theme recolouring the
 * panel recolours the badge and not these.
 *
 * So the colour is a tone, the tone lives with the labels for the same
 * values, and `Badge` decides what a tone looks like.
 */

const ROOT = process.cwd();

/**
 * A tint that is deliberately not a badge. Each line is a decision.
 */
const NOT_A_BADGE: Record<string, string> = {
    "module-sources/store/pages/admin/orders/[id]/status-select.tsx":
        "It tints a <select>, not a chip. A form control cannot be a Badge, and the file already explains why the tint is an alpha over the theme's colour rather than a swatch.",
    "module-sources/announcements/slots/AnnouncementTopBanner.tsx":
        "A full-width banner across the top of the site. It is a surface rather than a chip, and a badge's padding and border would read as a stray label in the middle of it.",
};

/** A record whose values are Tailwind colours, keyed by the values of a set. */
function colourMaps(source: string): { name: string; keys: string[] }[] {
    const found: { name: string; keys: string[] }[] = [];
    const DECLARED = /(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*\{([^}]*)\}/g;
    for (const m of source.matchAll(DECLARED)) {
        const body = m[2];
        if (!/\bbg-|\btext-|\bborder-/.test(body)) continue;
        const keys = [...body.matchAll(/^\s*([A-Za-z_]\w*)\s*:/gm)].map((k) => k[1]);
        if (keys.length < 2) continue;
        // Only maps whose values are entirely class strings. A record of
        // components or handlers that happens to mention a class is not one.
        const values = [...body.matchAll(/:\s*"([^"]*)"/g)].map((v) => v[1]);
        if (values.length < keys.length) continue;
        if (!values.every((v) => /^[\w\s/[\]().,#%-]*$/.test(v) && /bg-|text-|border-/.test(v))) continue;
        found.push({ name: m[1], keys });
    }
    return found;
}

function screens(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== "node_modules" && entry.name !== "generated") walk(full);
            } else if (/\.tsx$/.test(entry.name)) {
                out.push(full);
            }
        }
    };
    walk(path.join(ROOT, "src/app"));
    walk(path.join(ROOT, "src/core"));
    walk(path.join(ROOT, "module-sources"));
    return out;
}

describe("a status", () => {
    const offenders = screens()
        .map((file) => ({ rel: path.relative(ROOT, file), maps: colourMaps(stripComments(fs.readFileSync(file, "utf8"))) }))
        .filter(({ maps }) => maps.length > 0)
        .filter(({ rel }) => !(rel in NOT_A_BADGE))
        // The badge components are where a tone becomes a colour. Reading
        // them as offenders would make the rule forbid its own answer.
        .filter(({ rel }) => !/components\/ui\/(badge|count-badge)\.tsx$/.test(rel));

    it("finds screens to read, so a broken scan cannot pass quietly", () => {
        expect(screens().length).toBeGreaterThan(200);
    });

    it("is not given a colour a screen wrote for itself", () => {
        expect(offenders.map(({ rel, maps }) => `${rel}: ${maps.map((m) => m.name).join(", ")}`)).toEqual([]);
    });

    it("keeps every exception to a file that still exists, with a reason", () => {
        for (const [file, reason] of Object.entries(NOT_A_BADGE)) {
            expect(fs.existsSync(path.join(ROOT, file)), file).toBe(true);
            expect(reason.length, file).toBeGreaterThan(40);
        }
    });

    it("keeps the badge itself, which is the thing every one of them should be", () => {
        const badge = fs.readFileSync(path.join(ROOT, "src/core/components/ui/badge.tsx"), "utf8");
        for (const tone of ["neutral", "success", "warning", "danger", "info"]) {
            expect(badge, tone).toContain(`${tone}:`);
        }
    });
});
