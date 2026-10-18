/**
 * The numbers an operator may tune, with the defaults the protocol page names.
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
