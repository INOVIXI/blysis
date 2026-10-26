/**
 * Outbound webhook channels.
 *
 * Core generates the alert content and owns the wire layouts; it does not know
 * any chat vendor by name. A module teaches core about a vendor by declaring a
 * `webhookChannels` entry in its manifest: which hostnames are acceptable, and
 * which of core's layouts the receiver understands.
 *
 * Core always offers one built-in channel, `generic`, so alerting keeps working
 * on an install with no modules at all.
 */

import { hostnameMatchesAllowlist, isPrivateHost } from "./url-safety";

export type WebhookLayout = "json" | "embed" | "attachment";

export interface WebhookChannel {
    id: string;
    label: string;
    layout: WebhookLayout;
    /** Allowed webhook hostnames. Absent on the generic channel. */
    hosts?: string[];
    urlPlaceholder?: string;
    /** Module that declared the channel; absent for the built-in one. */
    module?: string;
}

export type ModuleWebhookChannel = WebhookChannel & { module: string };

/** Fields core attaches to every alert, before a layout shapes them. */
export interface WebhookAlert {
    title: string;
    message: string;
    /** Severity colour as a 24-bit integer. */
    color: number;
    fields: { name: string; value: string }[];
    timestamp: string;
}

export const GENERIC_CHANNEL_ID = "generic";

export const GENERIC_CHANNEL: WebhookChannel = {
    id: GENERIC_CHANNEL_ID,
    label: "Generic JSON",
    layout: "json",
    urlPlaceholder: "https://example.com/webhooks/health",
};

/**
 * The channels an admin can choose from: the built-in one, plus the channels
 * declared by modules that are currently enabled.
 */
export function listWebhookChannels(
    moduleChannels: readonly ModuleWebhookChannel[],
    isEnabled: (moduleId: string) => boolean,
): WebhookChannel[] {
    const channels: WebhookChannel[] = [GENERIC_CHANNEL];
    const seen = new Set<string>([GENERIC_CHANNEL_ID]);

    for (const channel of moduleChannels) {
        // A module may neither shadow the built-in channel nor a channel an
        // earlier module already claimed; first declaration wins.
        if (seen.has(channel.id)) continue;
        if (!isEnabled(channel.module)) continue;
        seen.add(channel.id);
        channels.push(channel);
    }

    return channels;
}

/**
 * Look up the configured channel. Falls back to the generic channel, so an
 * install that disables the module it was pointed at keeps alerting instead of
 * silently going quiet.
 */
export function resolveWebhookChannel(
    id: string | undefined,
    channels: readonly WebhookChannel[],
): WebhookChannel {
    return channels.find((c) => c.id === id) ?? GENERIC_CHANNEL;
}

export type UrlCheck = { ok: true } | { ok: false; error: string };

/**
 * Validate an admin-supplied webhook URL for a channel.
 *
 * A module-declared channel is checked against its own host allowlist. The
 * generic channel accepts any public host, so it instead refuses targets that
 * only exist inside the network - an admin-editable URL that core fetches
 * server-side is an SSRF surface.
 */
export function validateWebhookUrl(channel: WebhookChannel, rawUrl: string): UrlCheck {
    if (!rawUrl) return { ok: false, error: "No webhook URL" };

    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return { ok: false, error: "Invalid webhook URL" };
    }

    if (parsed.protocol !== "https:") {
        return { ok: false, error: "Webhook URL must use https" };
    }

    if (channel.hosts && channel.hosts.length > 0) {
        if (!hostnameMatchesAllowlist(parsed.hostname, channel.hosts)) {
            return { ok: false, error: `${channel.label} webhook URL must be on ${channel.hosts.join(" or ")}` };
        }
        return { ok: true };
    }

    if (isPrivateHost(parsed.hostname)) {
        return { ok: false, error: "Webhook URL must point at a public host" };
    }

    return { ok: true };
}

function toHexColor(color: number): string {
    return `#${color.toString(16).padStart(6, "0")}`;
}

/** Shape an alert into the wire format the channel's receiver understands. */
export function buildWebhookPayload(
    channel: WebhookChannel,
    alert: WebhookAlert,
): Record<string, unknown> {
    switch (channel.layout) {
        case "embed":
            return {
                content: alert.message,
                embeds: [
                    {
                        title: alert.title,
                        description: alert.message,
                        color: alert.color,
                        fields: alert.fields.map((f) => ({ ...f, inline: true })),
                        timestamp: alert.timestamp,
                    },
                ],
                username: alert.title,
            };
        case "attachment":
            return {
                text: alert.message,
                attachments: [
                    {
                        color: toHexColor(alert.color),
                        text: alert.message,
                        fields: alert.fields.map((f) => ({ title: f.name, value: f.value, short: true })),
                        ts: Math.floor(Date.parse(alert.timestamp) / 1000),
                    },
                ],
            };
        case "json":
        default:
            return {
                title: alert.title,
                // Both keys carry the message so one neutral body renders on the
                // common incoming-webhook receivers without core naming any of them.
                text: alert.message,
                content: alert.message,
                fields: alert.fields,
                timestamp: alert.timestamp,
            };
    }
}
