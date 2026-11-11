import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
    computeModuleFingerprint,
    detectDrift,
    detectSchemaDrift,
    readBuildState,
    readSchemaState,
    writeBuildState,
    writeSchemaState,
} from "@/core/lib/build-state";

/**
 * These cases are the four ways a Next build and src/modules/ can disagree.
 * Every one of them shipped as a silent failure before the reconciler existed:
 * an install that rebuilt and served the old build, and an update that served
 * a zero-module build over a volume full of the admin's modules.
 */

let root: string;

function makeModule(id: string, version = "1.0.0"): void {
    const dir = path.join(root, "src/modules", id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "module.json"), JSON.stringify({ id, version }));
}

/** Stand in for a completed `next build`. */
function makeBuild(buildId = "build-1"): void {
    fs.mkdirSync(path.join(root, ".next"), { recursive: true });
    fs.writeFileSync(path.join(root, ".next/BUILD_ID"), buildId);
}

/** Stand in for the Dockerfile's unmasked build-id stamp. */
function stampImage(buildId: string): void {
    fs.writeFileSync(path.join(root, ".blysis-image-build-id"), `${buildId}\n`);
}

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "blysis-build-state-"));
    fs.mkdirSync(path.join(root, "src/modules"), { recursive: true });
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe("computeModuleFingerprint", () => {
    it("is stable across calls", () => {
        makeModule("blog");
        expect(computeModuleFingerprint(root)).toBe(computeModuleFingerprint(root));
    });

    it("does not depend on directory creation order", () => {
        makeModule("blog");
        makeModule("store");
        const a = computeModuleFingerprint(root);

        fs.rmSync(path.join(root, "src/modules"), { recursive: true });
        makeModule("store");
        makeModule("blog");
        expect(computeModuleFingerprint(root)).toBe(a);
    });

    it("changes when a module is added, removed or version-bumped", () => {
        const empty = computeModuleFingerprint(root);

        makeModule("blog", "1.0.0");
        const one = computeModuleFingerprint(root);
        expect(one).not.toBe(empty);

        makeModule("blog", "1.1.0");
        expect(computeModuleFingerprint(root)).not.toBe(one);

        fs.rmSync(path.join(root, "src/modules/blog"), { recursive: true });
        expect(computeModuleFingerprint(root)).toBe(empty);
    });

    it("ignores a directory with no manifest", () => {
        const empty = computeModuleFingerprint(root);
        fs.mkdirSync(path.join(root, "src/modules/not-a-module"), { recursive: true });
        expect(computeModuleFingerprint(root)).toBe(empty);
    });

    it("treats a missing modules directory as no modules", () => {
        const empty = computeModuleFingerprint(root);
        fs.rmSync(path.join(root, "src/modules"), { recursive: true });
        expect(computeModuleFingerprint(root)).toBe(empty);
    });
});

describe("detectDrift", () => {
    it("reports no-build when there is no build at all", () => {
        expect(detectDrift(root)).toEqual({
            kind: "no-build",
            detail: expect.stringContaining("BUILD_ID"),
        });
    });

    it("accepts a fresh image with no state file and no modules", () => {
        makeBuild();
        expect(detectDrift(root)).toBeNull();
    });

    it("reports drift when modules exist but the build carries no fingerprint", () => {
        makeBuild();
        makeModule("blog");
        expect(detectDrift(root)?.kind).toBe("no-state");
    });

    it("accepts a build whose fingerprint matches the installed modules", () => {
        makeBuild();
        makeModule("blog");
        writeBuildState(root);
        expect(detectDrift(root)).toBeNull();
    });

    it("reports drift after a module is installed post-build", () => {
        makeBuild();
        writeBuildState(root);
        makeModule("blog");
        expect(detectDrift(root)?.kind).toBe("modules-changed");
    });

    it("reports drift after a module is uninstalled post-build", () => {
        makeBuild();
        makeModule("blog");
        writeBuildState(root);
        fs.rmSync(path.join(root, "src/modules/blog"), { recursive: true });
        expect(detectDrift(root)?.kind).toBe("modules-changed");
    });

    // The `blysis update` case: the modules volume and the .next volume both
    // survive, so the module set matches - but the build belongs to the image
    // that was just replaced.
    it("reports drift when the image changed under an unchanged module set", () => {
        makeBuild();
        stampImage("image-a");
        makeModule("blog");
        writeBuildState(root);

        stampImage("image-b");
        expect(detectDrift(root)).toEqual({
            kind: "image-changed",
            detail: expect.stringContaining("image-b"),
        });
    });

    it("ignores the image stamp outside a container image", () => {
        makeBuild();
        makeModule("blog");
        writeBuildState(root);
        expect(readBuildState(root)?.imageBuildId).toBeNull();
        expect(detectDrift(root)).toBeNull();
    });
});

describe("writeBuildState", () => {
    it("round-trips through readBuildState", () => {
        makeBuild();
        stampImage("image-a");
        makeModule("blog");

        const written = writeBuildState(root);
        expect(readBuildState(root)).toEqual(written);
        expect(written.imageBuildId).toBe("image-a");
        expect(written.moduleFingerprint).toBe(computeModuleFingerprint(root));
    });

    // A module installed while `next build` ran is on disk when the build
    // finishes but not in the route table it compiled. Hashing at write time
    // recorded it as built, the next boot found no drift, and every endpoint
    // of that module answered 404 until the state file was removed by hand.
    it("records the module set the build started from, so a module installed during it is drift", () => {
        makeBuild();
        makeModule("blog");
        const atStart = computeModuleFingerprint(root);

        makeModule("store");
        const written = writeBuildState(root, path.join(root, ".next"), atStart);

        expect(written.moduleFingerprint).toBe(atStart);
        expect(readBuildState(root)?.moduleFingerprint).toBe(atStart);
        expect(detectDrift(root)?.kind).toBe("modules-changed");
    });

    it("leaves no temp file behind", () => {
        makeBuild();
        writeBuildState(root);
        expect(fs.readdirSync(path.join(root, ".next")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    });

    it("reads back as absent when the state file is corrupt", () => {
        makeBuild();
        writeBuildState(root);
        fs.writeFileSync(path.join(root, ".next/blysis-build-state.json"), "{ not json");
        expect(readBuildState(root)).toBeNull();
    });
});

// The Prisma client lives in node_modules - an image layer - while the build
// lives in a volume. Recreating a container therefore reverts the client to
// its zero-module version while keeping a build that expects every module, and
// every module query fails with `undefined.findMany`. This is why the two
// artifacts carry separate markers rather than sharing one.
describe("detectSchemaDrift", () => {
    it("accepts a fresh image with no marker and no modules", () => {
        expect(detectSchemaDrift(root)).toBeNull();
    });

    it("reports drift when modules exist but the client carries no marker", () => {
        makeModule("blog");
        expect(detectSchemaDrift(root)?.kind).toBe("no-state");
    });

    it("accepts a client generated from the installed modules", () => {
        makeModule("blog");
        writeSchemaState(root);
        expect(detectSchemaDrift(root)).toBeNull();
    });

    it("reports drift after a module is installed", () => {
        writeSchemaState(root);
        makeModule("blog");
        expect(detectSchemaDrift(root)?.kind).toBe("modules-changed");
    });

    // The container-recreation case: the build volume survives, so the build
    // marker still matches, but node_modules came back from the image.
    it("is independent of the build marker", () => {
        makeBuild();
        makeModule("blog");
        writeBuildState(root);
        writeSchemaState(root);

        // Container recreated: node_modules - and the marker in it - is gone.
        fs.rmSync(path.join(root, "node_modules"), { recursive: true, force: true });

        expect(detectDrift(root)).toBeNull();
        expect(detectSchemaDrift(root)?.kind).toBe("no-state");
    });

    it("records the module set the client was generated from, not the one at write time", () => {
        makeModule("blog");
        const atStart = computeModuleFingerprint(root);

        makeModule("store");
        expect(writeSchemaState(root, atStart).moduleFingerprint).toBe(atStart);
        expect(detectSchemaDrift(root)?.kind).toBe("modules-changed");
    });

    it("round-trips through readSchemaState", () => {
        makeModule("blog");
        const written = writeSchemaState(root);
        expect(readSchemaState(root)).toEqual(written);
        expect(written.moduleFingerprint).toBe(computeModuleFingerprint(root));
    });
});
