import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { writeError } from "@/core/lib/write-result";

/**
 * A screen may not report a write it never checked.
 *
 * `fetch` rejects only when the request never reached a server. A 400, a 403
 * on an expired session, a 429 from the rate limiter and a 500 all resolve
 * normally, so a handler shaped like this:
 *
 *     await fetch("/api/v1/settings", { method: "PATCH", body: ... });
 *     toast.success(t("css_saved"));
 *
 * shows the same green toast for every one of them.
 *
 * 32 mutating fetches across 24 client screens did exactly this. The worst
 * was the setup wizard: `setup_completed` is written by that one PATCH and
 * nothing else, so a rejected call left the site in setup while the wizard
 * congratulated the admin and moved to the done step. Ban and unban reloaded
 * the page and let the admin read the unchanged row. The custom CSS, widget
 * layout, theme reset and theme switch screens all said "saved".
 *
 * The fix is `writeError(res, fallback, t)`: null when the server accepted
 * the write, otherwise the message to show, in the reader's language.
 *
 * This test fails on a new mutating fetch in a client component whose
 * response nothing looks at.
 */

const ROOT = process.cwd();
const SCAN_DIRS = ["src/app", "src/core", "module-sources"];

interface Call {
    file: string;
    line: number;
    method: string;
    /** Everything from the `fetch(` to the end of its statement's neighbourhood. */
    context: string;
    /** Whether the call sits on the right-hand side of an assignment. */
    assigned: boolean;
}

function mutatingCalls(file: string, source: string): Call[] {
    const found: Call[] = [];
    for (const match of source.matchAll(/fetch\(/g)) {
        const start = match.index ?? 0;
        let depth = 1;
        let i = match.index! + match[0].length;
        for (; i < source.length && depth > 0; i++) {
            if (source[i] === "(") depth++;
            else if (source[i] === ")") depth--;
        }
        const call = source.slice(start, i);
        const method = /method:\s*["'](POST|PUT|PATCH|DELETE)/.exec(call)?.[1];
        if (!method) continue;
        const head = source.slice(Math.max(0, start - 60), start);
        found.push({
            file: path.relative(ROOT, file),
            line: source.slice(0, start).split("\n").length,
            method,
            context: source.slice(start, i + 400),
            assigned: /(?:const|let|var)\s+\w+\s*=\s*(?:await\s+)?$/.test(head),
        });
    }
    return found;
}

/**
 * Whether anything looks at the answer. Assigning the response counts: the
 * variable exists to be read, and TypeScript's unused-variable rule is what
 * catches one that is not.
 */
function checked(call: Call): boolean {
    if (call.assigned) return true;
    return /\.ok\b|\.status\b|writeError\(|\.then\(/.test(call.context);
}

function walk(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "generated") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.name.endsWith(".tsx")) out.push(full);
    }
    return out;
}

function allCalls(): Call[] {
    return SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d))).flatMap((f) =>
        mutatingCalls(f, fs.readFileSync(f, "utf8")),
    );
}

/**
 * Writes whose answer is deliberately ignored, with the reason. A call is
 * here because there is nothing a reader could do with the failure, not
 * because reporting it was inconvenient.
 */
const FIRE_AND_FORGET: Record<string, { calls: number; reason: string }> = {
    "src/core/components/ErrorBoundary.tsx": {
        calls: 1,
        reason: "Reports the error that just broke the page. If the report fails too, a toast about the report is not what the reader needs.",
    },
    "module-sources/trophies/pages/admin/page.tsx": {
        calls: 1,
        reason: "reloadEngine asks the trophy engine to re-read its rules. It re-reads on its own schedule anyway.",
    },
};

describe("the scan", () => {
    const calls = allCalls();

    it("finds the mutating calls at all", () => {
        expect(calls.length).toBeGreaterThan(120);
        expect(new Set(calls.map((c) => c.method))).toEqual(new Set(["POST", "PUT", "PATCH", "DELETE"]));
    });

    it("does not count a plain read", () => {
        const reads = mutatingCalls("x.tsx", `fetch("/api/v1/settings").then((r) => r.json());`);
        expect(reads).toEqual([]);
    });
});

describe("a POST, PUT, PATCH or DELETE from a screen", () => {
    it("has its answer looked at, or a reason recorded here", () => {
        const unchecked = allCalls()
            .filter((c) => !checked(c))
            .filter((c) => !(c.file in FIRE_AND_FORGET))
            .map((c) => `${c.file}:${c.line} (${c.method})`);
        expect(unchecked).toEqual([]);
    });

    it("counts the exempt calls, so a new one in the same file is not exempt too", () => {
        const unchecked = allCalls().filter((c) => !checked(c));
        for (const [file, { calls, reason }] of Object.entries(FIRE_AND_FORGET)) {
            expect(fs.existsSync(path.join(ROOT, file)), `${file} is gone`).toBe(true);
            expect(reason.length).toBeGreaterThan(40);
            expect(unchecked.filter((c) => c.file === file), file).toHaveLength(calls);
        }
    });
});

describe("the screens this was found on", () => {
    const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

    /** One handler, from its `const <name> =` to the line that closes it. */
    const handler = (source: string, name: string): string => {
        const start = source.indexOf(`const ${name}`);
        expect(start, `${name} is gone`).toBeGreaterThan(-1);
        const end = source.indexOf("\n    };", start);
        return source.slice(start, end === -1 ? undefined : end);
    };

    it("does not reload the user page as though a ban went through", () => {
        const source = read("src/app/[locale]/(admin)/admin/users/[id]/page.tsx");
        const bans = [...source.matchAll(/isBanned:\s*(true|false)/g)];
        expect(bans).toHaveLength(2);
        for (const ban of bans) {
            const after = source.slice(ban.index ?? 0, (ban.index ?? 0) + 500);
            expect(after.indexOf("writeError")).toBeGreaterThan(-1);
            expect(after.indexOf("writeError")).toBeLessThan(after.indexOf("window.location.reload()"));
        }
    });

    it("does not thank a help-center reader for a vote that was dropped", () => {
        const submit = handler(read("module-sources/help-center/components/ArticleView.tsx"), "submitFeedback");
        expect(submit.indexOf("writeError")).toBeLessThan(submit.indexOf("setFeedbackGiven(true)"));
    });

    it("keeps the unread badge when marking as read fails", () => {
        const source = read("module-sources/in-app-notifications/components/NotificationBell.tsx");
        expect(source.match(/if \(!res\?\.ok\) return;/g)).toHaveLength(2);
    });
});

describe("writeError", () => {
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    const fail = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    it("says nothing when the server accepted the write", async () => {
        expect(await writeError(ok({ ok: true }), "fallback")).toBeNull();
    });

    it("leaves a successful response body unread for the caller", async () => {
        const res = ok({ ok: true, data: { id: "7" } });
        expect(await writeError(res, "fallback")).toBeNull();
        expect(await res.json()).toEqual({ ok: true, data: { id: "7" } });
    });

    it("returns the caller's message, not the server's English", async () => {
        expect(await writeError(fail(403, { ok: false, error: "Forbidden" }), "Kaydedilemedi")).toBe("Kaydedilemedi");
    });

    it("survives a failure with no body at all", async () => {
        expect(await writeError(new Response(null, { status: 502 }), "Kaydedilemedi")).toBe("Kaydedilemedi");
    });

    it("survives a failure whose body is not JSON", async () => {
        expect(await writeError(new Response("<html>502</html>", { status: 502 }), "Kaydedilemedi")).toBe("Kaydedilemedi");
    });

    it("prefers a translated message when the response carries a code the catalogue knows", async () => {
        const t = Object.assign((key: string) => ({ "err.rate_limited": "Cok fazla istek" })[key] ?? key, {
            has: (key: string) => key === "err.rate_limited",
        });
        const res = fail(429, { ok: false, error: "Too many requests", code: "rate_limited" });
        expect(await writeError(res, "Kaydedilemedi", t)).toBe("Cok fazla istek");
    });

    it("falls back when the code is one this build does not know", async () => {
        const t = Object.assign((key: string) => key, { has: () => false });
        const res = fail(400, { ok: false, error: "Nope", code: "something_new" });
        expect(await writeError(res, "Kaydedilemedi", t)).toBe("Kaydedilemedi");
    });
});
