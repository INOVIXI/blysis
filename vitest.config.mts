import { defineConfig } from 'vitest/config';
import fs from 'fs';
import path from 'path';

// `.mts` so Vite loads this as real ESM. As `.ts` it was loaded as CommonJS,
// which Vite warns about on every single run and plans to stop supporting -
// hence `import.meta.dirname` rather than `__dirname` below.
const rootDir = import.meta.dirname;

/**
 * Tests for a module live in `tests/modules/<moduleId>/` and import the module
 * as `@/modules/<id>/...`, which is where an *installed* module lives.
 *
 * The platform ships with zero modules, so `src/modules/` is normally empty,
 * and a test importing a module that is not installed cannot even be
 * transformed - it fails at collection, not as an assertion. This used to be
 * handled by only including the tests of installed modules, which kept a
 * clean checkout green and quietly created a hole: CI copies every module
 * into `src/modules` before it runs, so it ran a hundred tests that no
 * developer machine did. Three of them were red for weeks - a mock missing an
 * export the route had gained, a mock missing a method, a test still mocking
 * the path its module had stopped importing - and every one of them was
 * invisible to `npm test` here.
 *
 * So the tests all run, everywhere, and a module that is not installed
 * resolves to the sources the marketplace ZIPs are built from. `src/modules`
 * still wins when it has the module, because that is the copy the running app
 * would load.
 */
const modulesDir = path.resolve(rootDir, 'src/modules');
const sourcesDir = path.resolve(rootDir, 'module-sources');

function moduleIdsIn(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'module.json')))
        .map((e) => e.name);
}

const installedModules = new Set(moduleIdsIn(modulesDir));
// `(?=/|$)` so `@/modules/store` cannot swallow `@/modules/store-front`.
const moduleSourceAliases = moduleIdsIn(sourcesDir)
    .filter((id) => !installedModules.has(id))
    .map((id) => ({
        find: new RegExp(`^@/modules/${id}(?=/|$)`),
        replacement: path.resolve(sourcesDir, id),
    }));

export default defineConfig({
    /*
     * No PostCSS in the test run.
     *
     * The module component registries are static imports now, so a test that
     * renders the navbar pulls the components modules contribute to it, and
     * those reach a stylesheet. Vite then goes looking for a PostCSS config
     * and finds this project's, whose first plugin is named as a string for
     * Next to resolve - which Vite will not accept. Nothing here asserts on a
     * style, so the answer is to not process CSS rather than to keep a second
     * PostCSS config in step with the real one.
     */
    css: { postcss: { plugins: [] } },
    test: {
        globals: true,
        environment: 'jsdom',
        /*
         * Vitest defaults to five seconds, and this suite runs too close to it.
         *
         * Measured on 2026-09-21: five different tests tripped the five second
         * limit across three runs and every one of them passed when run on its
         * own - a scheduler tick on fake timers, a wheel with no odds, two
         * censuses that walk the whole tree, and the backup retention test.
         * The development box shares its CPU with nine other projects and sat
         * at a load average of sixty; a GitHub runner hit the same wall on the
         * backup test with nothing else on it.
         *
         * None of these asserts a duration. They are correctness tests that
         * need wall clock on a busy machine, and a limit they can reach by
         * being unlucky reports a passing product as broken - which is worse
         * than a genuine hang taking twenty seconds to say so.
         */
        testTimeout: 20_000,
        hookTimeout: 20_000,
        include: [
            'tests/unit/**/*.test.{ts,tsx}',
            'tests/integration/**/*.test.{ts,tsx}',
            'tests/modules/**/*.test.{ts,tsx}',
        ],
        coverage: {
            provider: 'v8',
            include: ['src/core/lib/**/*.ts'],
            // Only db.ts (a Prisma client singleton, no logic) and auth.ts (the
            // NextAuth config - can't be imported outside the Next bundler, see
            // tests/integration/two-factor-flow.test.ts) are excluded.
            //
            // The two most security-critical files - permissions.ts (the admin
            // authorization gate) and secret-storage.ts (at-rest secret crypto)
            // - are deliberately NOT excluded so their coverage is measured and
            // can be enforced. Do not add them here.
            exclude: ['src/core/lib/db.ts', 'src/core/lib/auth.ts'],
            // A ratchet, not a target. Set just under the numbers the suite
            // actually produced on 2026-09-02 so an unrelated change cannot
            // quietly remove coverage; raise them when you add tests, never
            // lower them to make a build pass.
            //
            // The two security-critical files carry their own floors. That is
            // the whole reason they are not in `exclude` above - measuring
            // them was pointless while nothing enforced the measurement, and
            // for a long time nothing did: `@vitest/coverage-v8` was not even
            // installed, so `npm run test:coverage` failed on the missing
            // provider and CI ran `npm test` without it.
            thresholds: {
                statements: 84,
                branches: 80,
                functions: 79,
                lines: 86,
                'src/core/lib/permissions.ts': {
                    statements: 85, branches: 90, functions: 72, lines: 80,
                },
                // Reconciling the build against the installed modules is the
                // difference between a module install working and silently
                // doing nothing. Every branch of the drift detection is worth
                // a test, so hold it near the top.
                'src/core/lib/build-state.ts': {
                    statements: 95, branches: 92, functions: 100, lines: 95,
                },
                // The install path: the lock that keeps two installs from
                // racing, and the queue that decides whether a module install
                // is ever served. Two of the three defects fixed in 0.2.0
                // lived here - a restart that always threw and a build whose
                // result nothing recorded - and neither had a test.
                'src/core/lib/install-lock.ts': {
                    statements: 95, branches: 75, functions: 100, lines: 95,
                },
                // SIGTERM is now how the platform restarts itself after an
                // install, so this registry is on the critical path of every
                // module install, not just of `docker stop`.
                'src/core/lib/shutdown.ts': {
                    statements: 95, branches: 95, functions: 100, lines: 95,
                },
                // Irreversible or unrecoverable by nature: an erasure that
                // deletes too much destroys the public record, an export that
                // leaks a password hash cannot be un-sent, and every upload on
                // the instance passes through storage.ts's sniffer.
                'src/core/lib/user-deletion.ts': {
                    statements: 100, branches: 100, functions: 100, lines: 100,
                },
                'src/core/lib/user-data-export.ts': {
                    statements: 100, branches: 100, functions: 100, lines: 100,
                },
                'src/core/lib/module-backup.ts': {
                    statements: 100, branches: 100, functions: 100, lines: 100,
                },
                'src/core/lib/storage.ts': {
                    statements: 95, branches: 95, functions: 100, lines: 95,
                },
                // Both routers walk every installed module's declared paths,
                // so a bug here is cross-module: the loop that throws is
                // walking somebody else's routes. The API matcher used to
                // build an illegal capture group for a catch-all and take the
                // whole router down with it.
                'src/core/lib/path-pattern.ts': {
                    statements: 95, branches: 95, functions: 100, lines: 95,
                },
                // Sanitising happens on write, so anything that gets past
                // this is in the database and every later render serves it.
                'src/core/lib/sanitize.ts': {
                    statements: 100, branches: 100, functions: 100, lines: 100,
                },
                // Consulted by middleware on every request. Too wide a CIDR
                // locks the admin out; a propagated DB error denies everyone.
                'src/core/lib/ip-blocks.ts': {
                    statements: 100, branches: 95, functions: 100, lines: 100,
                },
                // Restore is the most destructive operation the platform has
                // (pg_dump --clean drops every table before reloading), and
                // rotation deletes archives on its own schedule.
                'src/core/lib/backup.ts': {
                    statements: 95, branches: 80, functions: 100, lines: 95,
                },
                // On the boot path since 0.2.0. A ticker that never starts
                // stops backups, the email queue, warning expiry and health
                // alerting, and nothing surfaces it.
                'src/core/lib/scheduler.ts': {
                    statements: 90, branches: 70, functions: 100, lines: 90,
                },
                'src/core/lib/secret-storage.ts': {
                    statements: 92, branches: 80, functions: 100, lines: 92,
                },
                // Every outbound message passes through email.ts, and `to`
                // and `subject` arrive there from user-controlled places. A
                // bare CR/LF that survives sanitisation turns any of them
                // into an arbitrary-recipient Bcc.
                'src/core/lib/email.ts': {
                    statements: 95, branches: 92, functions: 100, lines: 98,
                },
                // The cache layer's whole contract is that it degrades: a
                // flaky Redis has to fall back to memory rather than turn a
                // slow page into a 500.
                'src/core/lib/redis.ts': {
                    statements: 95, branches: 95, functions: 100, lines: 95,
                },
                'src/core/lib/cache.ts': {
                    statements: 95, branches: 90, functions: 100, lines: 98,
                },
                // Maintenance mode is the switch that takes the site offline
                // and setup state is the gate that redirects every request to
                // the wizard. Both must fail *open* on a database error, and
                // both are cheap enough to hold at full coverage.
                'src/core/lib/maintenance.ts': {
                    statements: 100, branches: 100, functions: 100, lines: 100,
                },
                'src/core/lib/setup-state.ts': {
                    statements: 100, branches: 100, functions: 100, lines: 100,
                },
                // Opt-out by default: inverting this either silences every
                // notification or ignores every user's mute.
                'src/core/lib/notif-prefs.ts': {
                    statements: 100, branches: 100, functions: 100, lines: 100,
                },
                // Crossing a warning threshold is what auto-mutes and
                // auto-bans users, via a hook other modules subscribe to.
                'src/core/lib/warnings.ts': {
                    statements: 100, branches: 90, functions: 100, lines: 100,
                },
                // Re-exported through the module SDK, so `slugify` and
                // friends are a published contract third-party modules build
                // on - changing one silently changes their URLs.
                'src/core/lib/utils.ts': {
                    statements: 100, branches: 95, functions: 100, lines: 100,
                },
                // Two separate output paths, only one of which ever runs
                // locally: a break in the production JSON path shows up as
                // "the log aggregator is empty" long after deploy.
                'src/core/lib/logger.ts': {
                    statements: 95, branches: 95, functions: 100, lines: 95,
                },
                // The watchdog that tells an operator the platform is down.
                // Every failure here is silent: too eager a debounce means no
                // page ever arrives, too lax and the channel gets muted.
                'src/core/lib/health-alerting.ts': {
                    statements: 95, branches: 95, functions: 100, lines: 95,
                },
                // The boundary between untrusted files on disk and the module
                // registry. One malformed manifest must remove exactly one
                // module, never take the whole scan down with it.
                // The single resolver every path that accepts a module now
                // shares. Four hand-rolled copies of this check had drifted far
                // enough apart that fourteen first-party modules passed CI and
                // were impossible to install.
                'src/core/lib/module-ref-resolver.ts': {
                    statements: 100, branches: 100, functions: 100, lines: 100,
                },
                'src/core/lib/module-loader.ts': {
                    statements: 100, branches: 90, functions: 100, lines: 100,
                },
                // Answers "is this module on?" for the admin surface, and
                // fails *closed* - the opposite of module-cache.ts, which
                // fails open. Both defaults are deliberate.
                'src/core/lib/modules.ts': {
                    statements: 100, branches: 100, functions: 100, lines: 100,
                },
                'src/core/lib/module-cache.ts': {
                    statements: 100, branches: 100, functions: 100, lines: 100,
                },
                // A broadcast fans one message out to every user on the
                // instance and cannot be recalled; a run that never reaches a
                // terminal status blocks the cron on that row forever.
                'src/core/lib/broadcasts.ts': {
                    statements: 100, branches: 100, functions: 100, lines: 100,
                },
                // Snapshots taken immediately before a destructive update.
                'src/core/lib/revisions.ts': {
                    statements: 100, branches: 100, functions: 100, lines: 100,
                },
                'src/core/lib/scheduled-tasks.ts': {
                    statements: 100, branches: 100, functions: 100, lines: 100,
                },
                // The JSON-LD builders interpolate database strings into a
                // <script> block; the `<` escape is all that keeps a site
                // name containing </script> from breaking out of it.
                'src/core/lib/seo.ts': {
                    statements: 100, branches: 90, functions: 100, lines: 100,
                },
                'src/core/lib/metrics.ts': {
                    statements: 100, branches: 94, functions: 100, lines: 100,
                },
            },
        },
    },
    resolve: {
        // An array, not an object, because the module fallbacks are computed.
        // Order matters either way: Vite tries the entries in sequence and
        // '@' matches as a prefix, so every specific entry comes first.
        alias: [
            // Everything that reaches `@/core/lib/auth` - including any test
            // that touches `@/core/sdk/server`, whose `activity-log` re-export
            // imports it - gets a stub instead. See tests/stubs/core-auth.ts
            // for why the real module cannot be imported outside Next.
            { find: '@/core/lib/auth', replacement: path.resolve(rootDir, 'tests/stubs/core-auth.ts') },
            ...moduleSourceAliases,
            { find: '@', replacement: path.resolve(rootDir, 'src') },
        ],
    },
});
