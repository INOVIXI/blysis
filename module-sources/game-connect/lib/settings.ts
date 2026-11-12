/**
 * The numbers an operator may tune, with the defaults the protocol page names,
 * and the games on which a username is a player name.
 */
import { moduleSettings, type SettingValue } from "@/core/sdk/server";

export interface ConnectSettings {
    pollHoldSeconds: number;
    statusIntervalSeconds: number;
    leaseSeconds: number;
}

export const DEFAULT_SETTINGS: ConnectSettings = {
    pollHoldSeconds: 25,
    statusIntervalSeconds: 30,
    leaseSeconds: 120,
};

function bounded(value: unknown, fallback: number, min: number, max: number): number {
    if (value === null || value === undefined || value === "") return fallback;
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

export async function connectSettings(): Promise<ConnectSettings> {
    const raw = await moduleSettings<Record<string, SettingValue>>("game-connect").catch(
        () => ({}) as Record<string, SettingValue>,
    );
    return {
        pollHoldSeconds: bounded(raw.pollHoldSeconds, DEFAULT_SETTINGS.pollHoldSeconds, 5, 55),
        statusIntervalSeconds: bounded(raw.statusIntervalSeconds, DEFAULT_SETTINGS.statusIntervalSeconds, 5, 300),
        leaseSeconds: bounded(raw.leaseSeconds, DEFAULT_SETTINGS.leaseSeconds, 30, 3600),
    };
}

/** Where a member's username is their player name; read by `names.ts`. */
export interface NameSettings {
    /** Lower case, as `platformOf` spells a server's game. Empty means nowhere. */
    games: string[];
    /** A player's id on those games is the offline-mode id of their name. */
    offlineIds: boolean;
}

export async function nameSettings(): Promise<NameSettings> {
    const raw = await moduleSettings<Record<string, SettingValue>>("game-connect").catch(
        () => ({}) as Record<string, SettingValue>,
    );
    const games = typeof raw.usernamePlayerGames === "string" ? raw.usernamePlayerGames : "";
    return {
        games: [...new Set(games.split(/[\s,]+/).map((game) => game.toLowerCase()).filter((game) => game !== ""))],
        offlineIds: raw.offlineModeIds === true || raw.offlineModeIds === "true",
    };
}
