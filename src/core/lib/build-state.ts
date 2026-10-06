/**
 * Build-state reconciliation.
 *
 * Blysis compiles module pages into the Next.js build, so `src/modules/` and
 * `.next/` have to agree with each other. Three events break that agreement,
 * and until this file existed all three broke it silently:
 *
 *  1. **An admin installs or removes a module.** `install-lock` rebuilds, but
 *     the running `next start` read its manifests at boot and keeps serving
 *     the old build until the process is replaced.
 *  2. **The operator runs `blysis update`.** A new image arrives carrying a
 *     `.next` built from zero modules, while the `modules` volume still holds
 *     the admin's modules - every installed module vanishes from the app.
 *  3. **A build is interrupted** (OOM, `docker kill` mid-install) and leaves
 *     `.next` matching neither the old nor the new module set.
 *
 * The fix is a fingerprint. After every successful build the module set is
 * hashed and written beside the build; at boot `scripts/reconcile-build.ts`
 * compares the hash against what is actually installed and rebuilds when they
 * disagree. The process therefore always serves a build that matches disk,
 * whatever happened while it was down.
 *
 * Two artifacts have to be reconciled, and they have different lifetimes:
 *
 *  - **The Next build** (`.next`) is a named volume in production, so it
 *    outlives the container.
 *  - **The generated Prisma client** (`node_modules/.prisma`) lives in the
 *    image layer, so it is reset to the image's copy every time the container
 *    is recreated - losing every module model that was generated into it.
 *
 * That difference is a bug generator: recreating a container left a build that
 * knew about the blog module and a Prisma client that did not, so every
 * module query failed with `Cannot read properties of undefined`. Each
 * artifact therefore carries its own marker, stored beside itself so it shares
 * exactly that artifact's lifetime.
 *
 * Known limit: the fingerprint covers each module's id, version and the bytes
 * of its `module.json`. Editing a module's *code* in place without touching
 * its manifest does not change the fingerprint. That is deliberate - install,
 * update and remove all go through the manifest, and hashing every file of
 * every module on every boot would cost more than it protects.
 */

import { createHash } from "crypto";
import fs from "fs";
import path from "path";

/** Written into `.next/` after a successful build. */
export interface BuildState {
    /** Fingerprint of the module set the build was produced from. */
    moduleFingerprint: string;
    /** `.next/BUILD_ID` of the image this build belongs to (see below). */
    imageBuildId: string | null;
    /** ISO timestamp, for operators reading the file by hand. */
    builtAt: string;
}

export type DriftReason =
    | { kind: "no-build"; detail: string }
    | { kind: "no-state"; detail: string }
    | { kind: "image-changed"; detail: string }
    | { kind: "modules-changed"; detail: string };

export const STATE_FILENAME = "blysis-build-state.json";

/**
 * Marker for the generated Prisma client. Lives in node_modules so it is
 * discarded exactly when the client it describes is. Dot-prefixed: npm ignores
 * such entries, so `npm prune` and `npm ci` leave it alone rather than
 * treating it as an extraneous package.
 */
const SCHEMA_STATE_FILENAME = ".blysis-schema-state.json";

/**
 * Baked into the image next to `.next` by the Dockerfile. `.next` itself is a
 * volume in production (so a rebuild survives container replacement), which
 * means the `.next/BUILD_ID` of a freshly pulled image is *not* visible at
 * `/app/.next/BUILD_ID` - the stale volume masks it. This unmasked copy is how
 * we notice that the image changed under us.
 */
const IMAGE_BUILD_ID_FILE = ".blysis-image-build-id";

/** What `computeModuleFingerprint` returns when nothing is installed. */
const EMPTY_FINGERPRINT = createHash("sha256").digest("hex");

function nextDir(root: string = process.cwd()): string {
    return path.join(root, ".next");
}

/**
 * Hash of the installed module set: each module's id, version and manifest
 * bytes, in lexical id order so the result never depends on filesystem
 * enumeration order.
 */
export function computeModuleFingerprint(root: string = process.cwd()): string {
    const modulesDir = path.join(root, "src/modules");
    const hash = createHash("sha256");

    let entries: string[] = [];
    if (fs.existsSync(modulesDir)) {
        entries = fs
            .readdirSync(modulesDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name)
            .sort();
    }

    for (const name of entries) {
        const manifestPath = path.join(modulesDir, name, "module.json");
        if (!fs.existsSync(manifestPath)) continue;
        hash.update(name);
        hash.update("\0");
        hash.update(fs.readFileSync(manifestPath));
        hash.update("\0");
    }

    return hash.digest("hex");
}

/** The image's own build id, or null outside a container image. */
function readImageBuildId(root: string = process.cwd()): string | null {
    const file = path.join(root, IMAGE_BUILD_ID_FILE);
    try {
        return fs.readFileSync(file, "utf8").trim() || null;
    } catch {
        return null;
    }
}

export function readBuildState(root: string = process.cwd()): BuildState | null {
    try {
        const raw = fs.readFileSync(path.join(nextDir(root), STATE_FILENAME), "utf8");
        const parsed: unknown = JSON.parse(raw);
        if (
            typeof parsed === "object" &&
            parsed !== null &&
            typeof (parsed as BuildState).moduleFingerprint === "string"
        ) {
            return parsed as BuildState;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Record that the build now on disk was produced from the module set now on
 * disk. Call this only after a build actually succeeded - writing it earlier
 * would tell the next boot that a broken build is current.
 *
 * `dir` is the build being described: the live `.next` by default, or a
 * staged build that will carry the record with it when it is promoted (see
 * staged-build.ts).
 */
export function writeBuildState(root: string = process.cwd(), dir: string = nextDir(root)): BuildState {
    const state: BuildState = {
        moduleFingerprint: computeModuleFingerprint(root),
        imageBuildId: readImageBuildId(root),
        builtAt: new Date().toISOString(),
    };
    fs.mkdirSync(dir, { recursive: true });
    // Write-then-rename: a container killed mid-write must not leave a
    // truncated state file that parses as "no state" and forces a rebuild.
    const tmp = path.join(dir, `${STATE_FILENAME}.tmp`);
    fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
    fs.renameSync(tmp, path.join(dir, STATE_FILENAME));
    return state;
}

/**
 * Why the build on disk cannot be trusted, or null when it matches.
 *
 * The `no-state` case covers a first boot from a fresh image: Docker seeds a
 * new volume from the image layer, so `.next` is the image's build and the
 * state file does not exist yet. That is only drift if modules are already
 * installed - otherwise we adopt the build and record its fingerprint.
 */
export function detectDrift(root: string = process.cwd()): DriftReason | null {
    const buildDir = nextDir(root);
    if (!fs.existsSync(path.join(buildDir, "BUILD_ID"))) {
        return { kind: "no-build", detail: `${buildDir}/BUILD_ID is missing` };
    }

    const current = computeModuleFingerprint(root);
    const imageBuildId = readImageBuildId(root);
    const state = readBuildState(root);

    if (!state) {
        if (current === EMPTY_FINGERPRINT) return null;
        return {
            kind: "no-state",
            detail: "build carries no fingerprint but modules are installed",
        };
    }

    if (imageBuildId && state.imageBuildId !== imageBuildId) {
        return {
            kind: "image-changed",
            detail: `build belongs to image ${state.imageBuildId ?? "(unknown)"}, running image is ${imageBuildId}`,
        };
    }

    if (state.moduleFingerprint !== current) {
        return {
            kind: "modules-changed",
            detail: `installed modules hash ${current.slice(0, 12)}, build was made from ${state.moduleFingerprint.slice(0, 12)}`,
        };
    }

    return null;
}


/** Written into node_modules after the Prisma client is regenerated. */
export interface SchemaState {
    moduleFingerprint: string;
    generatedAt: string;
}

function schemaStatePath(root: string): string {
    return path.join(root, "node_modules", SCHEMA_STATE_FILENAME);
}

export function readSchemaState(root: string = process.cwd()): SchemaState | null {
    try {
        const parsed: unknown = JSON.parse(fs.readFileSync(schemaStatePath(root), "utf8"));
        if (
            typeof parsed === "object" &&
            parsed !== null &&
            typeof (parsed as SchemaState).moduleFingerprint === "string"
        ) {
            return parsed as SchemaState;
        }
        return null;
    } catch {
        return null;
    }
}

/** Call only after `merge-schemas` regenerated the client successfully. */
export function writeSchemaState(root: string = process.cwd()): SchemaState {
    const state: SchemaState = {
        moduleFingerprint: computeModuleFingerprint(root),
        generatedAt: new Date().toISOString(),
    };
    const file = schemaStatePath(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
    fs.renameSync(tmp, file);
    return state;
}

/**
 * Whether the generated Prisma client is missing models for the installed
 * modules. Same shape as `detectDrift`, and same reasoning for the
 * marker-absent case: a fresh image has a client generated from zero modules
 * and no marker, which is only wrong if modules are installed.
 */
export function detectSchemaDrift(root: string = process.cwd()): DriftReason | null {
    const current = computeModuleFingerprint(root);
    const state = readSchemaState(root);

    if (!state) {
        if (current === EMPTY_FINGERPRINT) return null;
        return {
            kind: "no-state",
            detail: "Prisma client carries no fingerprint but modules are installed",
        };
    }

    if (state.moduleFingerprint !== current) {
        return {
            kind: "modules-changed",
            detail: `installed modules hash ${current.slice(0, 12)}, client was generated from ${state.moduleFingerprint.slice(0, 12)}`,
        };
    }

    return null;
}
