import { readSettingValues } from "@/core/sdk/server";

/**
 * Sending through Resend.
 *
 * This lived in core: `email.ts` imported the client and called it, which
 * named a vendor in core and meant there was exactly one way to send mail on
 * the whole platform. Core builds the message now and whatever is installed
 * sends it; this is that, for this vendor.
 *
 * The key comes through the settings boundary rather than off the row: it is
 * a declared credential, encrypted at rest, and signing a request with the
 * ciphertext fails in a way that reads as a bad key rather than a bad read.
 * The environment variable stays the install's default - it is what an image
 * sets once - and a stored row overrides it.
 */
const SETTING_KEY = "resend_api_key";

interface EmailMessage {
    from: string;
    to: string;
    subject: string;
    html: string;
}

async function apiKey(): Promise<string | null> {
    try {
        const values = await readSettingValues([SETTING_KEY]);
        const stored = values[SETTING_KEY];
        if (typeof stored === "string" && stored.trim()) return stored.trim();
    } catch {
        // A settings read that failed is not a reason to claim there is no
        // key: the environment may still have one.
    }
    const fromEnv = process.env.RESEND_API_KEY;
    return typeof fromEnv === "string" && fromEnv.trim() ? fromEnv.trim() : null;
}

/** One client per key, rebuilt when an operator changes it. */
let client: { emails: { send: (opts: Record<string, unknown>) => Promise<unknown> } } | null = null;
let builtFrom: string | null = null;

export const resendProvider = {
    async isConfigured(): Promise<boolean> {
        return (await apiKey()) !== null;
    },

    async send(message: EmailMessage): Promise<void> {
        const key = await apiKey();
        if (!key) throw new Error("Resend is not configured");

        if (!client || builtFrom !== key) {
            const { Resend } = await import("resend");
            client = new Resend(key) as unknown as typeof client;
            builtFrom = key;
        }

        // The SDK answers a refusal rather than throwing it, so an unchecked
        // call reports every bounce as a delivery.
        const answer = (await client!.emails.send({
            from: message.from,
            to: message.to,
            subject: message.subject,
            html: message.html,
        })) as { error?: { message?: string } | null };

        if (answer?.error) {
            throw new Error(answer.error.message || "Resend refused the message");
        }
    },
};

export default resendProvider;
