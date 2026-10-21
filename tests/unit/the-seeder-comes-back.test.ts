// @vitest-environment node
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { toolCommand } from "@/core/lib/tool-command";

/**
 * A command that has finished ends.
 *
 * `--list` loads every installed module's seed to print what can be seeded,
 * and one of those seeds reaches a helper that imports the app's Prisma
 * client, which opens a connection pool at import time. The list printed and
 * the process stayed up: a seeding run from the day before was still running
 * twenty-two hours later, holding a database connection on a shared box.
 *
 * `--list` is the cheapest path that still imports every seed, which is where
 * the handle comes from, so it is the one this runs.
 */
describe("the seeder comes back", () => {
    it("exits after it has printed its list", async () => {
        const root = join(__dirname, "..", "..");
        const code = await new Promise<number>((resolve, reject) => {
            const child = execFile(
                ...toolCommand(["npx", "tsx", "scripts/seed-demo.ts", "--list"], root),
                { cwd: root, timeout: 45_000 },
                (err) => {
                    if (err && (err as { killed?: boolean }).killed) reject(new Error("did not exit"));
                },
            );
            child.on("close", (c) => resolve(c ?? -1));
            child.on("error", reject);
        });
        expect(code).toBe(0);
    }, 60_000);
});
