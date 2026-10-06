import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    discardStagedBuild,
    isStagedBuildReady,
    markStagedBuildReady,
    prepareStagedBuild,
    promoteStagedBuild,
    recoverInterruptedPromotion,
    settleStagedBuilds,
    stagingDir,
    STAGING_TSCONFIG,
} from "@/core/lib/staged-build";
import { readBuildState } from "@/core/lib/build-state";

/**
 * A rebuild must not be able to take the running build away.
 *
 * Both in-place rebuilds - after a module install, and at boot - ran
 * `next build` into the live `.next`, which it empties first. A failed build
 * left no build at all: the public demo went down on 2026-10-05 with
 * "BUILD_ID is missing" because one module did not type-check, and while any
 * install-time build ran, visitors got pages whose chunks had already gone.
 *
 * These run against a real directory, because what is being tested is what
 * ends up on disk: which build is live after each way a rebuild can end.
 */

let root: string;
const live = (...p: string[]) => path.join(root, ".next", ...p);
const write = (file: string, body: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
};
const read = (file: string) => fs.readFileSync(file, "utf8");

/** A build as `next build` leaves one: an id, a manifest, server and static output. */
function makeBuild(dir: string, id: string): void {
    write(path.join(dir, "BUILD_ID"), id);
    write(path.join(dir, "build-manifest.json"), JSON.stringify({ id }));
    write(path.join(dir, "server", "app", "page.js"), `// ${id}`);
    write(path.join(dir, "static", "chunks", `${id}.js`), `// ${id}`);
}

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "staged-build-"));
    write(
        path.join(root, "tsconfig.json"),
        JSON.stringify({ include: ["next-env.d.ts", "**/*.ts", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"] }),
    );
    makeBuild(live(), "old");
    // What the running site cached. Not part of any build.
    write(live("cache", "images", "a.webp"), "cached");
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe("a staged build", () => {
    it("is written beside the live build, which it does not touch", () => {
        const env = prepareStagedBuild(root);

        expect(env.NEXT_DIST_DIR).toBe(".next/.staging");
        expect(read(live("BUILD_ID"))).toBe("old");
    });

    it("type-checks against its own route types, not the live build's", () => {
        const env = prepareStagedBuild(root);

        // The live build's `.next/types` name its routes. After an upgrade
        // that removed a page they name a file that is gone, and the rebuild
        // meant to bring the site forward would fail on them.
        expect(env.NEXT_TSCONFIG_PATH).toBe(STAGING_TSCONFIG);
        const tsconfig = JSON.parse(read(path.join(root, STAGING_TSCONFIG)));
        expect(tsconfig.extends).toBe("./tsconfig.json");
        expect(tsconfig.include).toEqual([
            "next-env.d.ts",
            "**/*.ts",
            ".next/.staging/types/**/*.ts",
            ".next/.staging/dev/types/**/*.ts",
        ]);
    });

    it("starts from nothing: an earlier staged build is thrown away", () => {
        makeBuild(stagingDir(root), "abandoned");
        prepareStagedBuild(root);
        expect(fs.existsSync(stagingDir(root))).toBe(false);
    });

    it("that failed is discarded, and the live build is what it was", () => {
        prepareStagedBuild(root);
        // `next build` got part of the way.
        write(path.join(stagingDir(root), "server", "half.js"), "");

        discardStagedBuild(root);

        expect(fs.existsSync(stagingDir(root))).toBe(false);
        expect(read(live("BUILD_ID"))).toBe("old");
        expect(read(live("static", "chunks", "old.js"))).toBe("// old");
    });

    it("cannot be marked ready unless next build finished it", () => {
        prepareStagedBuild(root);
        write(path.join(stagingDir(root), "server", "half.js"), "");

        expect(() => markStagedBuildReady(root)).toThrow(/no finished build/);
        expect(isStagedBuildReady(root)).toBe(false);
    });

    it("is ready once marked, and only then", () => {
        prepareStagedBuild(root);
        makeBuild(stagingDir(root), "new");
        expect(isStagedBuildReady(root)).toBe(false);

        markStagedBuildReady(root);
        expect(isStagedBuildReady(root)).toBe(true);
    });
});

describe("promoting a staged build", () => {
    function stageNew(): void {
        prepareStagedBuild(root);
        makeBuild(stagingDir(root), "new");
        markStagedBuildReady(root);
    }

    it("makes it the live build, with the record of what it was built from", () => {
        stageNew();
        promoteStagedBuild(root);

        expect(read(live("BUILD_ID"))).toBe("new");
        expect(read(live("static", "chunks", "new.js"))).toBe("// new");
        expect(fs.existsSync(live("static", "chunks", "old.js"))).toBe(false);
        expect(readBuildState(root)).not.toBeNull();
        expect(fs.existsSync(stagingDir(root))).toBe(false);
        expect(fs.existsSync(live(".previous"))).toBe(false);
    });

    it("keeps what the running site cached", () => {
        stageNew();
        promoteStagedBuild(root);
        expect(read(live("cache", "images", "a.webp"))).toBe("cached");
    });

    it("refuses a staged build that is not ready", () => {
        prepareStagedBuild(root);
        makeBuild(stagingDir(root), "unmarked");

        expect(() => promoteStagedBuild(root)).toThrow(/no staged build is ready/);
        expect(read(live("BUILD_ID"))).toBe("old");
    });

    it("re-points the relative links Turbopack makes for external packages", () => {
        // Turbopack links `<distDir>/node_modules/<pkg>-<hash>` to the
        // project's package with a path counted from the dist directory's
        // depth. Moved from `.next/.staging` to `.next` unchanged, it points
        // one directory too far, and every page that queries the database
        // fails to load @prisma/client.
        write(path.join(root, "node_modules", "@prisma", "client", "index.js"), "prisma");
        stageNew();
        const link = path.join(stagingDir(root), "node_modules", "@prisma", "client-2c3a");
        fs.mkdirSync(path.dirname(link), { recursive: true });
        fs.symlinkSync(path.relative(path.dirname(link), path.join(root, "node_modules", "@prisma", "client")), link);

        promoteStagedBuild(root);

        const landed = live("node_modules", "@prisma", "client-2c3a");
        expect(fs.readlinkSync(landed)).not.toMatch(/^\//);
        expect(read(path.join(landed, "index.js"))).toBe("prisma");
    });
});

describe("a promotion cut off half way", () => {
    /** Promote by hand up to a point, as a crash would leave it. */
    function cutOff(at: "before-commit" | "after-commit"): void {
        prepareStagedBuild(root);
        makeBuild(stagingDir(root), "new");
        markStagedBuildReady(root);

        const previous = live(".previous");
        fs.mkdirSync(previous);
        for (const name of ["BUILD_ID", "build-manifest.json", "server", "static"]) {
            fs.renameSync(live(name), path.join(previous, name));
        }
        // Some of the new build has come across.
        fs.renameSync(path.join(stagingDir(root), "static"), live("static"));
        if (at === "after-commit") {
            for (const name of ["server", "build-manifest.json", "blysis-build-state.json"]) {
                fs.renameSync(path.join(stagingDir(root), name), live(name));
            }
            fs.renameSync(path.join(stagingDir(root), "BUILD_ID"), live("BUILD_ID"));
        }
    }

    it("is rolled back when the new BUILD_ID had not landed", () => {
        cutOff("before-commit");

        expect(recoverInterruptedPromotion(root)).toBe("rolled-back");

        // One whole build, the previous one - not a mix of the two.
        expect(read(live("BUILD_ID"))).toBe("old");
        expect(read(live("static", "chunks", "old.js"))).toBe("// old");
        expect(fs.existsSync(live("static", "chunks", "new.js"))).toBe(false);
        expect(read(live("cache", "images", "a.webp"))).toBe("cached");
        // The staged build was half moved and is no longer whole.
        expect(fs.existsSync(stagingDir(root))).toBe(false);
        expect(fs.existsSync(live(".previous"))).toBe(false);
    });

    it("is finished when the new BUILD_ID had landed", () => {
        cutOff("after-commit");

        expect(recoverInterruptedPromotion(root)).toBe("finished");

        expect(read(live("BUILD_ID"))).toBe("new");
        expect(read(live("static", "chunks", "new.js"))).toBe("// new");
        expect(fs.existsSync(live(".previous"))).toBe(false);
        expect(fs.existsSync(stagingDir(root))).toBe(false);
    });

    it("leaves a boot with nothing cut off alone", () => {
        expect(recoverInterruptedPromotion(root)).toBe("none");
        expect(read(live("BUILD_ID"))).toBe("old");
    });
});

describe("every start", () => {
    it("puts live the build an install finished before restarting", () => {
        prepareStagedBuild(root);
        makeBuild(stagingDir(root), "new");
        markStagedBuildReady(root);

        const said: string[] = [];
        settleStagedBuilds(root, (msg) => said.push(msg));

        expect(read(live("BUILD_ID"))).toBe("new");
        expect(said).toEqual(["promoted the build a module change finished before the restart"]);
    });

    it("leaves an unfinished staged build alone", () => {
        prepareStagedBuild(root);
        write(path.join(stagingDir(root), "server", "half.js"), "");

        settleStagedBuilds(root);

        expect(read(live("BUILD_ID"))).toBe("old");
    });

    it("includes `npm start`, which is how systemd and pm2 bring the process back", () => {
        // The container's entry point settles through the reconciler. Under a
        // supervisor that runs `npm start`, an install's build would never go
        // live without this.
        const pkg = JSON.parse(read(path.join(process.cwd(), "package.json")));
        expect(pkg.scripts.prestart).toBe("tsx scripts/promote-staged-build.ts");
        expect(read(path.join(process.cwd(), "scripts/promote-staged-build.ts"))).toContain("settleStagedBuilds");
    });
});
