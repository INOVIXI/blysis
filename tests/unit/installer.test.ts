import { afterAll, describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const REPO = path.resolve(__dirname, "../..");
const INSTALLER = path.join(REPO, "install.sh");

/**
 * Runs install.sh in --dry-run mode, which performs every computation the
 * real install does - OS detection, secret generation, .env rendering - but
 * writes only into the directory given here and touches nothing else on the
 * host. Docker is never contacted.
 *
 * Every directory it makes is recorded and removed when the file is done.
 * They were not: this file makes one per case per run, and a shared machine
 * had 6,980 of them in /tmp, on a tmpfs that other projects were also
 * filling. A test that leaves litter behind eventually takes the box down
 * with it - the marketplace install route refuses at under 100 MB free and
 * started answering 507, which reads as a code defect and is not one.
 */
const MADE: string[] = [];
function dryRun(args: string[]): { dir: string; env: Record<string, string>; stdout: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blysis-install-"));
    MADE.push(dir);
    const stdout = execFileSync(
        "bash",
        [INSTALLER, "--dry-run", "--dir", dir, ...args],
        { encoding: "utf8", cwd: REPO },
    );
    const raw = fs.readFileSync(path.join(dir, ".env"), "utf8");
    const env: Record<string, string> = {};
    for (const line of raw.split("\n")) {
        const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
        if (m) env[m[1]] = m[2];
    }
    return { dir, env, stdout };
}

afterAll(() => {
    for (const dir of MADE) {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // A directory that is already gone is the state we wanted.
        }
    }
});

describe("install.sh", () => {
    it("generates every secret the stack requires", () => {
        const { env } = dryRun(["--email", "a@example.com"]);
        for (const key of [
            "POSTGRES_PASSWORD",
            "AUTH_SECRET",
            "SECRET_ENCRYPTION_KEY",
            "SEED_ADMIN_PASSWORD",
        ]) {
            expect(env[key], `${key} missing`).toBeTruthy();
        }
    });

    it("keeps POSTGRES_PASSWORD URL-safe", () => {
        // It is interpolated into postgresql://blysis:<pw>@db:5432/blysis.
        // A '/', '@' or ':' from base64 would silently corrupt the DSN.
        const { env } = dryRun([]);
        expect(env.POSTGRES_PASSWORD).toMatch(/^[0-9a-f]+$/);
        expect(env.POSTGRES_PASSWORD.length).toBeGreaterThanOrEqual(32);
    });

    it("emits SECRET_ENCRYPTION_KEY as the 64 hex chars the app demands", () => {
        const { env } = dryRun([]);
        expect(env.SECRET_ENCRYPTION_KEY).toMatch(/^[0-9a-f]{64}$/);
    });

    it("emits base64url secrets with no dotenv-hostile characters", () => {
        const { env } = dryRun([]);
        for (const key of ["AUTH_SECRET", "SEED_ADMIN_PASSWORD"]) {
            expect(env[key], key).toMatch(/^[A-Za-z0-9_-]+$/);
        }
    });

    it("never repeats a secret across installs", () => {
        const a = dryRun([]).env;
        const b = dryRun([]).env;
        expect(a.POSTGRES_PASSWORD).not.toBe(b.POSTGRES_PASSWORD);
        expect(a.AUTH_SECRET).not.toBe(b.AUTH_SECRET);
        expect(a.SEED_ADMIN_PASSWORD).not.toBe(b.SEED_ADMIN_PASSWORD);
    });

    it("binds the app to loopback and uses https when TLS is on", () => {
        const { env } = dryRun(["--domain", "shop.example.com", "--tls", "--email", "me@x.com"]);
        expect(env.AUTH_URL).toBe("https://shop.example.com");
        expect(env.NEXTAUTH_URL).toBe("https://shop.example.com");
        expect(env.DOMAIN).toBe("shop.example.com");
        // Caddy terminates TLS; the app must not also be reachable on :3001.
        expect(env.APP_BIND_ADDR).toBe("127.0.0.1");
    });

    it("publishes the app directly when there is no TLS", () => {
        const { env } = dryRun(["--no-tls", "--port", "8080"]);
        expect(env.APP_BIND_ADDR).toBe("0.0.0.0");
        expect(env.APP_PORT).toBe("8080");
        expect(env.AUTH_URL).toMatch(/^http:\/\/.+:8080$/);
    });

    it("refuses TLS without a domain rather than requesting an impossible certificate", () => {
        expect(() => dryRun(["--tls"])).toThrow();
    });

    it("rejects a non-numeric port", () => {
        expect(() => dryRun(["--port", "abc"])).toThrow();
    });

    it("writes .env readable only by its owner", () => {
        const { dir } = dryRun([]);
        const mode = fs.statSync(path.join(dir, ".env")).mode & 0o777;
        expect(mode).toBe(0o600);
    });

    it("treats an existing .env as an upgrade and never overwrites it", () => {
        const { dir, env } = dryRun([]);
        const before = fs.readFileSync(path.join(dir, ".env"), "utf8");
        execFileSync("bash", [INSTALLER, "--dry-run", "--dir", dir], { encoding: "utf8", cwd: REPO });
        const after = fs.readFileSync(path.join(dir, ".env"), "utf8");
        expect(after).toBe(before);
        expect(env.AUTH_SECRET).toBeTruthy();
    });

    it("copies the stack files the installation needs", () => {
        const { dir } = dryRun([]);
        for (const f of ["docker-compose.yml", "docker-compose.build.yml", "Caddyfile"]) {
            expect(fs.existsSync(path.join(dir, f)), f).toBe(true);
        }
    });

    it("works when piped from curl, where stdin is the script itself", () => {
        // `curl ... | sudo bash` has no source tree next to the script, so the
        // installer downloads the stack files instead. BLYSIS_RAW_BASE points
        // that download at a local copy so the path is exercised offline.
        const raw = fs.mkdtempSync(path.join(os.tmpdir(), "blysis-raw-"));
        MADE.push(raw);
        fs.mkdirSync(path.join(raw, "scripts"));
        for (const f of [
            "docker-compose.yml",
            "docker-compose.build.yml",
            "docker-compose.debug.yml",
            "Caddyfile",
            // The updater's script. It reaches the host the same way the
            // compose files do, and is mounted read-only into the one
            // container that may talk to Docker.
            "updater.sh",
        ]) {
            fs.copyFileSync(path.join(REPO, f), path.join(raw, f));
        }
        fs.copyFileSync(path.join(REPO, "scripts/blysis"), path.join(raw, "scripts/blysis"));

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blysis-piped-"));
        MADE.push(dir);
        execFileSync("bash", ["-s", "--", "--dry-run", "--dir", dir], {
            input: fs.readFileSync(INSTALLER),
            encoding: "utf8",
            cwd: REPO,
            env: { ...process.env, BLYSIS_RAW_BASE: `file://${raw}` },
        });

        for (const f of ["docker-compose.yml", "Caddyfile", "blysis.cli"]) {
            expect(fs.existsSync(path.join(dir, f)), f).toBe(true);
        }
        expect(fs.existsSync(path.join(dir, ".env"))).toBe(true);
    });

    it("masks the generated secrets in its own output", () => {
        const { stdout, env } = dryRun([]);
        expect(stdout).not.toContain(env.AUTH_SECRET);
        expect(stdout).not.toContain(env.POSTGRES_PASSWORD);
        expect(stdout).toContain("<generated>");
    });
});
