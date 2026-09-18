/**
 * What an operator configures, and where it is kept.
 *
 * One settings key holds the whole configuration and the connection string
 * inside it is declared a credential, so `secret-settings.ts` seals it on the
 * way in and opens it on the way out. That matters more here than for most:
 * this address is a database user on the game server's box, and a settings
 * row is readable from a backup, from a restored dump and from any read-only
 * session.
 *
 * It used to be an environment variable read straight out of `process.env`,
 * named in no `.env.example` and in no form - so an operator could only find
 * it by reading the source, and until they did, every request was refused
 * with no way to tell that from a misconfigured one.
 *
 * The prefix is here because LiteBans lets a server rename its tables, and a
 * site sharing a database with something else will have. It reaches a query as
 * part of an identifier, so it is checked as one; see `query.ts`.
 */

import { readSettingValues } from "@/core/sdk/server";
import { DEFAULT_PREFIX } from "./tables";

export const CONFIG_KEY = "minecraft_litebans_config";

export interface LiteBansConfig {
    /** A `mysql://`, `mariadb://` or `postgres://` address. Empty until set. */
    connection: string;
    /** What every LiteBans table name starts with. */
    prefix: string;
    /** Off until an operator has tried the connection and turned it on. */
    enabled: boolean;
    /**
     * What to call the place when a row does not say. LiteBans divides one
     * database with `server_scope`, and a server that leaves it empty needs
     * the connection itself to name where its punishments happened.
     */
    scopeKey: string;
}

export const EMPTY_CONFIG: LiteBansConfig = { connection: "", prefix: DEFAULT_PREFIX, enabled: false, scopeKey: "" };

/**
 * The stored value, narrowed. A row written by an older version, by hand, or
 * by a restore that could not decrypt the credential reads as "not configured"
 * rather than throwing: a sync that says it has nothing to do is recoverable,
 * a scheduler tick that throws is not.
 */
export function configFrom(value: unknown): LiteBansConfig {
    if (typeof value !== "object" || value === null) return EMPTY_CONFIG;
    const raw = value as Record<string, unknown>;
    return {
        connection: typeof raw.connection === "string" ? raw.connection.trim() : "",
        prefix: typeof raw.prefix === "string" && raw.prefix.trim() !== "" ? raw.prefix.trim() : DEFAULT_PREFIX,
        enabled: raw.enabled === true,
        scopeKey: typeof raw.scopeKey === "string" ? raw.scopeKey.trim() : "",
    };
}

export async function readConfig(): Promise<LiteBansConfig> {
    const values = await readSettingValues([CONFIG_KEY]);
    return configFrom(values[CONFIG_KEY]);
}
