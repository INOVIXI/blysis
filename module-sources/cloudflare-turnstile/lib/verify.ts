import { readSettingValues } from "@/core/sdk/server";

interface TurnstileConfig {
    siteKey?: string;
    secretKey?: string;
    /**
     * The forms the operator switched the widget on for, by the id each one
     * declared. Core's login, register and forgot-password are in the same
     * list as a module's own: this module has one question to answer and no
     * reason to know which of them core owns.
     */
    points?: unknown;
    /**
     * The two switches from before a form could name itself. Read rather than
     * migrated: every install with Turnstile on its login form has them, and
     * nothing has to run for that to keep being true.
     */
    enableOnLogin?: boolean;
    enableOnRegister?: boolean;
}

/** The old switches as the points they were, so one answer covers both. */
const LEGACY_POINT: Record<string, "enableOnLogin" | "enableOnRegister"> = {
    login: "enableOnLogin",
    register: "enableOnRegister",
};

/** Whether the widget belongs on the form the caller named. */
export function isPointEnabled(config: TurnstileConfig, point: string): boolean {
    const chosen = Array.isArray(config.points) ? config.points : [];
    if (chosen.includes(point)) return true;
    const legacy = LEGACY_POINT[point];
    return legacy !== undefined && config[legacy] === true;
}

/** Load Turnstile config from settings. Returns null if not configured. */
export async function getTurnstileConfig(): Promise<TurnstileConfig | null> {
    // Through the SDK rather than off the row: `secretKey` is a declared
    // credential and arrives encrypted. Verifying with the ciphertext would
    // fail every challenge, which locks every visitor out of the login form.
    const values = await readSettingValues(["cloudflare_turnstile_config"]);
    const stored = values.cloudflare_turnstile_config;
    if (!stored || typeof stored !== "object") return null;
    return stored as TurnstileConfig;
}

/**
 * Verify a Turnstile challenge token against Cloudflare's siteverify endpoint.
 * Returns true if the token is valid, false otherwise (or if Turnstile isn't configured).
 */
export async function verifyTurnstileToken(token: string): Promise<boolean> {
    const config = await getTurnstileConfig();
    if (!config?.secretKey) return false;

    try {
        const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `secret=${encodeURIComponent(config.secretKey)}&response=${encodeURIComponent(token)}`,
        });
        const data = (await res.json()) as { success?: boolean };
        return !!data.success;
    } catch {
        return false;
    }
}
