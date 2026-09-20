// @vitest-environment node
/**
 * A module that takes something written can ask whether a human wrote it.
 *
 * Core already had both halves of a challenge: a slot the widget is drawn
 * into, and a filter run before the request is honoured. Measured on
 * 2026-09-20, neither was reachable from a module. `AuthChallenge` and
 * `useAuthChallenge` are not exported from `@/core/sdk/ui`, `runAuthChallenge`
 * is not in `@/core/sdk/server`, and the action was a closed union of three
 * words - `login`, `register`, `forgotPassword` - so there was no way to name
 * a forum topic or a contact form even if there had been.
 *
 * So the only protection a public form had was a rate limit, and the one form
 * a stranger can write through without an account - a custom form's
 * submission - had nothing but five a minute per address.
 *
 * A place a challenge can be asked is declared in a manifest, the way a nav
 * link is, so an operator is offered the real list rather than two hard-coded
 * switches. Core's own three are in that list beside the modules'.
 *
 * The wire names still say `auth.challenge` and `auth.form.challenge`. They
 * are the module-facing contract, every module in the tree declares
 * `coreVersion: "^5.0.0"`, and renaming them would refuse all eighty-nine
 * until each was republished. The names in the SDK say what the thing is.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

/** Every module on, unless a test says otherwise. */
function withModules(points: { id: string; labelKey: string; module: string }[], states: Record<string, boolean> = {}) {
    vi.doMock("@/core/generated/module-registry", () => ({ ModuleChallengePoints: points }));
    vi.doMock("@/core/lib/module-cache", () => ({ getModuleStates: async () => states }));
}

describe("the places a challenge can be asked", () => {
    beforeEach(() => { vi.resetModules(); withModules([]); });
    afterEach(() => { vi.doUnmock("@/core/generated/module-registry"); vi.doUnmock("@/core/lib/module-cache"); vi.resetModules(); });

    it("holds the three forms core owns", async () => {
        const { challengePoints } = await import("@/core/lib/challenge-points");
        const ids = (await challengePoints()).map((one) => one.id);
        expect(ids).toContain("login");
        expect(ids).toContain("register");
        expect(ids).toContain("forgotPassword");
    });

    it("names every one of them, so an operator reads a name and not an id", async () => {
        const { challengePoints } = await import("@/core/lib/challenge-points");
        for (const point of await challengePoints()) {
            expect(point.labelKey, point.id).toBeTruthy();
        }
    });

    it("is a manifest field a module can declare", () => {
        const schema = read("src/core/lib/module-manifest-schema.ts");
        expect(schema).toContain("challengePoints");
        const generator = read("scripts/generate-registry.ts");
        expect(generator).toContain("challengePoints");
    });

    it("carries whatever the installed modules declared", async () => {
        withModules([{ id: "forms.submit", labelKey: "customForms.adm_challengePoint", module: "custom-forms" }]);
        const { challengePoints } = await import("@/core/lib/challenge-points");
        expect((await challengePoints()).map((one) => one.id)).toContain("forms.submit");
    });

    it("leaves out a form belonging to a module the operator switched off", async () => {
        // A point on a form nobody can reach is a switch that protects
        // nothing, and an operator would have no way to tell.
        withModules(
            [{ id: "forms.submit", labelKey: "customForms.adm_challengePoint", module: "custom-forms" }],
            { "custom-forms": false },
        );
        const { challengePoints } = await import("@/core/lib/challenge-points");
        const ids = (await challengePoints()).map((one) => one.id);
        expect(ids).not.toContain("forms.submit");
        expect(ids).toContain("login");
    });
});

describe("what a module is given to ask with", () => {
    it("is a widget it can put in its own form", () => {
        // Read as source: the UI barrel pulls next-intl's navigation, which
        // does not load outside the Next bundler, and what is being checked
        // is that the export exists at all.
        const ui = read("src/core/sdk/ui.ts");
        expect(ui).toContain("export { Challenge, useChallenge }");
    });

    it("is a check it can run before it writes anything", () => {
        const server = read("src/core/sdk/server.ts");
        expect(server).toContain("export { runChallenge }");
        expect(server).toContain("challengeFieldsFrom");
    });

    it("is reachable without importing core's own files", () => {
        // A module may only reach core through the SDK, so a challenge that
        // lived at `@/core/lib/auth-challenge` was a challenge no module could
        // use.
        const sdk = read("src/core/sdk/server.ts");
        expect(sdk).toContain("runChallenge");
        expect(sdk).toContain("challengePoints");
        const ui = read("src/core/sdk/ui.ts");
        expect(ui).toContain("Challenge");
    });
});

describe("a point a module named", () => {
    it("is asked of the listeners like any other", async () => {
        vi.resetModules();
        const asked: unknown[] = [];
        vi.doMock("@/core/lib/hooks", () => ({
            applyFiltersAsync: async (_name: string, value: unknown, context: unknown) => {
                asked.push(context);
                return value;
            },
        }));
        const { runChallenge } = await import("@/core/lib/auth-challenge");
        const answer = await runChallenge({ action: "forms.submit", fields: { token: "t" }, ip: null });

        expect(answer).toEqual({ ok: true, code: null });
        expect(asked[0]).toMatchObject({ action: "forms.submit" });
        vi.doUnmock("@/core/lib/hooks");
        vi.resetModules();
    });

    it("lets everything through when a listener throws, rather than closing the form", async () => {
        vi.resetModules();
        vi.doMock("@/core/lib/hooks", () => ({
            applyFiltersAsync: async () => { throw new Error("the module is broken"); },
        }));
        const { runChallenge } = await import("@/core/lib/auth-challenge");
        expect(await runChallenge({ action: "forms.submit", fields: {}, ip: null })).toEqual({ ok: true, code: null });
        vi.doUnmock("@/core/lib/hooks");
        vi.resetModules();
    });
});
