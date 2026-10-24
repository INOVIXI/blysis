import fs from "fs";
import path from "path";
import {
    collectManifestFileRefs,
    manifestRefCandidates,
    type ValidatedModuleManifest,
} from "./module-manifest-schema";

/**
 * Filesystem-aware half of manifest ref validation.
 *
 * Every path that accepts a module - marketplace install, ZIP upload, update -
 * has to confirm the files a manifest names are actually in the payload before
 * it commits anything to disk. Each of those three routes used to inline its
 * own copy of the check, and `scripts/validate-module.ts` (the CI gate) had a
 * fourth. The copies disagreed:
 *
 *   - The routes compared the ref to the disk verbatim, so a manifest saying
 *     `components/Foo` was rejected even though `components/Foo.tsx` sat
 *     right there - the extensionless form the registry generator not only
 *     accepts but strips down to.
 *   - The CI gate was extension-tolerant, but only for five of the twenty-one
 *     keys that can carry a ref, and it checked `routes`/`adminRoutes`/`api`
 *     verbatim.
 *
 * Between them, fourteen of the forty-two first-party modules passed CI and
 * were impossible to install. One resolver, used by all four callers, is what
 * keeps that from happening again.
 */

export interface ManifestRefCheck {
    /** Refs whose path lands outside the module root. Always a hard reject. */
    escaping: string[];
    /** Refs that match no file under any extension the bundler would try. */
    missing: string[];
}

function isFile(p: string): boolean {
    try {
        return fs.statSync(p).isFile();
    } catch {
        return false;
    }
}

/**
 * Check every file a manifest references against `moduleRoot`.
 *
 * `moduleRoot` is wherever the module currently lives - the extracted target
 * directory, the staging directory of an update, or `module-sources/<id>` when
 * the caller is the CI gate.
 */
export function checkManifestFileRefs(
    moduleRoot: string,
    manifest: ValidatedModuleManifest,
): ManifestRefCheck {
    const root = path.resolve(moduleRoot);
    const prefix = root + path.sep;
    const escaping: string[] = [];
    const missing: string[] = [];

    for (const ref of collectManifestFileRefs(manifest)) {
        const resolved = manifestRefCandidates(ref).map((candidate) =>
            path.resolve(root, candidate),
        );

        // Every candidate is the same base path with a different extension, so
        // they escape the root together or not at all: an absolute ref, or one
        // climbing out with `..`, lands outside no matter what gets appended.
        if (!resolved.some((p) => p.startsWith(prefix))) {
            escaping.push(ref);
            continue;
        }

        if (!resolved.some(isFile)) missing.push(ref);
    }

    return { escaping, missing };
}
