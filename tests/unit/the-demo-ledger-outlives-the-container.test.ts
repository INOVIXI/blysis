// @vitest-environment node
/**
 * The demo seeder's ledger survives wherever the reset runs, and a lost one
 * stops the reset instead of doubling the demo.
 *
 * `--clean` takes back only the rows the ledger lists, and the ledger was a
 * file in the working directory. A demo host that runs `npm run demo:reset`
 * in a fresh container every hour (a Kubernetes CronJob, `docker compose run`)
 * started each run without it, so `--clean` found nothing and the next seed
 * wrote another full demo on top of the last one: about 700 rows an hour on
 * demo.blysis.com from early October, every seeded table growing by the same
 * amount, until the database was rebuilt (#110).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readLedger, refuseWithoutItsLedger, writeLedger } from "../../scripts/seed-demo";

let dir: string;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "seed-ledger-"));
    vi.stubEnv("DATABASE_URL", "postgresql://demo@127.0.0.1:5432/demo");
});

afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("where the ledger is kept", () => {
    it("is the path SEED_LEDGER_PATH names, even in a folder that does not exist yet", () => {
        const file = path.join(dir, "volume", "seed-ledger.json");
        vi.stubEnv("SEED_LEDGER_PATH", file);

        const ledger = readLedger();
        ledger.rows.push({ module: "core", model: "user", id: "u1" });
        writeLedger(ledger);

        expect(fs.existsSync(file)).toBe(true);
        expect(readLedger().rows).toEqual([{ module: "core", model: "user", id: "u1" }]);
    });

    it("is still the checkout's own file when nothing names another", () => {
        vi.stubEnv("SEED_LEDGER_PATH", "");
        // Not written for real: that file is a developer's own ledger.
        const write = vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);

        writeLedger({ database: "any", rows: [] });

        expect(write.mock.calls[0]?.[0]).toBe(path.join(process.cwd(), ".seed-ledger.json"));
        write.mockRestore();
    });
});

describe("a ledger that was lost", () => {
    it("stops a seed over demo accounts the ledger never recorded", () => {
        expect(() => refuseWithoutItsLedger({ database: "db", rows: [] }, 2)).toThrow(/SEED_LEDGER_PATH/);
    });

    it("lets the first seed of a database through", () => {
        expect(() => refuseWithoutItsLedger({ database: "db", rows: [] }, 0)).not.toThrow();
    });

    it("lets a seed through when the ledger knows what is already there", () => {
        const ledger = { database: "db", rows: [{ module: "core", model: "user", id: "u1" }] };
        expect(() => refuseWithoutItsLedger(ledger, 2)).not.toThrow();
    });
});
