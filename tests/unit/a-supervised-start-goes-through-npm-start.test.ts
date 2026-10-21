// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * The PM2 config starts the app the way an install needs it started.
 *
 * Installing a module builds into `.next/.staging` and exits; the staged build
 * only replaces the live one in `prestart` (`scripts/promote-staged-build.ts`),
 * which runs for `npm start` and never for a bare `next start`. The README says
 * as much. `ecosystem.config.cjs` ran `npx next start`, so under PM2 every
 * install built, restarted, and went on serving the build from before it: the
 * module was installed and nowhere to be seen.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);

interface PmApp {
    script: string;
    args?: string;
}

const { apps } = require(path.join(ROOT, "ecosystem.config.cjs")) as { apps: PmApp[] };

describe("the PM2 config", () => {
    it("starts through npm start, so prestart promotes a staged build", () => {
        expect(apps).toHaveLength(1);
        expect(apps[0].script).toBe("npm");
        expect(apps[0].args?.split(/\s+/)[0]).toBe("start");
    });

    it("keeps the port and host the deployment expects", () => {
        expect(apps[0].args).toMatch(/-- .*-p 3001/);
        expect(apps[0].args).toMatch(/-H 0\.0\.0\.0/);
    });
});
