/**
 * RCON, in one place.
 *
 * This module owns game servers, so it owns the connection to them. Other
 * modules do not import this file - they cannot, modules never import each
 * other - they ask through the `server.command` filter hook, which
 * `hooks/run-command.ts` answers.
 *
 * Configuration is per server, read from the `GameServer` row: host,
 * `rconPort`, and `rconPassword` stored as AES-256-GCM ciphertext. The global
 * `rcon_host` / `rcon_port` / `rcon_password` settings that used to sit
 * alongside it are gone - they held a second, plaintext copy of the same
 * password and could only ever describe one server. An install still carrying
 * them is migrated into a `GameServer` row the first time RCON is used.
 */
import { decryptSecret, encryptSecret, prisma, log } from "@/core/sdk/server";

export interface RconConfig {
    host: string;
    port: number;
    password: string;
}

/** Minecraft's default. Also what most Source servers are set to. */
const DEFAULT_RCON_PORT = 25575;

interface RconClient {
    send: (command: string) => Promise<string>;
    end: () => void;
}

/**
 * `rcon-client` must not be traced into the bundle: the modules that need it
 * are compiled into the same build as the ones that do not. `eval('require')`
 * keeps the bundler from following it. Since 5.0 the package is ESM, which
 * Node's `require` loads from 22.12 on; the project requires Node 24.
 */
function loadRcon(): { connect: (config: RconConfig) => Promise<RconClient> } {
    // eslint-disable-next-line no-eval
    const { Rcon } = eval("require")("rcon-client") as {
        Rcon: { connect: (config: RconConfig) => Promise<RconClient> };
    };
    return Rcon;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * One-time move of the old global settings into a server row.
 *
 * The settings table held `rcon_password` in plaintext, which is the other
 * reason this is a migration rather than a fallback: the row is rewritten as
 * an encrypted `GameServer.rconPassword` and then deleted.
 */
let migration: Promise<void> | null = null;

async function migrateLegacySettings(): Promise<void> {
    const rows = await prisma.setting.findMany({ where: { key: { startsWith: "rcon_" } } });
    if (rows.length === 0) return;

    const map: Record<string, string> = {};
    for (const row of rows) map[row.key] = String(row.value ?? "");

    if (map.rcon_host && map.rcon_password) {
        const port = Number.parseInt(map.rcon_port || "", 10) || DEFAULT_RCON_PORT;
        const existing = await prisma.gameServer.findFirst({ where: { host: map.rcon_host } });
        if (existing) {
            await prisma.gameServer.update({
                where: { id: existing.id },
                data: { rconPort: existing.rconPort ?? port, rconPassword: existing.rconPassword ?? encryptSecret(map.rcon_password) },
            });
            log.info("[servers] moved the global RCON settings onto an existing server", { host: map.rcon_host });
        } else {
            await prisma.gameServer.create({
                data: {
                    name: map.rcon_host,
                    host: map.rcon_host,
                    rconPort: port,
                    rconPassword: encryptSecret(map.rcon_password),
                    isDefault: (await prisma.gameServer.count()) === 0,
                },
            });
            log.info("[servers] created a server from the global RCON settings", { host: map.rcon_host });
        }
    }

    // Gone either way: an unusable half-configuration is not worth keeping,
    // and a usable one has just been copied somewhere it is encrypted.
    await prisma.setting.deleteMany({ where: { key: { in: rows.map((r) => r.key) } } });
}

function runMigrationOnce(): Promise<void> {
    migration ??= migrateLegacySettings().catch((error) => {
        log.warn("[servers] could not migrate the legacy RCON settings", {
            error: error instanceof Error ? error.message : String(error),
        });
    });
    return migration;
}

function fromRow(row: { host: string; rconPort: number | null; rconPassword: string | null }): RconConfig | null {
    if (!row.rconPort || !row.rconPassword) return null;
    // Written by the servers admin page through secret-storage.ts.
    // decryptSecret returns a legacy plaintext row unchanged, so an install
    // that predates encryption keeps working.
    return { host: row.host, port: row.rconPort, password: decryptSecret(row.rconPassword) };
}

/** The server a command goes to when the caller does not name one. */
async function defaultServerConfig(): Promise<RconConfig | null> {
    const candidates = await prisma.gameServer.findMany({
        where: { isActive: true, rconPort: { not: null }, rconPassword: { not: null } },
        orderBy: [{ isDefault: "desc" }, { order: "asc" }, { createdAt: "asc" }],
        select: { host: true, rconPort: true, rconPassword: true },
        take: 1,
    });
    return candidates[0] ? fromRow(candidates[0]) : null;
}

async function serverConfig(serverId: string): Promise<RconConfig | null> {
    const server = await prisma.gameServer.findUnique({
        where: { id: serverId },
        select: { host: true, rconPort: true, rconPassword: true, isActive: true },
    });
    if (!server || !server.isActive) return null;
    return fromRow(server);
}

/**
 * Resolves where a command should go.
 *
 * A named server that turns out to have no RCON configured is an error, not a
 * reason to quietly run the command somewhere else: a delivery command aimed
 * at the survival server must never land on the creative one.
 */
export async function resolveRconConfig(serverId?: string | null): Promise<RconConfig | null> {
    await runMigrationOnce();
    if (serverId) return serverConfig(serverId);
    return defaultServerConfig();
}

/** Whether any server on this install can take a command. */
export async function isRconAvailable(): Promise<boolean> {
    await runMigrationOnce();
    const count = await prisma.gameServer.count({
        where: { isActive: true, rconPort: { not: null }, rconPassword: { not: null } },
    });
    return count > 0;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/** Sends one command and returns the server's reply. Throws if it cannot. */
export async function sendRconCommand(command: string, serverId?: string | null): Promise<string> {
    const config = await resolveRconConfig(serverId);
    if (!config) {
        throw new Error(
            serverId
                ? "That server has no RCON port and password configured"
                : "No server on this install has RCON configured",
        );
    }

    let client: RconClient;
    try {
        client = await loadRcon().connect(config);
    } catch (error) {
        throw new Error(`RCON connection failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }

    try {
        return await client.send(command);
    } catch (error) {
        throw new Error(`RCON command failed: ${error instanceof Error ? error.message : "unknown error"}`);
    } finally {
        client.end();
    }
}
