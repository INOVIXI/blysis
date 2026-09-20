import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { HookNames } from "@/core/lib/hooks";

/**
 * A hook core advertises has to be one core actually fires.
 *
 * `HookNames` is the list a module author reads to find out what they can
 * listen to, and ten of its seventeen entries were fired by nothing at all.
 * A module could declare `{ "hook": "user.deleted", "type": "action" }`,
 * pass validation, ship, and simply never run - with no error anywhere,
 * because a listener registered against a name nobody emits is
 * indistinguishable from one whose event has not happened yet.
 *
 * Three of them mattered. `user.deleted` was the only way a module could
 * clean up on a right to be forgotten, and the `two-factor-auth` module
 * needs exactly that: it adds `twoFactorSecret`, `twoFactorEnabled` and
 * `backupCodes` to `User`, and core cannot know about a column a module
 * injected into one of core's own models, so the TOTP seed of an erased
 * account stayed in the database. `user.banned` and `user.updated` are how
 * a module mirroring an account elsewhere - a whitelist, a Discord role -
 * hears that an admin changed it.
 *
 * Five were duplicate surface: `page.title`, `page.meta`, `navbar.links`,
 * `footer.links` and `admin.sidebar` all describe contributions the
 * manifest already makes declaratively through `navLinks`, `footerLinks`,
 * `navGroups` and `seoRoutes`, which do work. They are gone rather than
 * wired, because two mechanisms for one thing is how the dead one gets
 * built against.
 *
 * `email.subject` and `email.body` had a real place to run and no call:
 * `deliverViaProvider` is the single point every outbound message passes
 * through, queued or immediate.
 */

const ROOT = process.cwd();

/** Every source file that could emit a hook. */
function sourceFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === "node_modules") continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.tsx?$/.test(entry.name)) out.push(full);
        }
    };
    for (const base of ["src", "module-sources", "scripts"]) walk(path.join(ROOT, base));
    return out.filter((f) => !f.endsWith(path.join("core", "lib", "hooks.ts")));
}

const FILES = sourceFiles().map((f) => ({ path: f, source: fs.readFileSync(f, "utf8") }));

/**
 * A hook name as a literal inside a pattern.
 *
 * This escaped the dot and nothing else. Every hook shipped today is
 * `word.word`, so it worked - and it is a rule about somebody else's string
 * that happens to hold. The first hook named with a `+` or a `(` would have
 * built a pattern that matched something other than itself, or thrown.
 */
function escapeForRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Files that fire the given hook, by constant or by literal. */
function emittersOf(constant: string, value: string): string[] {
    const byConstant = new RegExp(`\\bHookNames\\.${constant}\\b`);
    const byLiteral = new RegExp(
        `(?:doAction|doActionAsync|applyFilters|applyFiltersAsync)\\s*(?:<[^>]*>)?\\(\\s*["']${escapeForRegex(value)}["']`,
    );
    return FILES.filter((f) => byConstant.test(f.source) || byLiteral.test(f.source)).map((f) =>
        path.relative(ROOT, f.path),
    );
}

const entries = Object.entries(HookNames) as [string, string][];

describe("HookNames", () => {
    it("is found, and is not empty", () => {
        expect(entries.length).toBeGreaterThan(8);
        expect(Object.values(HookNames)).toContain("user.deleted");
    });

    it("has an emitter for every name it declares", () => {
        const dead = entries
            .filter(([constant, value]) => emittersOf(constant, value).length === 0)
            .map(([, value]) => value)
            .sort();
        expect(dead).toEqual([]);
    });

    it("declares nothing the manifest already contributes declaratively", () => {
        // navLinks, footerLinks, navGroups and seoRoutes are the live
        // mechanism; a filter beside them is a second way to do one thing.
        const values = Object.values(HookNames);
        for (const gone of ["page.title", "page.meta", "navbar.links", "footer.links", "admin.sidebar"]) {
            expect(values, `${gone} is back`).not.toContain(gone);
        }
    });
});

describe("the erasure hook", () => {
    const deletion = fs.readFileSync(path.join(ROOT, "src/core/lib/user-deletion.ts"), "utf8");

    it("fires after the row has actually been anonymised", () => {
        // Firing first would hand listeners an account that might still fail
        // to erase, and a listener that hangs would hold up the erasure.
        const update = deletion.indexOf("prisma.user.update");
        const fire = deletion.indexOf("HookNames.USER_DELETED");
        expect(update).toBeGreaterThan(-1);
        expect(fire).toBeGreaterThan(update);
    });

    it("cannot turn a completed erasure into a failure", () => {
        const fire = deletion.slice(deletion.indexOf("HookNames.USER_DELETED") - 300);
        expect(fire.slice(0, 500)).toContain("catch");
    });
});

describe("two-factor-auth", () => {
    const dir = path.join(ROOT, "module-sources/two-factor-auth");
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "module.json"), "utf8")) as {
        hookListeners?: { hook: string; type: string; handler: string }[];
    };

    it("listens for the erasure it is the reason for", () => {
        const listener = manifest.hookListeners?.find((h) => h.hook === "user.deleted");
        expect(listener).toBeDefined();
        expect(listener!.type).toBe("action");
        expect(fs.existsSync(path.join(dir, listener!.handler))).toBe(true);
    });

    it("clears every column it added to User", () => {
        // The schema injects three; leaving any of them is the same defect.
        const handler = fs.readFileSync(path.join(dir, "hooks/on-user-deleted.ts"), "utf8");
        const schema = fs.readFileSync(path.join(dir, "schema.prisma"), "utf8");
        const injected = schema.slice(
            schema.indexOf("@@user-relations-start"),
            schema.indexOf("@@user-relations-end"),
        );
        const columns = [...injected.matchAll(/^\/\/\s+(\w+)\s+\S/gm)].map((m) => m[1]);
        expect(columns.length).toBe(3);
        for (const column of columns) {
            expect(handler, `${column} survives the erasure`).toContain(column);
        }
    });
});

describe("the email filters", () => {
    const email = fs.readFileSync(path.join(ROOT, "src/core/lib/email.ts"), "utf8");

    it("run at the one point every message passes through", () => {
        // sendEmail and the queue drain both call deliverViaProvider; putting
        // them anywhere else would filter one path and not the other.
        const provider = email.indexOf("async function deliverViaProvider");
        const subject = email.indexOf('applyFiltersAsync("email.subject"');
        const body = email.indexOf('applyFiltersAsync("email.body"');
        expect(provider).toBeGreaterThan(-1);
        expect(subject).toBeGreaterThan(provider);
        expect(body).toBeGreaterThan(provider);
    });

    it("run before the header injection guard, not after", () => {
        // A listener's output is no more trusted than a caller's, so
        // stripHeaderInjection has to be the last word on what is sent.
        const subject = email.indexOf('applyFiltersAsync("email.subject"');
        const strip = email.indexOf("stripHeaderInjection(subject)");
        expect(strip).toBeGreaterThan(subject);
    });

    it("sends what the filter returned", () => {
        // `mailer.send` rather than a vendor's client: core builds the message
        // and whatever transport is installed sends it.
        const send = email.slice(email.indexOf("mailer.send"));
        expect(send.slice(0, 300)).toContain("subject: safeSubject");
        expect(send.slice(0, 300)).toContain("html,");
        expect(send.slice(0, 300)).not.toContain("html: opts.html");
    });

    it("still sends when a listener throws", () => {
        const block = email.slice(email.indexOf('applyFiltersAsync("email.subject"'));
        expect(block.slice(0, 400)).toContain("catch");
    });
});
