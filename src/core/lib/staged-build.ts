/**
 * A rebuild that cannot take the running build away.
 *
 * Blysis rebuilds itself in place: after a module install (install-lock.ts)
 * and at boot when the build and the modules disagree (reconcile-build.ts).
 * Both used to run `next build` into the live `.next`, and `next build` starts
 * by emptying its output directory. Two things followed:
 *
 *  - **During every install-time build** the running server kept rendering
 *    pages that name the old build's chunks while those files were already
 *    gone. Every visitor in that window got a page with no scripts or styles:
 *    404s for `/_next/static/chunks/...`, served as HTML, refused by the
 *    browser as the wrong MIME type.
 *  - **After a failed build** there was no build at all. The reconciler
 *    said "starting the previous build" and `next start` found nothing to
 *    start; the next boot stopped at "BUILD_ID is missing" and stayed down.
 *    A module that did not type-check took the whole site with it, not just
 *    itself. That is how the public demo went down on 2026-10-05.
 *
 * So a rebuild goes to a staging directory and only a finished one replaces
 * the live build:
 *
 *  1. `next build` writes to `.next/.staging`. Inside `.next` on purpose:
 *     `.next` is a volume in every supported deployment (a named volume in
 *     docker-compose, a PVC subPath on Kubernetes) and the mount point itself
 *     cannot be renamed, so the only place a finished build can be swapped in
 *     with renames rather than a copy is a directory on the same volume.
 *  2. A failed build is discarded. The live build was never touched.
 *  3. A finished build is marked ready by writing its build-state record into
 *     it, and promoted while no server is reading `.next`: at boot, before
 *     `next start`. The install path therefore builds, marks, and asks for a
 *     restart; the reconciler promotes on the way back up.
 *
 * Promotion moves the live build aside into `.next/.previous`, moves the new
 * one in, and moves its `BUILD_ID` last. A live `BUILD_ID` is the commit
 * point: if a promotion is cut off (power, OOM kill, a node drained mid-boot)
 * the next boot finishes it when the new `BUILD_ID` is in place and rolls it
 * back when it is not. Either way it starts from one whole build.
 *
 * A build is not quite position-independent: Turbopack links the server
 * packages it keeps external (`@prisma/client`, `jsdom`) from
 * `<distDir>/node_modules` with RELATIVE symlinks counted from the dist
 * directory's depth. Moved up from `.next/.staging` to `.next` unchanged, each
 * one points a directory too far and every page that queries the database
 * fails to load its client. Promotion re-points them for where they land.
 * (The `distDir` Next writes into each route module needs nothing: `next
 * start` hands every request its own.)
 *
 * `cache` stays where it is through all of this. It holds what the running
 * site cached (optimised images, fetch results), not part of a build.
 */

import fs from "fs";
import path from "path";
import { STATE_FILENAME, writeBuildState } from "./build-state";

/** Where a staged build is written, relative to `.next`. */
const STAGING_DIRNAME = ".staging";
/** Where the live build waits while a promotion is in progress. */
const PREVIOUS_DIRNAME = ".previous";
/**
 * The tsconfig a staged build type-checks with, at the project root.
 *
 * The project's own tsconfig includes `.next/types/**`, which is the LIVE
 * build's generated route types. A staged build checking against those would
 * be checking the previous build's routes: after an upgrade that removed a
 * page they name a file that no longer exists, and the rebuild that was meant
 * to bring the site forward fails on it. This one points the same globs at
 * the staged build's own types instead.
 */
export const STAGING_TSCONFIG = "tsconfig.staging.json";

/** Entries of `.next` that are not part of a build and never move. */
const NOT_A_BUILD = new Set([STAGING_DIRNAME, PREVIOUS_DIRNAME, "cache"]);

function liveDir(root: string): string {
    return path.join(root, ".next");
}

export function stagingDir(root: string = process.cwd()): string {
    return path.join(liveDir(root), STAGING_DIRNAME);
}

function previousDir(root: string): string {
    return path.join(liveDir(root), PREVIOUS_DIRNAME);
}

function remove(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
}

/** The entries of a build directory that belong to the build. */
function buildEntries(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((name) => !NOT_A_BUILD.has(name));
}

/**
 * Write the staging tsconfig: the project's own, with every `.next/` include
 * pointed at the staged build. Regenerated on every build so it follows
 * whatever the project's tsconfig says today.
 */
function writeStagingTsconfig(root: string = process.cwd()): string {
    const base = JSON.parse(fs.readFileSync(path.join(root, "tsconfig.json"), "utf8")) as { include?: string[] };
    const staged = `.next/${STAGING_DIRNAME}/`;
    const include = (base.include ?? []).map((glob) =>
        glob.startsWith(".next/") ? staged + glob.slice(".next/".length) : glob,
    );
    fs.writeFileSync(
        path.join(root, STAGING_TSCONFIG),
        `${JSON.stringify({ extends: "./tsconfig.json", include }, null, 2)}\n`,
    );
    return STAGING_TSCONFIG;
}

/**
 * Get ready for a staged build and return the environment to run
 * `npm run build` with. Any earlier staged build, finished or not, is
 * discarded: the one about to be made describes the modules on disk now.
 */
export function prepareStagedBuild(root: string = process.cwd()): NodeJS.ProcessEnv {
    remove(stagingDir(root));
    return {
        ...process.env,
        NEXT_DIST_DIR: path.posix.join(".next", STAGING_DIRNAME),
        NEXT_TSCONFIG_PATH: writeStagingTsconfig(root),
    };
}

/** Throw a staged build away, after a failure or when it is not wanted. */
export function discardStagedBuild(root: string = process.cwd()): void {
    remove(stagingDir(root));
}

/**
 * Mark a finished staged build ready to promote, by writing the record of
 * what it was built from into it. Call only after `next build` succeeded.
 */
export function markStagedBuildReady(root: string = process.cwd()): void {
    const dir = stagingDir(root);
    if (!fs.existsSync(path.join(dir, "BUILD_ID"))) {
        throw new Error(`${dir} holds no finished build (no BUILD_ID)`);
    }
    writeBuildState(root, dir);
}

/** Whether a finished, marked staged build is waiting to be promoted. */
export function isStagedBuildReady(root: string = process.cwd()): boolean {
    const dir = stagingDir(root);
    return fs.existsSync(path.join(dir, "BUILD_ID")) && fs.existsSync(path.join(dir, STATE_FILENAME));
}

/** Every symlink under `dir`, not following any. */
function symlinksUnder(dir: string): string[] {
    const found: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) found.push(full);
        else if (entry.isDirectory()) found.push(...symlinksUnder(full));
    }
    return found;
}

/**
 * Re-point the relative symlinks of the build in `from` so they still reach
 * the same targets once the build sits in `to`. Absolute links need nothing.
 */
function repointRelativeLinks(from: string, to: string): void {
    for (const name of buildEntries(from)) {
        const top = path.join(from, name);
        const links = fs.lstatSync(top).isSymbolicLink() ? [top] : fs.lstatSync(top).isDirectory() ? symlinksUnder(top) : [];
        for (const link of links) {
            const target = fs.readlinkSync(link);
            if (path.isAbsolute(target)) continue;
            const resolved = path.resolve(path.dirname(link), target);
            const landing = path.join(to, path.relative(from, link));
            fs.unlinkSync(link);
            fs.symlinkSync(path.relative(path.dirname(landing), resolved), link);
        }
    }
}

/**
 * Replace the live build with the ready staged one. Only while no server is
 * reading `.next`: a running `next start` holds the old build's manifests and
 * would name chunks that are no longer there.
 */
export function promoteStagedBuild(root: string = process.cwd()): void {
    if (!isStagedBuildReady(root)) throw new Error("no staged build is ready to promote");

    const live = liveDir(root);
    const staged = stagingDir(root);
    const previous = previousDir(root);

    // Before anything moves: the staged build stays whole until the swap.
    repointRelativeLinks(staged, live);

    remove(previous);
    fs.mkdirSync(previous);

    // The live build out, BUILD_ID first: from here until the new BUILD_ID
    // lands, a cut-off promotion is one the next boot rolls back.
    const outgoing = buildEntries(live).sort((a, b) => Number(b === "BUILD_ID") - Number(a === "BUILD_ID"));
    for (const name of outgoing) fs.renameSync(path.join(live, name), path.join(previous, name));

    // The new build in, BUILD_ID last. Its `cache` is the build's own scratch
    // and is dropped with the staging directory; the live `cache` stays.
    for (const name of buildEntries(staged)) {
        if (name === "BUILD_ID") continue;
        fs.renameSync(path.join(staged, name), path.join(live, name));
    }
    fs.renameSync(path.join(staged, "BUILD_ID"), path.join(live, "BUILD_ID"));

    remove(staged);
    remove(previous);
}

export type Recovery = "none" | "finished" | "rolled-back";

/**
 * Settle a promotion that was cut off, so the boot starts from one whole
 * build. Safe to call on every boot; does nothing when nothing was cut off.
 */
export function recoverInterruptedPromotion(root: string = process.cwd()): Recovery {
    const live = liveDir(root);
    const previous = previousDir(root);
    if (!fs.existsSync(previous)) return "none";

    if (fs.existsSync(path.join(live, "BUILD_ID"))) {
        // Past the commit point: the new build is whole, the rest is cleanup.
        remove(stagingDir(root));
        remove(previous);
        return "finished";
    }

    // Before it: whatever of the new build came across is incomplete. Take it
    // out and put the previous build back. The staged build was half moved
    // and is no longer whole either.
    for (const name of buildEntries(live)) remove(path.join(live, name));
    for (const name of buildEntries(previous)) fs.renameSync(path.join(previous, name), path.join(live, name));
    remove(previous);
    remove(stagingDir(root));
    return "rolled-back";
}

/**
 * What every start does before serving: settle a promotion that was cut off,
 * then put live a staged build an install finished and restarted for.
 *
 * Both entry points call it - the container's reconciler and `npm start`'s
 * `prestart` - because an install hands its build over to whatever starts the
 * process next. Under systemd or pm2 that is `npm start`; without this there
 * it would never go live. It never builds, so it costs nothing on the
 * overwhelmingly common start where there is nothing to settle.
 */
export function settleStagedBuilds(root: string = process.cwd(), log: (msg: string) => void = () => {}): void {
    const recovery = recoverInterruptedPromotion(root);
    if (recovery === "finished") log("finished a build promotion that was cut off");
    if (recovery === "rolled-back") log("rolled back a build promotion that was cut off; the previous build is live");

    if (isStagedBuildReady(root)) {
        promoteStagedBuild(root);
        log("promoted the build a module change finished before the restart");
    }
}
