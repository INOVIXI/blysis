/**
 * Put a public demo back the way it was.
 *
 * A demo is only worth visiting if a visitor can change things, and a demo
 * where they can is a wasteland by Tuesday unless something puts it back.
 * Every demo worth copying resets on a clock; this is that clock's hands.
 *
 * Three steps, in this order, because each needs the one before it:
 *
 *   1. `seed-demo --clean` takes back every row the demo seed wrote. It works
 *      from a ledger and checks each row still exists, so a visitor who
 *      deleted something does not stop the sweep.
 *   2. `prisma/seed.ts` makes sure the roles, the permissions and the site's
 *      own settings are there. It is idempotent and leaves an existing
 *      administrator's password alone.
 *   3. `seed-demo` writes the demo back: the accounts a visitor is handed,
 *      the shop, the forum, the tickets, the wheel.
 *
 * What it deliberately does not do is drop the database. Rows a visitor added
 * that the ledger never saw - a forum post, an order, a support ticket - are
 * theirs and are left. They cost nothing and they make the demo look lived
 * in; the reset is about the scenery, not about erasing people.
 *
 * Usage:
 *   npm run demo:reset
 *
 * On a demo host, hourly:
 *   0 * * * * cd /srv/blysis && npm run demo:reset >> /var/log/blysis-demo.log
 *
 * It refuses to run unless DEMO_MODE=1, because the one thing worse than a
 * stale demo is this command pointed at somebody's real site.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";

const STEPS: { what: string; args: string[] }[] = [
    { what: "taking back what the last reset wrote", args: ["scripts/seed-demo.ts", "--clean"] },
    { what: "roles, permissions and settings", args: ["prisma/seed.ts"] },
    { what: "writing the demo back", args: ["scripts/seed-demo.ts"] },
];

function main(): void {
    if (process.env.DEMO_MODE !== "1") {
        console.error(
            "demo-reset refuses to run: DEMO_MODE is not 1.\n" +
            "This deletes and rewrites the demo's rows. Set DEMO_MODE=1 on the host that is a demo.",
        );
        process.exit(1);
    }

    const started = Date.now();
    for (const step of STEPS) {
        process.stdout.write(`\n── ${step.what} ──\n`);
        const run = spawnSync("npx", ["tsx", ...step.args], { stdio: "inherit" });
        if (run.status !== 0) {
            console.error(`\ndemo-reset stopped: ${step.args.join(" ")} exited ${run.status}`);
            // Loudly, and without going on: a half-reset demo is worse than a
            // stale one, because it looks fine until somebody opens the part
            // that did not get written.
            process.exit(run.status ?? 1);
        }
    }

    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`\nDemo reset in ${seconds}s. Next one is whenever the clock says.`);
}

main();
