/**
 * Runtime-resolved filesystem paths for module install/update/uninstall.
 *
 * Why a dedicated helper: Turbopack's NFT tracer follows `path.join(process.cwd(), …)`
 * calls up the import graph and, because they're unbounded, ends up tracing
 * the entire project into whichever serverless bundle references them.
 * Centralising the call here - with a single `/* turbopackIgnore: true *\/`
 * hint - keeps the bundle trace surgical while still letting admin routes
 * operate on the real working-directory tree at runtime.
 */

import path from "path";

const CWD = /* turbopackIgnore: true */ process.cwd();

export const MODULES_DIR = path.join(CWD, "src/modules");
export const TMP_DIR = path.join(CWD, "tmp");
export const BACKUPS_DIR = path.join(CWD, "backups");
export const PROJECT_ROOT = CWD;

/**
 * Join `segments` under `root` and return the result only if it stays there.
 *
 * Every install, update and upload route builds a directory out of an id
 * that arrived in a request body. All of them check that id against
 * `/^[a-z0-9-]+$/` first, so none of them was reachable - but the check and
 * the `path.join` sat far enough apart in a two hundred line handler that
 * neither a reader nor a static analyser could see they were connected, and
 * a future edit that moved or loosened the check would have gone unnoticed.
 *
 * This puts the containment where the path is built rather than where the
 * input arrives. It resolves both sides before comparing, so `..` segments,
 * absolute segments and symlink-free traversal are all caught, and it
 * returns `null` rather than throwing so a route answers 400 instead of 500.
 *
 * The id check stays: this is the second lock, not a replacement for the
 * first.
 *
 * Containment is decided by `path.relative` rather than a string prefix. The
 * prefix test refused every child of a filesystem root, on every platform:
 * `/` or `C:\` already ends in a separator, so the root plus one more is a
 * prefix of nothing. `path.relative` answers `..` for anything that climbs
 * out, and an absolute path when there is no relative route at all, as for
 * another drive or another UNC share. A child literally named `..foo` is
 * still inside, which is why the climb is tested as a whole segment.
 */
export function resolveWithin(root: string, ...segments: string[]): string | null {
    const base = path.resolve(root);
    const target = path.resolve(base, ...segments);
    const relative = path.relative(base, target);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    return target;
}
