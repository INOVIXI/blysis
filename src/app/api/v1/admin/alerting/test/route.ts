import { NextResponse } from "next/server";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import {
    buildTestPayload,
    listAlertingChannels,
    loadAlertingConfig,
    sendHealthWebhook,
} from "@/core/lib/health-alerting";
import { resolveWebhookChannel } from "@/core/lib/webhook-channels";

/**
 * POST /api/v1/admin/alerting/test
 * Sends a sample notification to the configured webhook so admins
 * can verify the URL works before enabling real alerts.
 */
export async function POST() {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id, session.user.role))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const config = await loadAlertingConfig();
    if (!config.webhookUrl) {
        return NextResponse.json(
            { error: "No webhook URL configured. Save one first." },
            { status: 400 },
        );
    }

    const channel = resolveWebhookChannel(config.channel, await listAlertingChannels());
    const payload = buildTestPayload(channel);
    // Named apart from the scheduled alert, because "did the alert go out?"
    // and "did somebody press Test?" are two questions asked of the same log.
    const result = await sendHealthWebhook(config, payload, channel, "core.health.test");

    if (!result.ok) {
        return NextResponse.json({ error: result.error || "Failed" }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
}
