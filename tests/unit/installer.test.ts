import { afterAll, describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const REPO = path.resolve(__dirname, "../..");

/**
 * install.sh is a Linux installer and says so: it refuses to run unless
 * `uname -s` is Linux, so Git Bash (MINGW64) can never run it. On Windows the
 * Linux it needs is WSL, and it is reached through `wsl.exe --exec`, not
 * through `bash`. The `bash` a Windows PATH resolves is System32\bash.exe, a
 * legacy WSL shim that joins its arguments into one string and re-parses it
 * with `bash -c`: every backslash in C:\Users\... was eaten as an escape, the
 * script arrived as C:Users..., and every case failed with "No such file or
 * directory". `--exec` hands each argument over untouched.
 *
 * The directories a case makes live inside WSL's own filesystem, not under
 * /mnt/c. The installer is meant for a Linux disk, and on /mnt/c a chmod is
 * silently ignored, so the owner-only check below would have tested DrvFs
 * instead of the installer. Node reaches them through their \\wsl.localhost
 * path.
 */
const WSL = process.platform === "win32";

interface LinuxRun {
    input?: Buffer;
    env?: Record<string, string>;
}

function onLinux(argv: string[], run: LinuxRun = {}): string {
    const extra = run.env ?? {};
    const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
    if (WSL) {
        // A Windows variable reaches WSL only when WSLENV names it.
        env.WSLENV = [process.env.WSLENV, ...Object.keys(extra)].filter(Boolean).join(":");
    }
    const [file, ...args] = WSL ? ["wsl.exe", "--exec", ...argv] : argv;
    return execFileSync(file, args, { encoding: "utf8", cwd: REPO, input: run.input, env });
}

/**
 * Whether there is a Linux to run the installer on. A Windows machine without
 * a WSL distribution has none - a hosted CI runner, for one - and there the
 * file reports itself skipped rather than failing to load; the Linux job runs
 * it in full.
 */
function linuxReachable(): boolean {
    if (!WSL) return true;
    try {
        return execFileSync("wsl.exe", ["--exec", "uname", "-s"], { encoding: "utf8", timeout: 30_000 }).trim() === "Linux";
    } catch {
        return false;
    }
}
const LINUX = linuxReachable();

const INSTALLER = !LINUX
    ? ""
    : WSL
        ? onLinux(["wslpath", "-a", path.join(REPO, "install.sh")]).trim()
        : path.join(REPO, "install.sh");

/**
 * A directory as both sides see it: `linux` is what the installer is given,
 * `local` is what this process reads. Off Windows they are the same path.
 */
interface Place {
    linux: string;
    local: string;
}

/**
 * Every directory made here is recorded and removed when the file is done.
 * They were not: this file makes one per case per run, and a shared machine
 * had 6,980 of them in /tmp, on a tmpfs that other projects were also
 * filling. A test that leaves litter behind eventually takes the box down
 * with it - the marketplace install route refuses at under 100 MB free and
 * started answering 507, which reads as a code defect and is not one.
 */
const MADE: string[] = [];
function tempDir(prefix: string): Place {
    if (!WSL) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
        MADE.push(dir);
        return { linux: dir, local: dir };
    }
    const linux = onLinux(["mktemp", "-d", "-t", `${prefix}XXXXXX`]).trim();
    const local = onLinux(["wslpath", "-w", linux]).trim();
    MADE.push(local);
    return { linux, local };
}

/**
 * Runs install.sh in --dry-run mode, which performs every computation the
 * real install does - OS detection, secret generation, .env rendering - but
 * writes only into the directory given here and touches nothing else on the
 * host. Docker is never contacted.
 */
function dryRun(args: string[]): { dir: Place; env: Record<string, string>; stdout: string } {
    const dir = tempDir("blysis-install-");
    const stdout = onLinux(["bash", INSTALLER, "--dry-run", "--dir", dir.linux, ...args]);
    const raw = fs.readFileSync(path.join(dir.local, ".env"), "utf8");
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

describe.runIf(LINUX)("install.sh", () => {
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
        // The mode is asked of Linux, not read by Node. Windows has no POSIX
        // mode bits: Node reports 0666 for every file there, the \\wsl.localhost
        // view included, so a local stat could neither pass nor catch a
        // world-readable .env.
        const { dir } = dryRun([]);
        const mode = onLinux(["stat", "-c", "%a", `${dir.linux}/.env`]).trim();
        expect(mode).toBe("600");
    });

    it("treats an existing .env as an upgrade and never overwrites it", () => {
        const { dir, env } = dryRun([]);
        const before = fs.readFileSync(path.join(dir.local, ".env"), "utf8");
        onLinux(["bash", INSTALLER, "--dry-run", "--dir", dir.linux]);
        const after = fs.readFileSync(path.join(dir.local, ".env"), "utf8");
        expect(after).toBe(before);
        expect(env.AUTH_SECRET).toBeTruthy();
    });

    it("copies the stack files the installation needs", () => {
        const { dir } = dryRun([]);
        for (const f of ["docker-compose.yml", "docker-compose.build.yml", "Caddyfile"]) {
            expect(fs.existsSync(path.join(dir.local, f)), f).toBe(true);
        }
    });

    it("works when piped from curl, where stdin is the script itself", () => {
        // `curl ... | sudo bash` has no source tree next to the script, so the
        // installer downloads the stack files instead. BLYSIS_RAW_BASE points
        // that download at a local copy so the path is exercised offline.
        const raw = tempDir("blysis-raw-");
        fs.mkdirSync(path.join(raw.local, "scripts"));
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
            fs.copyFileSync(path.join(REPO, f), path.join(raw.local, f));
        }
        fs.copyFileSync(path.join(REPO, "scripts/blysis"), path.join(raw.local, "scripts/blysis"));

        const dir = tempDir("blysis-piped-");
        onLinux(["bash", "-s", "--", "--dry-run", "--dir", dir.linux], {
            input: fs.readFileSync(path.join(REPO, "install.sh")),
            env: { BLYSIS_RAW_BASE: `file://${raw.linux}` },
        });

        for (const f of ["docker-compose.yml", "Caddyfile", "blysis.cli"]) {
            expect(fs.existsSync(path.join(dir.local, f)), f).toBe(true);
        }
        expect(fs.existsSync(path.join(dir.local, ".env"))).toBe(true);
    });

    it("masks the generated secrets in its own output", () => {
        const { stdout, env } = dryRun([]);
        expect(stdout).not.toContain(env.AUTH_SECRET);
        expect(stdout).not.toContain(env.POSTGRES_PASSWORD);
        expect(stdout).toContain("<generated>");
    });
});
