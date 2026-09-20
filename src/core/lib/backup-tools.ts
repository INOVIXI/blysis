/**
 * Whether a backup can be taken here at all.
 *
 * `createBackup` shells out to `pg_dump`, and the two ways that fails are both
 * quiet until somebody needs a backup. Measured on the development box on
 * 2026-09-19: Postgres runs in a container, the client tools are not on the
 * host, and `core:automated-backup` has recorded "pg_dump was not found on the
 * server" every night since. The message is right; it arrives on the scheduled
 * jobs screen a day after the operator set the site up, or at the moment they
 * were trying to take one.
 *
 * The shipped image is not the problem - its Dockerfile installs
 * `postgresql18-client` and says why. Every other shape is: a native install,
 * an image somebody built themselves, a host whose client is older than the
 * server it points at.
 *
 * That last one is the quiet one. `pg_dump` refuses a server newer than itself
 * and takes an older one happily, so a client 16 against a server 18 is a
 * backup that has never worked once.
 *
 * ## What this refuses to conclude
 *
 * Only two answers are a no: the binary is not there, and it is too old for
 * this server. Anything else - a database that will not say its version, a
 * `--version` line in a shape this does not parse - is read as "probably
 * fine", because a check that cannot finish must not be the reason a screen
 * stops offering a backup.
 */
import { spawn } from "child_process";
import { prisma } from "./db";
import { errorText, log } from "./logger";

/** Why a backup cannot be taken, or null when one can. */
export type BackupBlocker = "missing" | "too_old";

export interface BackupReadiness {
    ok: boolean;
    reason: BackupBlocker | null;
    /** The major of the `pg_dump` on this host, or null when it could not be read. */
    clientMajor: number | null;
    /** The major of the server it would dump, or null when it could not be read. */
    serverMajor: number | null;
}

/** Spawning a process per screen load is not a price a check gets to charge. */
const CACHE_MS = 5 * 60_000;
let cached: { value: BackupReadiness; expiresAt: number } | null = null;

/** For tests, and for a screen that has just been told the tools were installed. */
export function resetBackupToolCheck(): void {
    cached = null;
}

/** `pg_dump (PostgreSQL) 18.1` - the major is all that decides anything. */
function majorFrom(versionLine: string): number | null {
    const found = /(\d+)\.\d+/.exec(versionLine) ?? /(\d+)\s*$/.exec(versionLine.trim());
    if (!found) return null;
    const major = Number(found[1]);
    return Number.isInteger(major) && major > 0 ? major : null;
}

function readClientMajor(): Promise<{ major: number | null; missing: boolean }> {
    return new Promise((resolve) => {
        let output = "";
        let settled = false;
        const done = (answer: { major: number | null; missing: boolean }) => {
            if (settled) return;
            settled = true;
            resolve(answer);
        };
        try {
            const probe = spawn("pg_dump", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
            probe.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
            probe.stderr.on("data", () => { /* a version probe's noise is not news */ });
            probe.on("error", (err: NodeJS.ErrnoException) => {
                // Only ENOENT means "not installed". Anything else - a
                // permission, a broken shim - is a problem with this check
                // rather than proof there is no client.
                done({ major: null, missing: err?.code === "ENOENT" });
            });
            probe.on("exit", () => done({ major: majorFrom(output), missing: false }));
        } catch (err) {
            log.warn("[backup] the client version could not be probed", { error: errorText(err) });
            done({ major: null, missing: false });
        }
    });
}

async function readServerMajor(): Promise<number | null> {
    try {
        const rows = await prisma.$queryRawUnsafe<{ v: unknown }[]>(
            "SELECT current_setting('server_version_num')::int AS v",
        );
        const raw = Number(rows?.[0]?.v);
        // 180001 is 18.1: the major is the leading digits, whatever the rest.
        return Number.isFinite(raw) && raw > 0 ? Math.floor(raw / 10_000) : null;
    } catch (err) {
        log.warn("[backup] the server version could not be read", { error: errorText(err) });
        return null;
    }
}

export async function canTakeABackup(): Promise<BackupReadiness> {
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const [client, serverMajor] = await Promise.all([readClientMajor(), readServerMajor()]);

    let value: BackupReadiness;
    if (client.missing) {
        value = { ok: false, reason: "missing", clientMajor: null, serverMajor };
    } else if (client.major !== null && serverMajor !== null && client.major < serverMajor) {
        value = { ok: false, reason: "too_old", clientMajor: client.major, serverMajor };
    } else {
        value = { ok: true, reason: null, clientMajor: client.major, serverMajor };
    }

    cached = { value, expiresAt: Date.now() + CACHE_MS };
    return value;
}
