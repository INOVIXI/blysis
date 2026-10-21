import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { relativePath } from "./source-text";

/**
 * A settings field is a promise: type a value, press Save, something behaves
 * differently. `SettingsForm` keeps that promise only as far as the `Setting`
 * row - it writes whatever key the screen names and reports success, whether
 * or not a single line of code ever reads the key back.
 *
 * Nine of the fifty-seven fields on the shipped screens named a key nothing
 * read. Two modules offered a Resend API key, a from-address and a sender
 * name, and the mailer took all three from the environment instead: an
 * operator pasted their key into the admin panel, saw "Saved", and mail
 * stayed off with the key now sitting in the database earning nothing.
 * login-protection offered a maximum-login-attempts field while the lockout
 * threshold came from ACCOUNT_LOCKOUT_ATTEMPTS, so an operator who set 3
 * still got 10. Four more offered to rewrite email subjects and a welcome
 * body that nothing composed from.
 *
 * The three that named a real capability are wired up now; the rest are gone
 * from their screens. This keeps the next one from shipping: a field's key
 * has to be named by code somewhere other than the form that writes it.
 */

const root = path.resolve(import.meta.dirname, "../..");
// Deliberately not `tests/`: a key named only by a test is still a key no
// screen's promise is kept by, and this file names several of them.
const SCANNED = ["src/app", "src/core", "module-sources", "scripts"];

/**
 * Keys a screen writes on purpose without a reader in this repository, with
 * the reason each one is not the bug above.
 */
const NO_READER_ON_PURPOSE: Record<string, string> = {};

function sourceFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return /\.tsx?$/.test(entry.name) ? [full] : [];
    });
}

const files = SCANNED.flatMap((dir) => sourceFiles(path.join(root, dir)));
const contents = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]));

/** key -> the files whose `SettingsForm` declares it. */
const declared = new Map<string, Set<string>>();
for (const [file, source] of contents) {
    if (!source.includes("SettingsForm")) continue;
    for (const match of source.matchAll(/\{\s*key:\s*"([a-z0-9_]+)"/g)) {
        const key = match[1];
        if (!declared.has(key)) declared.set(key, new Set());
        declared.get(key)!.add(file);
    }
}

describe("a settings field changes something", () => {
    it("finds the settings screens", () => {
        expect(declared.size).toBeGreaterThan(40);
        // The three the mailer reads, and the one the lockout reads.
        for (const key of ["resend_api_key", "email_from", "email_from_name", "max_login_attempts"]) {
            expect(declared.has(key), `${key} is no longer offered anywhere`).toBe(true);
        }
    });

    it("every field's key is read by something other than the form", () => {
        const orphans: string[] = [];
        for (const [key, forms] of declared) {
            if (NO_READER_ON_PURPOSE[key] !== undefined) continue;
            const reader = [...contents].some(
                ([file, source]) => !forms.has(file) && source.includes(`"${key}"`),
            );
            if (!reader) {
                orphans.push(`${key} (offered by ${[...forms].map((f) => path.relative(root, f)).join(", ")})`);
            }
        }
        expect(
            orphans,
            "a field that saves and changes nothing is worse than no field: the operator " +
                "believes the setting took effect",
        ).toEqual([]);
    });

    it("keeps every deliberate exception explained", () => {
        for (const [key, reason] of Object.entries(NO_READER_ON_PURPOSE)) {
            expect(declared.has(key), `${key} is allowlisted but no screen offers it`).toBe(true);
            expect(reason.length, `${key} needs a reason`).toBeGreaterThan(40);
        }
    });
});

/**
 * The wiring itself, so the fix cannot be undone by deleting a read while
 * leaving the field in place.
 */
describe("the keys the screens promise are the keys the code reads", () => {
    const emailConfig = fs.readFileSync(path.join(root, "src/core/lib/email-config.ts"), "utf8");
    const securitySettings = fs.readFileSync(path.join(root, "src/core/lib/security-settings.ts"), "utf8");
    const lockout = fs.readFileSync(path.join(root, "src/core/lib/account-lockout.ts"), "utf8");
    const email = fs.readFileSync(path.join(root, "src/core/lib/email.ts"), "utf8");

    it("the mailer resolves its transport through the settings row", () => {
        // The return address is core's own vocabulary and stays a literal.
        for (const key of ["email_from", "email_from_name"]) {
            expect(emailConfig).toContain(`"${key}"`);
        }
        // The API key's name is the provider module's, so core asks for it
        // rather than spelling it: naming the key here would be core naming a
        // module, and it is a declared credential besides, which is why this
        // reads through the settings boundary instead of off the row.
        expect(emailConfig).toContain("ModuleEmailApiKeySettings");
        expect(emailConfig).toContain("readSettingValues");
        expect(emailConfig, "core must not spell a provider's key name").not.toMatch(
            /"[a-z_]*(api_key|secret|token)"/,
        );
        // The environment is the fallback, not the source, and it is declared
        // by the same module for the same reason.
        expect(emailConfig).toContain("ModuleEmailApiKeyEnvVars");
        expect(emailConfig).toContain("process.env.EMAIL_FROM");
        expect(email).toContain("getEmailConfig");
        expect(email, "the mailer must not read the environment behind the config").not.toContain(
            "process.env.RESEND_API_KEY",
        );
        expect(email).not.toContain("process.env.EMAIL_FROM");
    });

    it("the lockout threshold is the admin's row, clamped", () => {
        expect(securitySettings).toContain('maxLoginAttempts: "max_login_attempts"');
        expect(securitySettings).toContain("MAX_LOGIN_ATTEMPTS");
        expect(lockout).toContain("getBounded(MAX_LOGIN_ATTEMPTS)");
        // A threshold of one turns the control into a denial of service.
        const min = securitySettings.match(/MAX_LOGIN_ATTEMPTS[\s\S]*?min:\s*(\d+)/);
        expect(min, "MAX_LOGIN_ATTEMPTS declares no floor").not.toBeNull();
        expect(Number(min![1])).toBeGreaterThanOrEqual(3);
    });

    it("a settings write drops the mailer's cached transport", () => {
        const route = fs.readFileSync(path.join(root, "src/app/api/v1/settings/route.ts"), "utf8");
        expect(route).toContain("invalidateEmailConfig");
    });

    it("no module keeps a second mailer of its own", () => {
        const offenders = files
            .filter((f) => relativePath(root, f).startsWith("module-sources/"))
            .filter((f) => /from "resend"/.test(contents.get(f)!))
            .map((f) => relativePath(root, f));
        expect(
            offenders,
            "a module that builds its own Resend client skips the queue, the email hooks " +
                "and the header-injection guard, and ignores the admin's settings",
        ).toEqual([]);
    });
});
