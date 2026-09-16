import { ModuleEmailApiKeyEnvVars, ModuleEmailApiKeySettings } from "@/core/generated/module-data";
import { readSettingValues } from "@/core/lib/setting-values";
import { resolveAppUrl } from "@/core/lib/app-url";

/**
 * Where the mailer gets its transport and its return address.
 *
 * Two modules ship a screen for exactly these three values - a mail API key, a
 * return address and a display name - and nothing read the rows. An operator
 * pasted an API key into the admin panel, saw "Saved", and mail stayed off,
 * with the key now sitting in the database earning nothing. So the row is read
 * first and the environment variable is the fallback, which is the order an
 * operator expects: the image ships a default, the running site overrides it.
 *
 * Cached for a few seconds because every queued message asks. A save is not
 * required to take effect instantly; a mailer that opens a database
 * connection per message is a worse trade.
 */

export interface EmailConfig {
    apiKey: string | null;
    fromEmail: string;
    fromName: string | null;
}

const CACHE_MS = 10_000;

let cache: { value: EmailConfig; expiresAt: number } | null = null;

/** Drop the cache so the next send reloads. Called after a settings write. */
export function invalidateEmailConfig(): void {
    cache = null;
}

function firstString(...candidates: unknown[]): string | null {
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
    return null;
}

/**
 * The return address is core's own vocabulary; the API key's name is not.
 *
 * Which settings key holds the mail credential is the provider module's to
 * say - core used to read that key by its literal name, which is core naming
 * a module - so it comes from whatever mail providers are installed. It is a
 * declared credential too, which is why this reads through the settings
 * boundary rather than off the row: encrypted at rest, a direct read would
 * hand the ciphertext to the provider and every message would fail to send.
 */
const OWN_KEYS = ["email_from", "email_from_name"] as const;

/**
 * The return address when nobody has set one.
 *
 * It used to be `noreply@` at the product's own domain, which is a host this
 * installation does not control: mail sent from it fails SPF at the receiving
 * end and lands in a spam folder, and a reply goes to somebody else. Built
 * from this installation's own address instead, so the worst case is a
 * mailbox that does not exist on a domain that is the sender's.
 */
function defaultFromAddress(): string {
    try {
        return `noreply@${new URL(resolveAppUrl()).hostname}`;
    } catch {
        return "noreply@localhost";
    }
}

export async function getEmailConfig(): Promise<EmailConfig> {
    const now = Date.now();
    if (cache && cache.expiresAt > now) return cache.value;

    let stored: Record<string, unknown> = {};
    try {
        stored = await readSettingValues([...OWN_KEYS, ...ModuleEmailApiKeySettings]);
    } catch {
        // A settings read must never take down the mailer; the environment
        // is a complete configuration on its own.
    }

    const value: EmailConfig = {
        apiKey: firstString(
            ...ModuleEmailApiKeySettings.map((key) => stored[key]),
            ...ModuleEmailApiKeyEnvVars.map((name) => process.env[name]),
        ),
        fromEmail:
            firstString(stored.email_from, process.env.EMAIL_FROM) ?? defaultFromAddress(),
        fromName: firstString(stored.email_from_name),
    };
    cache = { value, expiresAt: now + CACHE_MS };
    return value;
}
