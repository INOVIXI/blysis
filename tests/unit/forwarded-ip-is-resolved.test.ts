import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resolveClientIp } from "@/core/lib/rate-limit";
import { stripComments } from "./source-text";

/**
 * Which address in a forwarded chain is the caller.
 *
 * `x-forwarded-for` is a list, and a proxy appends to its right: nginx's
 * `$proxy_add_x_forwarded_for` and Caddy both add the peer they saw to the
 * end, so everything left of that is whatever the caller chose to send.
 * Reading `split(",")[0]` reads the caller's own text, which is the classic
 * way a forwarded header gets trusted by mistake, and it made
 * `TRUSTED_PROXY_IPS` mean less than its name says: with a real chain, the
 * entry it vouched for was not the entry that got used.
 *
 * Everything keys on this. Rate limits key on it, so a spoofable answer means
 * rotating one header buys a fresh budget; the IP blocklist keys on it, so a
 * blocked address is evaded by typing a different one. There are forty-three
 * callers of `getClientIP`.
 */

const ROOT = process.cwd();
const NGINX = "10.0.0.9";      // the reverse proxy, as the app sees it
const CDN = "10.0.0.8";        // a second hop in front of it
const CALLER = "203.0.113.7";  // the visitor
const FORGED = "1.2.3.4";      // what the visitor puts in the header

describe("with a trusted proxy declared", () => {
    const trusted = new Set([NGINX]);

    it("takes the address the trusted hop appended, not the one the caller prepended", () => {
        // nginx: X-Real-IP = its own peer, X-Forwarded-For = "<caller text>, <peer>"
        expect(resolveClientIp(NGINX, `${FORGED}, ${CALLER}`, trusted)).toBe(CALLER);
    });

    it("is not fooled by a caller who writes a whole chain", () => {
        expect(resolveClientIp(NGINX, `${FORGED}, ${FORGED}, ${CALLER}`, trusted)).toBe(CALLER);
    });

    it("walks past hops that are themselves trusted", () => {
        const chained = new Set([NGINX, CDN]);
        expect(resolveClientIp(NGINX, `${CALLER}, ${CDN}`, chained)).toBe(CALLER);
        expect(resolveClientIp(NGINX, `${FORGED}, ${CALLER}, ${CDN}`, chained)).toBe(CALLER);
    });

    it("ignores the chain entirely when the peer is not a declared proxy", () => {
        // This is the shipped nginx and Caddy shape: X-Real-IP carries the
        // visitor, so no chain has to be believed at all.
        expect(resolveClientIp(CALLER, `${FORGED}, ${CALLER}`, trusted)).toBe(CALLER);
        expect(resolveClientIp(CALLER, FORGED, trusted)).toBe(CALLER);
    });

    it("falls back to the peer when a trusted chain holds nothing else", () => {
        expect(resolveClientIp(NGINX, "", trusted)).toBe(NGINX);
        expect(resolveClientIp(NGINX, null, trusted)).toBe(NGINX);
        expect(resolveClientIp(NGINX, NGINX, trusted)).toBe(NGINX);
    });

    it("answers something usable when no header arrives at all", () => {
        expect(resolveClientIp(null, null, trusted)).toBe("unknown");
    });

    it("tolerates the whitespace a real chain carries", () => {
        expect(resolveClientIp(NGINX, `  ${FORGED} ,   ${CALLER}  `, trusted)).toBe(CALLER);
        expect(resolveClientIp(NGINX, `${FORGED},,${CALLER},`, trusted)).toBe(CALLER);
    });
});

describe("with nothing declared", () => {
    it("prefers x-real-ip, which is what every shipped proxy config sets", () => {
        expect(resolveClientIp(CALLER, FORGED, null)).toBe(CALLER);
    });

    it("takes the rightmost forwarded entry, the one a proxy would have added", () => {
        expect(resolveClientIp(null, `${FORGED}, ${CALLER}`, null)).toBe(CALLER);
    });

    it("still answers for a request carrying neither header", () => {
        expect(resolveClientIp(null, null, null)).toBe("unknown");
        expect(resolveClientIp(null, "", null)).toBe("unknown");
    });
});

describe("the operator is told when nothing can be verified", () => {
    it("boots through the warning", () => {
        const source = fs.readFileSync(path.join(ROOT, "src/instrumentation.ts"), "utf8");
        expect(source).toContain("warnIfProxyTrustUnconfigured()");
    });

    it("says it only when no proxy is declared", () => {
        const source = fs.readFileSync(path.join(ROOT, "src/core/lib/rate-limit.ts"), "utf8");
        const fn = source.slice(source.indexOf("export function warnIfProxyTrustUnconfigured"));
        expect(fn.slice(0, 200)).toContain("if (TRUSTED_PROXY_IPS) return;");
        expect(fn).toContain("TRUSTED_PROXY_IPS is not set");
    });
});

describe("nobody reads the raw header instead", () => {
    it("keeps the decision in one place", () => {
        const offenders: string[] = [];
        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name !== "node_modules") walk(full);
                    continue;
                }
                if (!/\.tsx?$/.test(entry.name)) continue;
                if (full.endsWith("rate-limit.ts")) continue;
                const source = stripComments(fs.readFileSync(full, "utf8"));
                // Any receiver, and optional chaining too: the two sites this
                // caught were `headers?.get(...)` and a variable named `list`,
                // neither of which a `headers.get` pattern would have found.
                if (/\.\s*get\(\s*["']x-(forwarded-for|real-ip)["']/.test(source)) {
                    offenders.push(path.relative(ROOT, full));
                }
            }
        };
        for (const base of ["src", "module-sources"]) walk(path.join(ROOT, base));
        expect(offenders).toEqual([]);
        // Reads every TypeScript file under src and module-sources - about
        // five thousand of them. Vitest's default ceiling is five seconds and
        // this crossed it on a machine at a load average of 31, which says
        // nothing about the rule it holds.
    }, 30_000);
});
