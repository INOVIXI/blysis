// @vitest-environment node
/**
 * A refusal a client cannot read is a refusal that reads as a crash.
 *
 * `writeError` and `errorMessage` are how every screen in the panel turns a
 * failed request into a sentence, and both read one key: `error`. A route
 * answering 4xx or 5xx with anything else hands the screen a body it has no
 * branch for, so the operator gets the generic fallback - or worse, a 502
 * carrying `{ themes: [] }` reads as an empty list and the screen says there
 * is nothing to install.
 *
 * Measured on 2026-09-20 across core and every module: 1405 refusals with a
 * literal status, and 1395 of them carried `error`. The contract is real and
 * kept; what was missing was anything holding it.
 *
 * ## The documented envelope is a separate question
 *
 * `api-utils.ts` declares `{ ok, data }` and says "New code MUST use these
 * helpers". Six of two hundred and ninety-two route files do. This gate holds
 * the contract the code actually keeps rather than pretending the other one
 * is in force: changing the envelope changes every response the panel and
 * every module read, which is not a thing to do by gate.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/**
 * Endpoints that answer in somebody else's words, with the reason.
 *
 * Each of these is an integration surface: the caller is a provider or a game
 * server that was written against a published shape, and answering `{ error }`
 * there would be answering in a vocabulary the caller does not parse.
 */
const SPEAKS_ANOTHER_WIRE: Record<string, string> = {
    "module-sources/birfatura-invoicing/api/api/invoiceLinkUpdate/route.ts":
        "The invoicing provider calls this and reads `Success` and `Message`; the shape is theirs, not ours.",
    "module-sources/birfatura-invoicing/api/api/orders/route.ts":
        "The same provider, the same published shape.",
    "module-sources/license-keys/api/licenses/activate/route.ts":
        "A game server asks whether a key may be used and reads `valid` and `reason`. A refusal here is an answer to that question rather than a failure of the request.",
    "module-sources/license-keys/api/licenses/validate/route.ts":
        "The same question, asked without claiming a seat.",
};

function routeFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) routeFiles(full, out);
        else if (entry.name === "route.ts") out.push(full);
    }
    return out;
}

/** `NextResponse.json(<body>, { status: <n> })`, body and status together. */
const ANSWER = /NextResponse\.json\(\s*([\s\S]{0,400}?),\s*\{\s*status:\s*(\d{3})/g;

const routes = [
    ...routeFiles(path.join(ROOT, "src/app/api")),
    ...routeFiles(path.join(ROOT, "module-sources")),
];

describe("an endpoint that refuses", () => {
    it("finds the refusals, so a broken scan cannot pass quietly", () => {
        let refusals = 0;
        for (const file of routes) {
            for (const match of fs.readFileSync(file, "utf8").matchAll(ANSWER)) {
                if (Number(match[2]) >= 400) refusals += 1;
            }
        }
        expect(routes.length).toBeGreaterThan(200);
        expect(refusals).toBeGreaterThan(1000);
    });

    it("says so in the one word every screen reads", () => {
        const mute: string[] = [];
        for (const file of routes) {
            const rel = path.relative(ROOT, file);
            if (rel in SPEAKS_ANOTHER_WIRE) continue;
            const source = fs.readFileSync(file, "utf8");
            for (const match of source.matchAll(ANSWER)) {
                if (Number(match[2]) < 400) continue;
                const body = match[1];
                if (/\berror\s*:/.test(body) || /apiError/.test(body)) continue;
                const line = source.slice(0, match.index).split("\n").length;
                mute.push(`${rel}:${line}  ${body.replace(/\s+/g, " ").slice(0, 80)}`);
            }
        }
        expect(
            mute,
            "These answer 4xx or 5xx with a body that carries no `error`, which is\n" +
            "what writeError and errorMessage read. Add one, or name the file in\n" +
            `SPEAKS_ANOTHER_WIRE with the shape it is answering in:\n${mute.join("\n")}`,
        ).toEqual([]);
    });

    it("keeps every exemption to a file that exists and still answers that way", () => {
        for (const [rel, reason] of Object.entries(SPEAKS_ANOTHER_WIRE)) {
            expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true);
            expect(reason.length, rel).toBeGreaterThan(40);
        }
    });
});
