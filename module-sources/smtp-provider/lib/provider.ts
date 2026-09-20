import { readSettingValues } from "@/core/sdk/server";

/**
 * Sending through an SMTP relay the operator runs or pays for.
 *
 * Until this existed there was exactly one way to send mail on this platform:
 * core imported a vendor's API client and called it. An operator with a relay
 * - their own, their host's, their mailbox provider's - had nowhere to put it,
 * and "use our vendor or send nothing" is not a choice a platform gets to make
 * for the site running on it.
 *
 * The password is a declared credential and comes through the settings
 * boundary: encrypted at rest, and authenticating with the ciphertext would
 * fail in a way that reads as a wrong password rather than a bad read.
 */
/**
 * Five flat keys rather than one object, so the settings form writes them
 * directly and `smtp_password` can be declared a credential by name.
 */
const KEYS = ["smtp_host", "smtp_port", "smtp_user", "smtp_password", "smtp_secure"] as const;

interface SmtpConfig {
    host: string;
    port: number;
    user: string;
    password: string;
    /**
     * Implicit TLS from the first byte, which is what port 465 wants. Port
     * 587 starts in the clear and upgrades with STARTTLS, which nodemailer
     * does on its own when this is false - so this is a port question, not a
     * "should it be encrypted" question, and both answers are encrypted.
     */
    secure: boolean;
}

interface EmailMessage {
    from: string;
    to: string;
    subject: string;
    html: string;
}

const text = (raw: unknown): string => (typeof raw === "string" ? raw.trim() : "");

export async function readSmtpConfig(): Promise<SmtpConfig | null> {
    let values: Record<string, unknown>;
    try {
        values = await readSettingValues([...KEYS]);
    } catch {
        return null;
    }

    const host = text(values.smtp_host);
    const password = typeof values.smtp_password === "string" ? values.smtp_password : "";
    // A relay with no host is not a relay, and one with no password is a relay
    // that will refuse every message at AUTH. Neither is worth opening a
    // socket for.
    if (!host || !password) return null;

    const port = Number(values.smtp_port);
    return {
        host,
        port: Number.isFinite(port) && port > 0 && port < 65536 ? Math.floor(port) : 587,
        user: text(values.smtp_user),
        password,
        // Written by a form, so it arrives as the word rather than the value.
        secure: values.smtp_secure === true || values.smtp_secure === "true",
    };
}

/** One transport per configuration, rebuilt when an operator changes it. */
let transport: { sendMail: (options: Record<string, unknown>) => Promise<unknown> } | null = null;
let builtFrom = "";

function fingerprint(config: SmtpConfig): string {
    // The password is part of what identifies the connection but has no
    // business in a variable that outlives the send, so only its length is.
    return `${config.host}:${config.port}:${config.user}:${config.secure}:${config.password.length}`;
}

export const smtpProvider = {
    async isConfigured(): Promise<boolean> {
        return (await readSmtpConfig()) !== null;
    },

    async send(message: EmailMessage): Promise<void> {
        const config = await readSmtpConfig();
        if (!config) throw new Error("No SMTP relay is configured");

        const mark = fingerprint(config);
        if (!transport || builtFrom !== mark) {
            const nodemailer = await import("nodemailer");
            transport = nodemailer.createTransport({
                host: config.host,
                port: config.port,
                secure: config.secure,
                auth: config.user ? { user: config.user, pass: config.password } : undefined,
                // A relay that never answers must not hold a queue worker
                // open: the message stays queued and goes out on the next tick.
                connectionTimeout: 10_000,
                greetingTimeout: 10_000,
                socketTimeout: 20_000,
            }) as unknown as typeof transport;
            builtFrom = mark;
        }

        await transport!.sendMail({
            from: message.from,
            to: message.to,
            subject: message.subject,
            html: message.html,
        });
    },
};

export default smtpProvider;
