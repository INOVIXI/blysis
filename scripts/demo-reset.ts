/**
 * Put a public demo back the way it was.
 *
 * A demo is only worth visiting if a visitor can change things, and a demo
 * where they can is a wasteland by Tuesday unless something puts it back.
 * Every demo worth copying resets on a clock; this is that clock's hands.
 *
 * First the generated code is brought in line with the modules installed:
 * the Prisma client and the module registries. A demo host that runs the
 * reset in a container of its own - a Kubernetes CronJob, `docker compose
 * run` - starts from the image, where both describe no modules at all. The
 * client then had no module models (`undefined.findMany`), and the hook
 * registry had no listeners, so a seed that asks another module a question
 * got no answer: the comparison table asked the shop which shelves it has and
 * wrote a table no shelf draws. Inside the app's own container both are
 * already current and this costs a few seconds.
 *
 * Then three steps, in this order, because each needs the one before it:
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
import { detectSchemaDrift, writeSchemaState } from "../src/core/lib/build-state";

// `--force` on both seed-demo steps, because a demo host runs the published
// image and that image sets NODE_ENV=production: seed-demo refuses a
// production database unless it is told twice, so without it every reset
// stopped at the first step. DEMO_MODE=1, checked below, is the second time.
const STEPS: { what: string; args: string[] }[] = [
    { what: "taking back what the last reset wrote", args: ["scripts/seed-demo.ts", "--clean", "--force"] },
    { what: "roles, permissions and settings", args: ["prisma/seed.ts"] },
    { what: "writing the demo back", args: ["scripts/seed-demo.ts", "--force"] },
];

/** Run a script through tsx, and stop the reset if it fails. */
function run(args: string[]): void {
    const result = spawnSync("npx", ["tsx", ...args], { stdio: "inherit" });
    if (result.status !== 0) {
        console.error(`\ndemo-reset stopped: ${args.join(" ")} exited ${result.status}`);
        // Loudly, and without going on: a half-reset demo is worse than a
        // stale one, because it looks fine until somebody opens the part
        // that did not get written.
        process.exit(result.status ?? 1);
    }
}

function main(): void {
    if (process.env.DEMO_MODE !== "1") {
        console.error(
            "demo-reset refuses to run: DEMO_MODE is not 1.\n" +
            "This deletes and rewrites the demo's rows. Set DEMO_MODE=1 on the host that is a demo.",
        );
        process.exit(1);
    }

    const started = Date.now();

    process.stdout.write("\n── the generated code, for the modules installed ──\n");
    if (detectSchemaDrift()) {
        run(["scripts/merge-schemas.ts"]);
        writeSchemaState();
    }
    // Every registry, not only the hooks: a seed may reach any of them, and
    // regenerating is idempotent and quick.
    run(["scripts/generate-registry.ts"]);

    for (const step of STEPS) {
        process.stdout.write(`\n── ${step.what} ──\n`);
        run(step.args);
    }

    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`\nDemo reset in ${seconds}s. Next one is whenever the clock says.`);
}

main();
