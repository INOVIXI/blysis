import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { checkPasswordPolicy, PASSWORD_POLICY } from "@/core/lib/password-policy";
import { clampMinPasswordLength } from "@/core/lib/security-settings";
import { relativePath, stripComments } from "./source-text";

/**
 * The site has one password policy: ten characters, an uppercase, a digit, and
 * not one of the two dozen passwords everybody tries first, plus whatever
 * higher minimum the operator set in Admin > Settings. `enforcePasswordPolicy`
 * is the only thing that applies all of it, and `security-settings.ts` says of
 * it that "every flow that accepts a new password goes through this".
 *
 * Two did not. `POST /api/setup`, which creates the first administrator, asked
 * zod for eight characters and nothing else, so the most privileged account on
 * a new install could be `12345678` while a visitor registering an ordinary
 * account was held to the full policy. `POST /api/v1/users`, where an admin
 * creates an account for somebody else, checked length against a separate pair
 * of constants that had drifted two characters below the policy's own.
 *
 * The rule this pins is the one that is actually checkable: a route that
 * writes a password onto a user row must have run the password through the
 * policy first. It is deliberately about the write rather than about
 * `bcrypt.hash`, because API keys and two-factor backup codes are hashed too
 * and answer to nothing here.
 */

const ROOT = path.resolve(__dirname, "../..");

/** A Prisma write that sets a user's password column to a hash, however it is named. */
const WRITES_PASSWORD = /\bpassword:\s*(?:await\s+(?:\w+\.)?hash\w*\(|\w*[Hh]ash\w*\b)/;

/**
 * Imports and comments are stripped before the call is looked for. An import
 * alone is what a half-reverted change leaves behind, and a comment naming the
 * call is a note about it; neither must read as enforcement.
 */
function withoutImports(body: string): string {
    return stripComments(body).replace(/(?:^|\n)\s*import\s[^;]*;?/g, "\n");
}

function walk(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

const apiFiles = [
    ...walk(path.join(ROOT, "src", "app", "api")),
    ...fs
        .readdirSync(path.join(ROOT, "module-sources"), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .flatMap((e) => walk(path.join(ROOT, "module-sources", e.name, "api"))),
];

const passwordWriters = apiFiles
    .map((file) => ({ file, body: fs.readFileSync(file, "utf8") }))
    .filter(({ body }) => WRITES_PASSWORD.test(body));

describe("password writes", () => {
    it("finds the routes that set a password", () => {
        expect(passwordWriters.length).toBeGreaterThanOrEqual(5);
    });

    it("runs every one of them through the shared policy", () => {
        const unchecked = passwordWriters
            .filter(({ body }) => !withoutImports(body).includes("enforcePasswordPolicy("))
            .map(({ file }) => relativePath(ROOT, file));
        expect(unchecked).toEqual([]);
    });

    it("knows a password write by its hash, whatever the hash is called", () => {
        expect(WRITES_PASSWORD.test("data: { password: await hash(input, 12) }")).toBe(true);
        expect(WRITES_PASSWORD.test("data: { password: newHash }")).toBe(true);
        expect(WRITES_PASSWORD.test("select: { password: true }")).toBe(false);
    });

    it("does not take a comment naming the policy for a call to it", () => {
        expect(withoutImports("// enforcePasswordPolicy(password) used to run here")).not.toContain(
            "enforcePasswordPolicy(",
        );
    });

    it("leaves no second, looser password length in the constants", () => {
        const constants = fs.readFileSync(path.join(ROOT, "src", "core", "lib", "constants.ts"), "utf8");
        expect(constants).not.toMatch(/PASSWORD_(?:MIN|MAX)_LENGTH/);
    });
});

describe("the policy the setup form now answers to", () => {
    it("refuses the eight-character password the setup schema used to take", () => {
        expect(checkPasswordPolicy("12345678").ok).toBe(false);
        expect(checkPasswordPolicy("Passw0rd").ok).toBe(false);
    });

    it("refuses a long password that is still on the common list", () => {
        expect(checkPasswordPolicy("Password123").reason).toBe("too_common");
    });

    it("refuses a long password with no uppercase or no digit", () => {
        expect(checkPasswordPolicy("abcdefghijk1").reason).toBe("missing_upper");
        expect(checkPasswordPolicy("Abcdefghijkl").reason).toBe("missing_digit");
    });

    it("accepts one that clears every rule", () => {
        expect(checkPasswordPolicy("Kx7mqrtzUw2").ok).toBe(true);
    });

    it("never lets an operator set a minimum below the built-in one", () => {
        expect(clampMinPasswordLength(1)).toBe(PASSWORD_POLICY.MIN_LENGTH);
        expect(clampMinPasswordLength("4")).toBe(PASSWORD_POLICY.MIN_LENGTH);
        expect(clampMinPasswordLength(null)).toBe(PASSWORD_POLICY.MIN_LENGTH);
        expect(clampMinPasswordLength(16)).toBe(16);
    });
});
